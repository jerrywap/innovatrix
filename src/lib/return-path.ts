import type { Route } from "next";

/**
 * Where somebody was going before we asked them to sign in — §88.
 *
 * ## Why this is its own module
 *
 * It was two of these, in two places that could not import each other.
 * `safeRedirectPath` lived in `features/auth/schemas.ts`, which `proxy.ts`
 * cannot reach — the proxy runs on the Edge runtime and that module pulls in
 * Zod and the rest of a feature. So the proxy hand-rolled the same three checks,
 * and `services/marketplace/query.ts` hand-rolled them a third time as a private
 * `safePath`. One rule, written out three times, is one rule that will diverge.
 *
 * This file therefore imports **nothing but a type**: no Zod, no `next/*`, no
 * `server-only`. That is the constraint that lets the proxy, a Server Action, a
 * Route Handler and a page all ask the same question.
 *
 * ## The cookie is here too, and not in `config/`
 *
 * Because the validator and the cookie are one mechanism: the cookie's *value*
 * is only ever something `safeRedirectPath` has already approved, and putting
 * them in separate files is how a raw destination eventually gets stored.
 */

/**
 * Where to send someone after signing in.
 *
 * Only same-origin *paths* are honoured. `//evil.com` and `https://evil.com`
 * are both valid values of a `next` query parameter and both are open
 * redirects — the second slash check is the one that catches the protocol-
 * relative form.
 *
 * ## The cast
 *
 * `typedRoutes` makes `redirect()` and `<Link href>` take a `Route`, and this
 * is the one place in the codebase where that guarantee cannot hold: the value
 * arrives from a query string at runtime, so no compile-time check can know
 * whether `/dashboard/orders/ORD-2026-0148` exists.
 *
 * This function is therefore the boundary. Everything it returns has been
 * proven to be a same-origin path, and the cast is confined here rather than
 * scattered across each caller — where the next person would copy it without
 * the validation.
 */
export function safeRedirectPath(
  next: string | undefined,
  fallback: Route = "/dashboard",
): Route {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next as Route;
}

/**
 * The same check, for the case where "no redirect" is a real answer.
 *
 * A page rendering a form needs to know whether to *include* a hidden `next`
 * field at all. Passing `""` as the fallback to `safeRedirectPath` was the
 * previous way of asking that, and `""` is not a route — it only compiled
 * before `typedRoutes` was turned on.
 */
export function optionalRedirectPath(next: string | undefined): Route | undefined {
  if (!next) return undefined;
  const resolved = safeRedirectPath(next, "/dashboard");
  // safeRedirectPath falls back when the input is unsafe; treat that as "none"
  // rather than silently redirecting somewhere the caller didn't ask for.
  return resolved === "/dashboard" && next !== "/dashboard" ? undefined : resolved;
}

/**
 * The auth screens themselves, which are never a destination.
 *
 * `loginDestination()` builds `/login?next=<where you are>` from the forwarded
 * path, and on `/login` that is `/login` — a redirect to itself, and a loop the
 * moment anything retries. The register and forgot-password screens are the same
 * shape: somebody who lands on one of them has not arrived anywhere they wanted
 * to come back to.
 *
 * Prefix matching, not equality, because `/reset-password/<token>` and
 * `/accept-invite?id=` both carry one-shot credentials in the URL. Storing one
 * for ten minutes and replaying it later is worse than losing the destination.
 */
const AUTH_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invite",
] as const;

export function isAuthPath(pathAndSearch: string | null | undefined): boolean {
  if (!pathAndSearch) return false;
  const path = pathAndSearch.split("?")[0] ?? "";
  return AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`));
}

/**
 * `/login?next=…`, or a bare `/login` when there is nowhere worth returning to.
 *
 * One builder so the parameter is spelled the same everywhere. `next` is the
 * only spelling in use in this codebase; `callbackUrl`, `returnTo` and `from`
 * appear nowhere, and adding a second would mean every consumer has to read both.
 */
export function loginPath(returnTo: string | null | undefined, base = "/login"): Route {
  const next = optionalRedirectPath(returnTo ?? undefined);
  if (!next || isAuthPath(next)) return base as Route;

  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}next=${encodeURIComponent(next)}` as Route;
}

/* ────────────────────────────────────────────── the cookie */

/**
 * The destination, parked for the length of one sign-in.
 *
 * ## Why a cookie as well as `?next=`
 *
 * Three hops in this flow **cannot carry a query string**, and they are the ones
 * that were losing the destination:
 *
 * - **The verification email.** `confirmationLanding()` rewrites its callback to
 *   a constant `/verify-email`, deliberately — the email is written before anyone
 *   knows where the person was going, and a destination baked into a link that
 *   sits in an inbox for an hour is worse than one that expires with the journey.
 * - **`/login?expired=1`**, which the DAL and the proxy hand to each other to
 *   break a redirect loop.
 * - **The proxy's "you are already signed in" bounce off an auth page.**
 *
 * So the URL carries it where it can and this carries it where it cannot. The
 * URL always wins where both exist — a fresh link must beat a stale cookie.
 *
 * ## Ten minutes
 *
 * Long enough for a sign-in, a password manager and a verification email;
 * short enough that an abandoned journey does not teleport somebody an hour
 * later from a page they navigated to deliberately. It is also cleared the
 * moment it is consumed, so the expiry only covers journeys nobody finished.
 *
 * `httpOnly: true`, unlike the currency and recently-viewed cookies beside it:
 * nothing in the browser reads this, and a value that becomes a redirect target
 * has no business being writable by a script on the page.
 */
export const RETURN_COOKIE = "cosetup_return";

const RETURN_COOKIE_MAX_AGE = 60 * 10;

export function returnCookieOptions(path: Route, secure: boolean) {
  return {
    name: RETURN_COOKIE,
    value: path,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: RETURN_COOKIE_MAX_AGE,
  };
}

/**
 * The same cookie, expired.
 *
 * `maxAge: 0` rather than a delete, so it can travel in the same `CookieToSet[]`
 * collection the proxy already applies — and so consuming it is one shape
 * whether the consumer is an action, a route handler or the proxy.
 */
export function clearedReturnCookie(secure: boolean) {
  return { ...returnCookieOptions("/" as Route, secure), value: "", maxAge: 0 };
}

/**
 * The parked destination, if there is a usable one.
 *
 * Re-validated on the way out rather than trusted because it was validated on
 * the way in. The cookie is `httpOnly` and we wrote it, but a value that becomes
 * a `redirect()` should be proven by the code that redirects, not by the code
 * that stored it a request earlier.
 */
export function storedReturnPath(value: string | undefined): Route | undefined {
  const next = optionalRedirectPath(value);
  return next && !isAuthPath(next) ? next : undefined;
}
