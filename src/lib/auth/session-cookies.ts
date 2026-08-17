import "server-only";

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

const PREFIX = "innovatrix";

/**
 * Every cookie Better Auth may have set for a session under our prefix.
 *
 * Both the plain and `__Secure-` spellings, because `useSecureCookies` decides
 * which is live from `APP_URL` and guessing wrong leaves the loop in place.
 * Deleting a cookie that was never set costs nothing.
 */
export function sessionCookieNames(): string[] {
  const bases = ["session_token", "session_data", "dont_remember"];
  return bases.flatMap((base) => [`${PREFIX}.${base}`, `__Secure-${PREFIX}.${base}`]);
}

/** Does this request carry something that looks like a session cookie? */
export function hasSessionCookie(jar: { getAll(): Array<{ name: string }> }): boolean {
  // Matched by shape rather than exact name: the suffix list is Better Auth's
  // to change, and a missed name here reintroduces the redirect loop.
  return jar
    .getAll()
    .some((cookie) => new RegExp(`${PREFIX}\\.(session_token|session_data)`).test(cookie.name));
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
