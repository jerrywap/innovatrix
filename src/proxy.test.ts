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
    const response = visit("/marketplace/atlas-crm?currency=USD");

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
