import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  CURRENCY_COOKIE,
  isStorefrontCurrency,
  toStorefrontCurrency,
  type StorefrontCurrency,
} from "@/config/storefront";

/**
 * Which currency this viewer sees prices in — the single answer, for the whole request.
 *
 * ## Resolution order: URL → cookie → default
 *
 * Three rungs, and still three: country detection did not add a fourth. It runs
 * in the browser and writes the **cookie**, so a detected currency arrives here
 * by the same route a chosen one does and this function cannot tell them apart —
 * which is the property that keeps the order honest.
 *
 * Explicitly **not** `Accept-Language`, and explicitly not a header read of any
 * kind. Language is not currency — an `en-GB` browser in Lagos is a normal case
 * for this business rather than an edge case, and it is the case country gets
 * right where language gets it exactly wrong — and a request header would make
 * the response vary, which poisons any shared cache and makes "copy the URL" stop
 * working. `components/shell/currency-detect.tsx` is how the country reaches us
 * without any of that.
 *
 * The URL wins over the cookie so a link somebody shares shows the prices they
 * were looking at. That is also why the detector declines to run when the URL
 * names a currency: it must never write a cookie underneath a shared link. The
 * cookie is what carries the choice off the listing, and it is written by
 * `proxy.ts`, `switchCurrencyAction` and the detector — never by a Server
 * Component, which may not set one.
 *
 * ## Why this is one function and not a two-liner at each call site
 *
 * It was the two-liner, seven times, and the copies had drifted into a visible
 * bug: the results grid read the URL first while the discovery rails read
 * **only** the cookie, so `/marketplace?currency=NGN` rendered Featured in £
 * beside a grid in ₦ — one page quoting two currencies. Three other surfaces read
 * the cookie only and so could never see a URL choice at all.
 *
 * One resolver does not fix that on its own; a component that never resolves
 * cannot disagree with one that does, which is why `rails.tsx` takes the answer
 * as a **prop**. This is the other half: everywhere that genuinely does resolve,
 * resolves identically.
 *
 * ## `cache()`
 *
 * Per-request memoisation, so several suspended children asking the same question
 * get one answer rather than N independent reads that could — in principle —
 * diverge. Keyed on the argument, so a caller that has the URL and one that does
 * not are still separate entries; that is correct, because they are asking
 * different questions.
 *
 * ## An unusable `?currency=` falls through to the cookie
 *
 * `isStorefrontCurrency` rather than `toStorefrontCurrency` on the URL half, which
 * is a behaviour change from the two-liner it replaces. `firstOf(raw.currency) ??
 * cookie` treated a *present* parameter as the answer and only narrowed it
 * afterwards, so `?currency=XYZ` — a typo, a stale link, a fuzzer — silently
 * overrode a stored NGN preference with GBP. A value that cannot be honoured
 * should leave the viewer's own choice alone rather than replace it with a default.
 */
export const resolveStorefrontCurrency = cache(
  async (rawCurrency?: string | string[]): Promise<StorefrontCurrency> => {
    const fromUrl = Array.isArray(rawCurrency) ? rawCurrency[0] : rawCurrency;
    if (isStorefrontCurrency(fromUrl)) return fromUrl;

    const jar = await cookies();
    return toStorefrontCurrency(jar.get(CURRENCY_COOKIE)?.value);
  },
);
