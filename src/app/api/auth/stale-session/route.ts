import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv } from "@/config/env";
import { log } from "@/lib/logger";
import { safeRedirectPath } from "@/features/auth/schemas";
import { clearSessionCookies } from "@/lib/auth/session-cookies";

/**
 * Clear a session cookie the server no longer accepts, then send them to login.
 *
 * ## The loop this exists to break
 *
 * `proxy.ts` guards `/dashboard`, `/staff` and `/admin` **optimistically**: it
 * checks that a session cookie is *present* and never reads the database, which
 * is what keeps it at zero queries per request. The DAL checks whether the
 * session is *valid*.
 *
 * Those two agree except in one state — a cookie that exists and has expired —
 * and there they disagree permanently:
 *
 * ```
 * GET /dashboard  → proxy sees a cookie, lets it through
 *                 → DAL finds no session, redirect("/login")
 * GET /login      → proxy sees a cookie, redirect("/dashboard")
 * GET /dashboard  → …
 * ```
 *
 * The browser gives up with `ERR_TOO_MANY_REDIRECTS` and the advice it offers —
 * "try deleting your cookies" — is exactly right, which is the tell that the
 * server should have done it.
 *
 * ## Nothing redirects here any more
 *
 * It used to be where `loginDestination()` sent a stale session, because a
 * layout cannot delete a cookie and a Route Handler can. That stopped working
 * when Cache Components began flushing the static shell before the guard ran:
 * the DAL's `redirect()` then arrives as a client-side `NEXT_REDIRECT` under
 * `200 OK`, and the client router cannot render a Route Handler — it fetches
 * one as RSC, gets a bodyless redirect, and stops on a blank page, with the
 * cookie still in place. The clearing moved to `proxy.ts`, which runs before
 * anything is flushed. See `loginDestination()` for the full account.
 *
 * This route stays because a **document** navigation to it still works, which
 * makes it the escape hatch when JavaScript is off or the client router is
 * wedged: it is the URL to give somebody in a support conversation instead of
 * "clear your cookies".
 *
 * ## Not a sign-out
 *
 * It does not call Better Auth's sign-out: there is no valid session to end, and
 * calling it would be one database round trip to be told so. This removes the
 * client-side evidence of a session the server already forgot.
 *
 * `api/auth` is excluded from the proxy's matcher, so this route cannot itself
 * be caught by the redirect it is breaking.
 */

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get("next") ?? undefined, "/dashboard");

  const jar = await cookies();

  const cleared = clearSessionCookies(jar);

  // Worth a log line: a burst of these means sessions are being rejected that
  // the browser still believes in, which is a configuration problem (a changed
  // `AUTH_SECRET`, a clock skew) rather than people idling out.
  log.warn("Cleared a stale session cookie", {
    code: "auth.stale_session",
    cleared,
  });

  const login = new URL("/login", serverEnv().APP_URL);
  login.searchParams.set("expired", "1");
  // Where they were trying to go, so signing in again finishes the journey.
  if (next !== "/dashboard") login.searchParams.set("next", next);

  return NextResponse.redirect(login);
}
