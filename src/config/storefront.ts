import { isCurrencyCode, type CurrencyCode } from "@/lib/money";

/**
 * What the storefront actually sells in — §43, §84.
 *
 * Distinct from `CURRENCIES` in `lib/money.ts`, and the distinction matters.
 * That registry describes every currency the *money type* can represent
 * (eight, including JPY with its zero exponent). This list is the commercial
 * decision about which ones CoSetup offers, which is a smaller set and
 * changes for entirely different reasons.
 *
 * It lives in code rather than the database or the environment because adding a
 * currency is never just a data change: it needs a price on every product, a
 * column in the admin pricing matrix, and a decision about what happens to the
 * products that don't have one. A setting that could be flipped without that
 * work would be a trap.
 *
 * **Prices are set per currency, by hand.** Never derived from a base currency
 * with an FX rate — the business decides what a product costs in Lagos, and a
 * rate that moved overnight must not silently reprice the catalogue (§61's
 * frozen-price rule is the same instinct applied to orders).
 */
export const STOREFRONT_CURRENCIES = ["GBP", "USD", "NGN"] as const;

export type StorefrontCurrency = (typeof STOREFRONT_CURRENCIES)[number];

/** Used when a viewer has expressed no preference. */
export const DEFAULT_CURRENCY: StorefrontCurrency = "GBP";

/**
 * Set only by an explicit currency switcher, never inferred.
 *
 * Deliberately *not* derived from `Accept-Language` or geo-IP: language is not
 * currency — an `en-GB` browser in Lagos is a common case for this business,
 * not an edge case — and varying the response on a request header poisons any
 * shared cache.
 */
export const CURRENCY_COOKIE = "cosetup_currency";

/**
 * How that cookie is written — in one place, because two things write it.
 *
 * `proxy.ts` writes it when a `?currency=` navigation arrives, and
 * `switchCartCurrencyAction` writes it when the basket's own switcher is used.
 * Those are the same preference, and they were not both writing it: for a long
 * while **nothing** did, which is why the currency switch never survived leaving
 * the listing. Two independent option literals is how they would come to disagree
 * about `maxAge` or `path` and produce two cookies with one name.
 *
 * `httpOnly: false`, matching the recently-viewed cookie beside it and for the
 * same reason: this is a display preference, not a credential. `sameSite: "lax"`
 * so a link shared into a chat app still arrives with the viewer's choice intact.
 *
 * Thirty days. Long enough that a returning customer does not have to choose
 * again, short enough that a shared computer forgets.
 */
export function currencyCookieOptions(currency: StorefrontCurrency, secure: boolean) {
  return {
    name: CURRENCY_COOKIE,
    value: currency,
    httpOnly: false,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

/** Recently-viewed products (§6). Slugs, so nothing internal leaves the server. */
export const RECENTLY_VIEWED_COOKIE = "cosetup_rv";
export const RECENTLY_VIEWED_LIMIT = 8;

export function isStorefrontCurrency(value: unknown): value is StorefrontCurrency {
  return (
    typeof value === "string" &&
    isCurrencyCode(value) &&
    (STOREFRONT_CURRENCIES as readonly string[]).includes(value)
  );
}

/**
 * Narrow an untrusted string to a currency we actually sell in.
 *
 * Falls back rather than throwing: this reads a query parameter and a cookie,
 * both of which anyone can set to anything, and a malformed one should show the
 * default price rather than a 500.
 */
export function toStorefrontCurrency(value: unknown): StorefrontCurrency {
  return isStorefrontCurrency(value) ? value : DEFAULT_CURRENCY;
}

/** Widens to the money type's currency union for `money()` and `format()`. */
export function asCurrencyCode(value: StorefrontCurrency): CurrencyCode {
  return value;
}
