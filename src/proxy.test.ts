import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { CURRENCY_COOKIE } from "@/config/storefront";
import { proxy } from "./proxy";

/**
 * The currency-cookie gate — a decision that fails invisibly in **both** directions.
 *
 * Get it wrong one way and the preference never sticks, which is the bug this
 * work exists to fix and which went unnoticed for as long as it did precisely
 * because a page showing GBP looks like a page working correctly. Get it wrong
 * the other way and merely *scrolling* the filter rail changes your currency,
 * because Next prefetches links that enter the viewport — a symptom nobody would
 * report as "the prefetch gate is missing", only as "the prices keep changing".
 *
 * Neither is visible in a screenshot, and no other assertion in the suite covers
 * the proxy at all. Behaviour only: nothing here walks the filesystem, so it is
 * not a fifteenth enforcement test.
 */

function visit(
  url: string,
  headers: Record<string, string> = { "sec-fetch-dest": "document" },
) {
  return proxy(new NextRequest(new URL(url, "http://localhost:3000"), { headers }));
}

/**
 * What the *page* will see when it calls `cookies()`.
 *
 * `response.cookies` is what the browser is told to store; the page renders in
 * this same request and reads the **request**. `NextResponse.next({ request: {
 * headers } })` encodes those onto `x-middleware-request-*`, which is a Next
 * internal — asserted here anyway, because the alternative is not asserting the
 * half of the mechanism that decides whether a shared link works on its first
 * load or only its second.
 */
const forwardedCookie = (response: ReturnType<typeof proxy>) =>
  response.headers.get("x-middleware-request-cookie");

