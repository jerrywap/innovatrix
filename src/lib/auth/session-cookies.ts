import "server-only";
import { isSessionCookieName, sessionCookieExpiry, sessionCookieNames } from "./cookie-prefix";

/**
 * The session cookies, by name — and how to remove them.
 *
 * The names, the shape test and the expiry attributes now live in
 * `cookie-prefix.ts`, because `proxy.ts` needs all three and cannot import a
 * `server-only` module. This file is the server-side face of them; it is
 * re-exported rather than duplicated so the two runtimes cannot drift.
 *
 * ## Why removing them is a correctness concern, not tidiness
 *
 * `proxy.ts` guards `/dashboard`, `/staff` and `/admin` by checking that a
 * session cookie is **present**, and never reads the database — that is what
 * keeps it at zero queries per request. The DAL checks whether the session is
 * **valid**.
 *
 * A cookie that exists and is no longer accepted therefore makes the two
 * disagree, permanently: the proxy lets the request through, the DAL sends the
 * visitor to `/login`, and the proxy bounces `/login` back to `/dashboard`
 * because the cookie is still there. `ERR_TOO_MANY_REDIRECTS`, and the
 * browser's own advice — "try deleting your cookies" — is the correct fix
 * applied by the wrong party.
 *
 * So any path that concludes "this session is over" must delete the evidence.
 * Only a Server Action, a Route Handler or the proxy can, which is why this is
 * a helper they share rather than something the DAL does where it finds the
 * problem.
 */

export { sessionCookieNames };

/** Does this request carry something that looks like a session cookie? */
export function hasSessionCookie(jar: { getAll(): Array<{ name: string }> }): boolean {
  // Matched by shape rather than exact name: the suffix list is Better Auth's
  // to change, and a missed name here reintroduces the redirect loop.
  return jar.getAll().some((cookie) => isSessionCookieName(cookie.name));
}

/**
 * Remove them. Returns how many were actually there, for the log line.
 *
 * **`set`, not `delete`.** Next's `delete()` omits the `Secure` attribute, and a
 * `__Secure-`-prefixed cookie cannot be expired without it — which is every
 * session cookie on an HTTPS deployment. `sessionCookieExpiry` carries the
 * reason and the evidence.
 */
export function clearSessionCookies(jar: {
  has(name: string): boolean;
  set(cookie: ReturnType<typeof sessionCookieExpiry>): unknown;
}): number {
  const present = sessionCookieNames().filter((name) => jar.has(name));
  for (const name of present) jar.set(sessionCookieExpiry(name));
  return present.length;
}
