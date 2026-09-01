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

/**
 * Used when a viewer has expressed no preference **and none could be detected**.
 *
 * USD rather than GBP, so "somewhere we don't sell in" and "we could not tell"
 * give the same answer — `currencyForCountry` maps everywhere outside Nigeria and
 * the sterling area to USD, and it would be odd for a failed detection to land
 * somewhere a successful one never does.
 *
 * It is also the crawler's currency, and that is the part worth knowing about:
 * `details/[slug]/page.tsx` passes this to `ProductJsonLd`, which emits an
 * `offers` node only for a product priced in it. A product with no USD price
 * therefore advertises no price in its structured data. That makes pricing in USD
 * a requirement of listing rather than a nicety.
 */
export const DEFAULT_CURRENCY: StorefrontCurrency = "USD";

/**
 * Written by a switcher, or **inferred once, on the client**.
 *
 * This said "never inferred", and the sentence under it refused geo-IP. Half of
 * that reasoning was about caching and still stands; the other half turned out to
 * be an argument *for* detection rather than against it.
 *
 * - **Never from a request header.** No `Accept-Language`, no `Vary`, nothing that
 *   makes one visitor's response different from another's. That is what would
 *   poison a shared cache, and it is still forbidden. `components/shell/currency-detect.tsx`
 *   detects in the browser and writes this cookie, so every response stays
 *   byte-identical for everyone and the choice travels the way a chosen one does.
 * - **Language is still not currency**, and the example this docblock has always
 *   used is the reason to prefer IP: an `en-GB` browser in Lagos is a common case
 *   for this business, and country gets it right where `Accept-Language` gets it
 *   exactly wrong.
 *
 * Detection runs only when nothing is stored *and* the URL names no currency, so
 * it can never overwrite either a choice or a shared link.
 */
export const CURRENCY_COOKIE = "cosetup_currency";

/**
 * How that cookie is written — in one place, because three things write it.
 *
 * `proxy.ts` writes it when a `?currency=` navigation arrives — the filter
 * rail's chips — `switchCurrencyAction` writes it for both of the switchers
 * people actually use, and `adoptDetectedCurrencyAction` writes it once for a
 * detected country. All three are the same preference, and they were not all
 * writing it: for a long while **nothing** did, which is why the currency switch
 * never survived leaving the listing. Two independent option literals is how they
 * would come to disagree about `maxAge` or `path` and produce two cookies with one
 * name.
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

/**
 * The stored preference, out of a raw `Cookie` / `document.cookie` header.
 *
 * A parser rather than `header.includes(CURRENCY_COOKIE)` in the caller, because
 * cookie names substring-match by accident — `cosetup_currency_x` contains this
 * one — and the detector's "is anything stored?" check decides whether it runs at
 * all. Wrong in one direction it never detects; wrong in the other it detects on
 * every page load forever.
 *
 * A stored value we no longer sell in reads as nothing stored, so detection gets
 * to replace it rather than the viewer being stuck with a dead preference.
 */
export function storedCurrency(cookieHeader: string): StorefrontCurrency | undefined {
  for (const pair of cookieHeader.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    if (pair.slice(0, at).trim() !== CURRENCY_COOKIE) continue;

    const value = pair.slice(at + 1).trim();
    return isStorefrontCurrency(value) ? value : undefined;
  }
  return undefined;
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

/* ────────────────────────────────────────────── country → currency */

/**
 * The countries that get something other than the default.
 *
 * Short on purpose. We sell in three currencies, so this is not a table of the
 * world's money — it is the two places where the answer is not USD.
 *
 * The Crown dependencies are in it because sterling is what circulates there;
 * Ireland deliberately is not, since it uses the euro and USD is the closer
 * answer of the three we have. ISO 3166-1 alpha-2, `GB` and not `UK`, which is
 * both what `lib/countries.ts` uses and what `api.country.is` returns.
 */
export const CURRENCY_BY_COUNTRY: Readonly<Record<string, StorefrontCurrency>> = {
  NG: "NGN",
  GB: "GBP",
  IM: "GBP",
  JE: "GBP",
  GG: "GBP",
};

/**
 * What to price in for a visitor in this country — or `undefined` if that is not
 * a country.
 *
 * The `undefined` is the whole reason this is not a one-line lookup with a
 * default. It separates "somewhere we map to USD" from "we could not read an
 * answer", and the caller needs the difference: a garbled or empty response must
 * write **no** cookie, so the next page load can try again, rather than storing
 * the default for thirty days as though it had been detected.
 */
export function currencyForCountry(value: unknown): StorefrontCurrency | undefined {
  if (typeof value !== "string") return undefined;

  const code = value.trim().toUpperCase();
  // Exactly two letters. Anything else is a name, a typo, or an alpha-3 code, and
  // guessing at it is how "Nigeria" would quietly become USD.
  if (!/^[A-Z]{2}$/.test(code)) return undefined;

  return CURRENCY_BY_COUNTRY[code] ?? "USD";
}

/* ────────────────────────────────────────────── vendor storefront visibility */

/**
 * The parts of a vendor storefront staff may switch off.
 *
 * ## The line, and why it is drawn here
 *
 * Every entry is something the **vendor supplied**: their prose, their link,
 * their artwork, the country they declared. A vendor's website URL is validated
 * as a URL and never reviewed, so until now the only way to deal with one being
 * abused was to suspend the vendor — unlisting their whole catalogue over a link.
 * This list is the control between "fine" and "gone".
 *
 * Deliberately absent, and it is the more important half of the decision:
 * `displayName`, `identityVerified`, `rating`, `sellingSince` and the product
 * count. Those are the **platform's own** claims, or the page's structure. A
 * rating staff can hide is a rating nobody should believe — which is the same
 * argument `VendorDoc.ratingSum` already makes about being derived and
 * uneditable by anyone, staff included.
 *
 * Adding an entry here is therefore not a small change: it moves a fact from
 * "ours" to "theirs, and revocable".
 */
export const STOREFRONT_FIELDS = ["cover", "logo", "summary", "website", "location"] as const;

export type StorefrontField = (typeof STOREFRONT_FIELDS)[number];

/**
 * How each is named to staff and to the vendor.
 *
 * One map, two audiences, on purpose: the staff toggle and the vendor's "we have
 * hidden this" note must call the same thing the same thing, or a support
 * conversation is two people describing different screens.
 */
export const STOREFRONT_FIELD_LABELS: Readonly<Record<StorefrontField, string>> = {
  cover: "Cover image",
  logo: "Logo",
  summary: "Summary",
  website: "Website link",
  location: "Location",
};

/**
 * What a storefront shows when nobody has decided otherwise.
 *
 * Everything, and that is what makes this change invisible on deploy: an empty
 * `storefrontSettings` collection and a vendor with no overrides render exactly
 * the page they rendered before any of this existed.
 */
export const STOREFRONT_FIELDS_SHOWN_BY_DEFAULT = true;