describe("currency preference", () => {
  it("stores a valid ?currency= on a document navigation, and forwards it", () => {
    const response = visit("/marketplace?currency=NGN");

    expect(response.cookies.get(CURRENCY_COOKIE)?.value).toBe("NGN");
    // Without the forward, a shared `?currency=NGN` link renders GBP on the
    // first load and NGN only after a refresh.
    expect(forwardedCookie(response)).toContain(`${CURRENCY_COOKIE}=NGN`);
  });

  it("ignores a prefetch, so scrolling the rail into view changes nothing", () => {
    // The reason the currency chips are plain `<a>` and not `<Link>`: a `<Link>`
    // click and Next's in-viewport prefetch of the same href are both
    // `sec-fetch-dest: empty`, so the click cannot be told from the hover.
    const response = visit("/marketplace?currency=NGN", { "sec-fetch-dest": "empty" });

    expect(response.cookies.get(CURRENCY_COOKIE)).toBeUndefined();
  });

  it("ignores a crawler", () => {
    const response = visit("/marketplace?currency=NGN", {
      "sec-fetch-dest": "document",
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
    });

    expect(response.cookies.get(CURRENCY_COOKIE)).toBeUndefined();
  });

  it("emits no Set-Cookie when the value is already stored", () => {
    // `marketplaceHref` carries `currency` on every link once it is in the URL,
    // so without this every later page view would re-set the same cookie — and a
    // response carrying `Set-Cookie` is one a shared cache must not store.
    const response = visit("/marketplace?currency=NGN", {
      "sec-fetch-dest": "document",
      cookie: `${CURRENCY_COOKIE}=NGN`,
    });

    expect(response.cookies.get(CURRENCY_COOKIE)).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("stores nothing for a currency we do not sell in", () => {
    // A typo or a stale link must not overwrite a real preference with the
    // default — `resolveStorefrontCurrency` falls through to the cookie for the
    // same reason.
    const response = visit("/marketplace?currency=XYZ", {
      "sec-fetch-dest": "document",
      cookie: `${CURRENCY_COOKIE}=NGN`,
    });

    expect(response.cookies.get(CURRENCY_COOKIE)).toBeUndefined();
    expect(forwardedCookie(response)).toBe(`${CURRENCY_COOKIE}=NGN`);
  });

  it("stores nothing when the URL says nothing", () => {
    expect(visit("/marketplace").cookies.get(CURRENCY_COOKIE)).toBeUndefined();
  });
});

describe("two cookies on one response", () => {
  it("records a product view and the currency together", () => {
    /*
     * The restructure this test exists for. Each cookie used to be written by a
     * function that returned its own response, so the first one that matched won
     * and the rest were silently skipped — and a product URL carrying a currency
     * is exactly the case where two match.
     */
    const response = visit("/details/atlas-crm?currency=USD");

    expect(response.cookies.get(CURRENCY_COOKIE)?.value).toBe("USD");
    expect(response.cookies.get("cosetup_rv")?.value).toContain("atlas-crm");
  });
});

describe("the request id survives all of it", () => {
  it("is on the response and on the forwarded request", () => {
    // Every log line correlates through this. The failure mode of losing it in a
    // refactor is a silent null correlation id, which is only discovered later,
    // while reading logs about something else.
    const response = visit("/marketplace?currency=NGN");
    const id = response.headers.get("x-request-id");

    expect(id).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(id);
  });

  it("honours an inbound one, capped", () => {
    const response = visit("/marketplace", {
      "sec-fetch-dest": "document",
      "x-request-id": "a".repeat(200),
    });

    expect(response.headers.get("x-request-id")).toBe("a".repeat(64));
  });
});

/**
 * The stale-session handshake — the half of `loginDestination()` that lives here.
 *
 * A cookie that exists and no longer validates puts the proxy and the DAL in
 * permanent disagreement: the proxy passes `/dashboard` through on presence, the
 * DAL refuses on validity, and the proxy bounces the resulting `/login` back to
 * `/dashboard`. The escape used to be a Route Handler, and Cache Components took
 * it away — once the static shell is flushed the DAL's `redirect()` is carried
 * out by the client router, which cannot render a Route Handler and stops on a
 * blank page. So the clearing happens here, before anything is written.
 *
 * Behaviour, not convention: nothing below walks the filesystem.
 */
describe("clearing a stale session", () => {
  const withSession = (path: string, cookie = "cosetup.session_token=stale.garbage") =>
    visit(path, { "sec-fetch-dest": "document", cookie });

  it("bounces a bare /login, because a cookie is normally a real session", () => {
    expect(withSession("/login").headers.get("location")).toContain("/dashboard");
  });

  it("does not bounce /login?expired=1 — that URL is the way out", () => {
    const response = withSession("/login?expired=1");
    // No redirect: the sign-in form has to be allowed to render.
    expect(response.headers.get("location")).toBeNull();
  });

  it("expires the session cookie so the next click isn't the same dead end", () => {
    const response = withSession("/login?expired=1");
    expect(response.cookies.get("cosetup.session_token")?.value).toBe("");
  });

  it("expires the __Secure- spelling WITH Secure, or the browser discards it", () => {
    // The defect that made the loop permanent on HTTPS. `cookies().delete()`
    // omits `Secure`, and a `__Secure-` cookie cannot be expired without it —
    // so the live session cookie on any real deployment survived every attempt
    // to clear it. Invisible locally, where APP_URL is http.
    const secure = withSession(
      "/login?expired=1",
      "__Secure-cosetup.session_token=stale.garbage",
    ).cookies.get("__Secure-cosetup.session_token");

    expect(secure?.value).toBe("");
    expect(secure?.secure, "a __Secure- cookie cannot be expired without it").toBe(true);
  });

  it("expires the pre-rebrand prefix too", () => {
    expect(
      withSession("/login?expired=1", "innovatrix.session_token=stale.garbage").cookies.get(
        "innovatrix.session_token",
      )?.value,
    ).toBe("");
  });

  it("expires only what the request carries, not all twelve spellings", () => {
    const written = withSession("/login?expired=1").cookies.getAll();
    expect(written.map((c) => c.name)).toEqual(["cosetup.session_token"]);
  });

  it("leaves a signed-out visitor's /login alone", () => {
    const response = visit("/login?expired=1");
    expect(response.headers.get("location")).toBeNull();
    // Nothing to clear, so nothing is written — a signed-out visitor should not
    // collect a handful of expiry cookies for visiting the sign-in page.
    expect(response.cookies.get("cosetup.session_token")).toBeUndefined();
  });
});

/**
 * The current URL, forwarded so a layout can build links from it.
 *
 * The public header has no `searchParams` and no pathname, and the currency
 * switcher's hrefs are "where you are, with `?currency=` rewritten". This is how
 * it finds out where you are.
 */
describe("the forwarded path", () => {
  it("carries pathname and search, and no origin", () => {
    const response = visit("/marketplace?category=crm&page=2");
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
      "/marketplace?category=crm&page=2",
    );
  });

  it("overwrites an inbound value rather than honouring it", () => {
    /*
     * The opposite rule from `x-request-id`, which is deliberately honoured so a
     * trace keeps its identity. This value is rendered into an `href`, so a
     * client-supplied one would be an open redirect waiting to be built.
     */
    const response = visit("/marketplace", {
      "sec-fetch-dest": "document",
      "x-pathname": "https://evil.example/",
    });

    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/marketplace");
  });
});
