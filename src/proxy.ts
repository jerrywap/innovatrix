import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { RECENTLY_VIEWED_COOKIE } from "@/config/storefront";
import {
  pushRecentlyViewed,
  recentlyViewedCookieOptions,
  serialiseRecentlyViewed,
} from "@/services/marketplace/recently-viewed";

/**
 * Proxy — optimistic routing only (Next.js 16 renamed `middleware.ts` to
 * `proxy.ts`).
 *
 * ## This file is not authorization
 *
 * It answers one question — "is there plausibly a session?" — by looking at a
 * cookie. It does not validate the cookie, read the database, or know anything
 * about roles. A forged cookie gets past it, and that is fine, because every
 * page and server action behind it independently calls the DAL
 * (`src/lib/auth/dal.ts`), which is where authorization actually happens.
 *
 * Its job is purely to spare a signed-out visitor a round trip that would only
 * end in a redirect.
 *
 * ## Why there is no database access here
 *
 * The proxy runs on **prefetches**. Next.js prefetches links on hover and in
 * the viewport, so a database query here would multiply traffic by the number
 * of links on a page — for navigations the user never makes. It also runs
 * before the route is rendered, potentially at the CDN edge, where a database
 * connection may not exist at all.
 *
 * `getSessionCookie` is cookie parsing and nothing else; it makes no network
 * call. Keep it that way — if a change here needs the database, the check
 * belongs in the DAL instead.
 *
 * Staff and admin areas deliberately get the *same* treatment as the dashboard:
 * we cannot tell staff from customer without reading the database, so the
 * proxy only checks for a session and `requireStaff()` does the rest.
 *
 * ## The one thing it writes: recently-viewed
 *
 * A cookie, and **it has to be here**. Next.js does not allow a Server
 * Component to set a cookie — only a Server Action or a Route Handler can, and
 * a product page is neither. Attempting it from the page throws, which a
 * `try/catch` then swallows, and the feature silently never works. That is
 * exactly what happened before this moved.
 *
 * It is still not a database read: the value is the slug from the path.
 */

/** Prefixes that need a session. Everything else is public. */
const PROTECTED_PREFIXES = ["/dashboard", "/staff", "/admin"] as const;

/** Auth pages a signed-in user has no reason to see. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password"] as const;

/** `/marketplace/<slug>` — but not `/marketplace/category/...` or `/industry/...`. */
const PRODUCT_PATH = /^\/marketplace\/(?!category\/|industry\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(getSessionCookie(request, { cookiePrefix: "innovatrix" }));

  if (!hasSessionCookie && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const login = new URL("/login", request.url);
    // Preserve where they were going, so signing in doesn't dump them on a
    // dashboard they didn't ask for. Path only — an absolute URL here would be
    // an open redirect.
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (hasSessionCookie && AUTH_PAGES.some((p) => pathname === p)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const productSlug = PRODUCT_PATH.exec(pathname)?.[1];
  if (productSlug && isRealVisit(request)) {
    return withRecentlyViewed(request, productSlug);
  }

  return NextResponse.next();
}

/**
 * Is this a real visit, rather than a hover or a crawl?
 *
 * ## `Sec-Fetch-Dest`, because the obvious signals are not there
 *
 * The documented signal is `next-router-prefetch: 1`, and it was the first
 * thing written here. **It never fires.** Next.js consumes the RSC protocol
 * headers — and strips the `_rsc` search parameter — before the proxy runs;
 * logging every header the proxy receives shows none of them, even when the
 * client demonstrably sent them.
 *
 * `Sec-Fetch-Dest` survives, and every browser sends it:
 *
 * | request              | `sec-fetch-dest` |
 * |----------------------|------------------|
 * | page load            | `document`       |
 * | prefetch             | `empty`          |
 * | client-side navigation | `empty`        |
 *
 * So the test is inverted — record a *document* navigation rather than try to
 * exclude a prefetch. The guarantee then holds without depending on a header
 * that is not there.
 *
 * The cost is the third row: a client-side navigation between two product
 * pages is missed. That trade is deliberate. A product absent from the rail is
 * a small loss; a rail full of links the visitor only hovered over is actively
 * wrong — an eight-item list would be four accidents and the one page they
 * actually read.
 *
 * Note `curl` sends no `Sec-Fetch-Dest` at all, which is why the fallback below
 * treats an absent header as a real visit: without it, every scripted check of
 * this behaviour would silently pass for the wrong reason.
 */
function isRealVisit(request: NextRequest): boolean {
  // Sent by browsers for `<link rel="prefetch">`, which Next does not use but
  // a hand-written one in a layout might.
  if (request.headers.get("purpose") === "prefetch") return false;

  // A crawler has no browsing history worth keeping, and writing one per
  // crawled page is work for nobody.
  if (/bot|crawler|spider|slurp/i.test(request.headers.get("user-agent") ?? "")) return false;

  const destination = request.headers.get("sec-fetch-dest");
  return destination === null || destination === "document";
}

function withRecentlyViewed(request: NextRequest, slug: string): NextResponse {
  const response = NextResponse.next();

  const next = pushRecentlyViewed(request.cookies.get(RECENTLY_VIEWED_COOKIE)?.value, slug);

  response.cookies.set({
    ...recentlyViewedCookieOptions(request.nextUrl.protocol === "https:"),
    value: serialiseRecentlyViewed(next),
  });

  return response;
}

export const config = {
  /**
   * Without a matcher this would run on every static asset. The negative
   * lookahead excludes Next's internals, the auth endpoints themselves (which
   * must never be redirected — that would break the sign-in POST), and files
   * with an extension.
   */
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
