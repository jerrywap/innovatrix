import "server-only";
import { COOKIE_PREFIX } from "./cookie-prefix";

/**
 * The session cookies, by name — and how to remove them.
 *
 * ## Why removing them is a correctness concern, not tidiness
 *
 * `proxy.ts` guards `/dashboard`, `/staff` and `/admin` by checking that a
 * session cookie is **present**, and never reads the database — that is what
 * keeps it at zero queries per request. The DAL checks whether the session is
 * **valid**.
 *
 * A cookie that exists and is no longer accepted therefore makes the two
 * disagree, permanently: the proxy lets the request through, the DAL redirects
 * to `/login`, and the proxy bounces `/login` back to `/dashboard` because the
 * cookie is still there. `ERR_TOO_MANY_REDIRECTS`, and the browser's own advice
 * — "try deleting your cookies" — is the correct fix applied by the wrong party.
 *
 * So any path that concludes "this session is over" must delete the evidence.
 * Only a Server Action or a Route Handler can, which is why this is a helper
 * they share rather than something the DAL does where it finds the problem.
 */

const PREFIX = COOKIE_PREFIX;

/**
 * Prefixes we no longer set but may still be holding a browser hostage.
 *
 * The CoSetup rebrand moved the prefix, and a rename is exactly the situation
 * this file exists for: every signed-in visitor is carrying an `innovatrix.*`
 * cookie that Better Auth will never accept again. Leave it out of the lists
 * below and it is invisible to both functions — the proxy stops recognising it,
 * so there is no loop, but nothing ever deletes it either, and the visitor keeps
 * a dead credential in their jar indefinitely.
 *
 * Including it means the proxy still sees "a session", the DAL still finds it
 * invalid, and the existing clear-and-redirect path removes it on the first
 * request. One awkward redirect, then gone.
 *
 * This list can be emptied once no plausible visitor still holds one —
 * `AUTH_SESSION_DAYS` past the deploy is the honest threshold.
 */
const LEGACY_PREFIXES = ["innovatrix"] as const;

const ALL_PREFIXES = [PREFIX, ...LEGACY_PREFIXES];

/**
 * Every cookie Better Auth may have set for a session under our prefix.
 *
 * Both the plain and `__Secure-` spellings, because `useSecureCookies` decides
 * which is live from `APP_URL` and guessing wrong leaves the loop in place.
 * Deleting a cookie that was never set costs nothing.
 */
export function sessionCookieNames(): string[] {
  const bases = ["session_token", "session_data", "dont_remember"];
  return ALL_PREFIXES.flatMap((prefix) =>
    bases.flatMap((base) => [`${prefix}.${base}`, `__Secure-${prefix}.${base}`]),
  );
}

/** Does this request carry something that looks like a session cookie? */
export function hasSessionCookie(jar: { getAll(): Array<{ name: string }> }): boolean {
  // Matched by shape rather than exact name: the suffix list is Better Auth's
  // to change, and a missed name here reintroduces the redirect loop.
  const pattern = new RegExp(`(${ALL_PREFIXES.join("|")})\\.(session_token|session_data)`);
  return jar.getAll().some((cookie) => pattern.test(cookie.name));
}

/** Remove them. Returns how many were actually there, for the log line. */
export function clearSessionCookies(jar: {
  has(name: string): boolean;
  delete(name: string): unknown;
}): number {
  const present = sessionCookieNames().filter((name) => jar.has(name));
  for (const name of present) jar.delete(name);
  return present.length;
}
