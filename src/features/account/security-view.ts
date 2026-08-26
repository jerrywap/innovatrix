import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/auth";
import { formatDateTime } from "@/lib/dates";

/**
 * What the security tab reads — sessions, sign-in methods, and recent sign-ins.
 *
 * ## Everything goes through Better Auth's server API, not the collections
 *
 * `sessions` and `accounts` are Better Auth's tables. It is documented in this
 * codebase as their only writer, and reading them directly would make this the
 * only place that knows their shape — including the parts it manages itself, like
 * which session the current cookie belongs to. `auth.api.listSessions` already
 * answers that; a Mongo query would have to reimplement it from the cookie.
 *
 * ## `lastActiveAt` is not used, and that is deliberate
 *
 * `users.lastActiveAt` is declared in the Better Auth config *and* on the
 * Mongoose schema, and **nothing anywhere writes it**. A "last active" column
 * fed from it would read empty for every user forever. `sessions.updatedAt` is
 * the honest answer: Better Auth refreshes it on use, bounded by `updateAge`,
 * so it means "seen within a day of this" rather than "seen at this instant" —
 * which is why the column is labelled "last used" and not "last seen".
 */

export interface SessionRow {
  /** The session token. Opaque to the UI, and what revocation needs. */
  token: string;
  device: string;
  /** The IP as recorded, or undefined. Never geolocated — we do not know a city. */
  ip?: string;
  signedInAt: string;
  lastUsedAt: string;
  /** The one this request arrived on. Labelled, and not revocable from the list. */
  current: boolean;
}

export async function activeSessions(): Promise<SessionRow[]> {
  const requestHeaders = await headers();
  const auth = getAuth();

  const [sessions, current] = await Promise.all([
    auth.api.listSessions({ headers: requestHeaders }),
    auth.api.getSession({ headers: requestHeaders }),
  ]);

  const currentToken = current?.session.token;

  return (
    (sessions ?? [])
      .map((session) => ({
        token: session.token,
        device: describeDevice(session.userAgent ?? undefined),
        ...(session.ipAddress ? { ip: session.ipAddress } : {}),
        signedInAt: formatDateTime(session.createdAt),
        lastUsedAt: formatDateTime(session.updatedAt),
        current: session.token === currentToken,
      }))
      // The current one first — it is the row a reader checks against before
      // deciding any of the others are suspicious.
      .sort((a, b) => Number(b.current) - Number(a.current))
  );
}

export interface SignInMethods {
  /** True when a `credential` row exists, i.e. a password can be used. */
  hasPassword: boolean;
  /** Social providers linked to this account, by id: `["google"]`. */
  providers: string[];
}

export async function signInMethods(): Promise<SignInMethods> {
  const accounts = await getAuth().api.listUserAccounts({ headers: await headers() });

  const providers = (accounts ?? []).map((account) => account.providerId);

  return {
    hasPassword: providers.includes("credential"),
    providers: providers.filter((provider) => provider !== "credential"),
  };
}

/**
 * May this provider be disconnected?
 *
 * The one rule in this feature that stops somebody locking themselves out. A
 * disconnect that removes the last way in leaves an account reachable only by a
 * password reset — and if the address was the Google one and there is no
 * password, not even that.
 *
 * Pure, and separated from the action, because it is the piece of logic here
 * whose failure is unrecoverable by the person affected. Exported for its test.
 */
export function canDisconnect(
  methods: SignInMethods,
  provider: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (!methods.providers.includes(provider)) {
    return { allowed: false, reason: "That account isn't connected." };
  }

  if (methods.hasPassword) return { allowed: true };

  const others = methods.providers.filter((candidate) => candidate !== provider);
  if (others.length > 0) return { allowed: true };

  return {
    allowed: false,
    reason:
      "This is the only way you can sign in. Set a password first, then you can disconnect it.",
  };
}

/**
 * A user-agent string, as a person would name the thing they are holding.
 *
 * Deliberately crude. A full parser is a dependency plus a database of a
 * thousand strings that goes stale, and the question this answers is only ever
 * "is one of these rows not me" — for which "Chrome on macOS" is as useful as a
 * version number and far easier to scan.
 *
 * Order matters: Edge and Chrome both claim to be Safari, and Edge claims to be
 * Chrome, so the most specific has to be tested first.
 */
export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser =
    match(userAgent, [
      [/\bEdg\//, "Edge"],
      [/\bOPR\/|\bOpera\b/, "Opera"],
      [/\bFirefox\//, "Firefox"],
      [/\bChrome\//, "Chrome"],
      [/\bSafari\//, "Safari"],
      [/\bcurl\//, "curl"],
      [/\bPostmanRuntime\//, "Postman"],
    ]) ?? undefined;

  const platform =
    match(userAgent, [
      [/\biPhone\b/, "iPhone"],
      [/\biPad\b/, "iPad"],
      [/\bAndroid\b/, "Android"],
      [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
      [/\bWindows\b/, "Windows"],
      [/\bLinux\b/, "Linux"],
    ]) ?? undefined;

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  // Honest rather than "Unknown Unknown": we have a string, we just cannot read
  // it, and showing a truncated original beats inventing a name for it.
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent;
}

function match(
  value: string,
  patterns: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return null;
}
