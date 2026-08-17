import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { nanoid } from "nanoid";
import { RECENTLY_VIEWED_COOKIE } from "@/config/storefront";
import { REQUEST_ID_HEADER } from "@/config/observability";
import { CONVERSATION_COOKIE, conversationCookie } from "@/services/ai/conversation-cookie";
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

/** The two AI doors (tickets 17, 18). Both need an owner before they render. */
const ASSISTANT_PATH = /^\/(?:custom-software|customize)(?:\/|$)/;

/**
 * A correlation id for every request — ticket 27, §95.
 *
 * Minted here because the proxy is the only thing that runs before everything
 * else, and put on the **request** headers so a Server Component can read it
 * with `headers()`. Without that a log line from a page and a log line from the
 * action it submitted to are two unrelated lines.
 *
 * An inbound `x-request-id` is honoured, so a trace that started at a load
 * balancer or an upstream service keeps its identity. That is client-supplied
 * and is treated accordingly: it is a **log field and nothing else**, capped in
 * length, and never used for authorisation or as a key to anything.
 */
function requestId(request: NextRequest): string {
  const inbound = request.headers.get(REQUEST_ID_HEADER);
  if (inbound) return inbound.slice(0, 64);
  return nanoid(16);
}

/** Attach the id to the forwarded request, so `headers()` can read it. */
function withRequestId(request: NextRequest, id: string): Headers {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, id);
  return headers;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(getSessionCookie(request, { cookiePrefix: "innovatrix" }));
  const id = requestId(request);

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
    return withRecentlyViewed(request, productSlug, id);
  }

  /*
   * Mint the anonymous-conversation cookie before the assistant pages render.
   *
   * They need an owner key to create or resume a conversation, and a Server
   * Component cannot set a cookie — the first version of this called
   * `ensureAnonymousKey()` from the page and every visit 500'd with "Cookies
   * can only be modified in a Server Action or Route Handler". Exactly the
   * mistake ticket 09's recently-viewed cookie made, and fixed the same way.
   *
   * Only for signed-out visitors: a session already identifies the owner, and
   * an unnecessary cookie is one more thing to clear on sign-out.
   */
  if (
    !hasSessionCookie &&
    ASSISTANT_PATH.test(pathname) &&
    isAssistantVisit(request) &&
    !request.cookies.get(CONVERSATION_COOKIE)
  ) {
    return withConversationKey(request, id);
  }

  const response = NextResponse.next({ request: { headers: withRequestId(request, id) } });
  // Also on the response, so the id in a support ticket's screenshot of the
  // network tab is the same one in the logs.
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
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

/**
 * A visit that should get an anonymous conversation key.
 *
 * Deliberately *not* `isRealVisit`. That function answers "did somebody
 * deliberately open this page", and it answers it by requiring
 * `sec-fetch-dest: document` — which excludes client-side navigation on
 * purpose, because a recently-viewed rail built from hovers would be wrong.
 *
 * Applied here that trade was a bug, and an expensive one. **Every in-app route
 * to the assistant is a `<Link>`** — the header's "Get started", the footer, the
 * landing hero — and a `<Link>` sends `sec-fetch-dest: empty`. So a first-time
 * signed-out visitor got no key, `startOrResume` created a conversation owned by
 * nobody, and `assertCanRead` then refused it *to its own author*: the first
 * message came back "No such conversation."
 *
 * It looked fine to everyone who had ever loaded the page directly or pressed
 * refresh, because the cookie lasts 30 days and one document load fixes a
 * browser permanently. The database showed 9 such orphans against 21
 * conversations, every one with zero messages.
 *
 * So: mint for anything that looks like a person arriving.
 *
 * **A Next prefetch is not excluded, because it cannot be.** `next-router-prefetch`
 * is stripped before the proxy sees it — the same stripping the `isRealVisit`
 * docblock above describes, and I confirmed it by sending the header and
 * watching the cookie get minted anyway.
 *
 * That turns out not to matter here, and the difference from recently-viewed is
 * the reason. A speculative *entry* in a list is wrong — it claims the visitor
 * read something they only hovered. A speculative *key* claims nothing: it is an
 * opaque owner id, `startOrResume` resumes on it rather than inserting, and so a
 * prefetch plus the click that follows it produce one conversation, not two.
 * Verified: three requests sharing a key, one row.
 */
function isAssistantVisit(request: NextRequest): boolean {
  // Hand-written `<link rel="prefetch">`; Next does not send this one.
  if (request.headers.get("purpose") === "prefetch") return false;

  // A crawler will never hold a conversation, and it discards cookies between
  // fetches — so every crawled page would be a fresh key and a fresh row,
  // forever. Both assistant pages render a conversation-less variant instead.
  if (/bot|crawler|spider|slurp/i.test(request.headers.get("user-agent") ?? "")) return false;

  return true;
}

/**
 * Mint the key on the response **and on the forwarded request**.
 *
 * The second half is the part that is easy to miss. `response.cookies.set`
 * tells the *browser* to store it, which is enough for recently-viewed because
 * nothing reads that back in the same request. Here the page renders
 * immediately afterwards and calls `cookies()` — which reads the **request**,
 * not the response — so without forwarding it the page would see no cookie,
 * create no conversation, and the visitor would need a second page load before
 * the assistant worked.
 */
function withConversationKey(request: NextRequest, id: string): NextResponse {
  const key = nanoid(21);

  const headers = withRequestId(request, id);
  const existing = headers.get("cookie");
  headers.set(
    "cookie",
    existing ? `${existing}; ${CONVERSATION_COOKIE}=${key}` : `${CONVERSATION_COOKIE}=${key}`,
  );

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, id);

  // `x-forwarded-proto` first: behind a TLS terminator the internal hop is
  // plain HTTP, so `nextUrl.protocol` alone would drop `Secure` from a cookie
  // on a site the browser reached over HTTPS.
  const secure =
    (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) ===
    "https";

  response.cookies.set(conversationCookie(key, secure));

  return response;
}

function withRecentlyViewed(request: NextRequest, slug: string, id: string): NextResponse {
  const response = NextResponse.next({ request: { headers: withRequestId(request, id) } });
  response.headers.set(REQUEST_ID_HEADER, id);

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
   * lookahead excludes Next's internals, files with an extension, and three
   * API prefixes that must reach their handler untouched:
   *
   * - **`api/auth`** — redirecting the sign-in POST would break it.
   * - **`api/webhooks`** — ticket 13 verifies signatures over the **exact
   *   bytes**. Nothing may sit in front of that body, and running a
   *   cookie-parsing redirect in front of the most failure-sensitive route in
   *   the platform buys nothing.
   * - **`api/cron`** — authenticated by a shared secret, not a session, so a
   *   session check would only ever redirect it wrongly.
   */
  matcher: [
    "/((?!api/auth|api/webhooks|api/cron|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
