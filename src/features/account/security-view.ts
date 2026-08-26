import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/auth";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Account, Session } from "@/lib/db/models/identity";
import { formatDateTime } from "@/lib/dates";

/**
 * What the security tab reads — sessions, sign-in methods, and recent sign-ins.
 *
 * ## Both reads go to the collections, not to Better Auth's HTTP surface
 *
 * Not a stylistic split. **`/list-sessions` requires a *fresh* session.** Better
 * Auth guards it with `sensitiveSessionMiddleware`, which compares
 * `session.createdAt` against `freshAge` — one day by default. `updateAge`
 * refreshes `expiresAt` and `updatedAt` but never `createdAt`, so a session older
 * than a day can never become fresh again without signing in.
 *
 * The first version of this called `auth.api.listSessions`, and the consequence
 * was that anybody signed in for more than a day loaded this page and watched it
 * crash: the shell and two panels streamed, then this read threw
 * `SESSION_NOT_FRESH` inside its own boundary. A screen whose purpose is telling
 * somebody where they are signed in must not be unreachable to the people most
 * likely to need it.
 *
 * So sessions are read from the `sessions` collection, scoped by `userId` like
 * every other read here, and only the *current token* comes from
 * `auth.api.getSession`, which is not guarded. Freshness is the right requirement
 * for revoking a session and the wrong one for listing them.
 *
 * `accounts` is read the same way, for consistency rather than necessity —
 * `/list-accounts` is not guarded today. But the two reads sit side by side on one
 * screen, and one of them being one Better Auth release away from taking the page
 * down is not a distinction worth keeping. Only `providerId` is selected; the
 * tokens and the password hash are `select: false` on the schema anyway.
 *
 * Better Auth remains the only **writer** of both collections. Nothing here
 * writes to either.
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

/** §94 — no unbounded reads. Somebody with fifty stale sessions gets the recent ones. */
const MAX_SESSIONS = 20;

export async function activeSessions(): Promise<SessionRow[]> {
  const current = await getAuth().api.getSession({ headers: await headers() });
  if (!current) return [];

  await connectToDatabase();

  const rows = await Session.find({
    userId: toObjectId(current.user.id),
    // The TTL index removes expired rows, but only on its own sweep — so an
    // expired session can still be sitting there, and listing one as somewhere
    // you are signed in would be wrong.
    expiresAt: { $gt: new Date() },
  })
    .select({ token: 1, ipAddress: 1, userAgent: 1, createdAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(MAX_SESSIONS)
    .lean<
      Array<{
        token: string;
        ipAddress?: string | null;
        userAgent?: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >();

  return (
    rows
      .map((session) => ({
        token: session.token,
        device: describeDevice(session.userAgent ?? undefined),
        ...(session.ipAddress ? { ip: session.ipAddress } : {}),
        signedInAt: formatDateTime(session.createdAt),
        lastUsedAt: formatDateTime(session.updatedAt),
        current: session.token === current.session.token,
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
  const current = await getAuth().api.getSession({ headers: await headers() });
  if (!current) return { hasPassword: false, providers: [] };

  await connectToDatabase();

  const rows = await Account.find({ userId: toObjectId(current.user.id) })
    // `providerId` and nothing else. Tokens and the password hash are
    // `select: false` on the schema, and naming the one field we want means a
    // future column cannot arrive here by accident.
    .select({ providerId: 1 })
    .lean<Array<{ providerId: string }>>();

  const providers = rows.map((row) => row.providerId);

  return {
    hasPassword: providers.includes("credential"),
    providers: [...new Set(providers.filter((provider) => provider !== "credential"))],
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
