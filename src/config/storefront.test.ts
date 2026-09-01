import { describe, expect, it } from "vitest";
import {
  CURRENCY_BY_COUNTRY,
  CURRENCY_COOKIE,
  currencyCookieOptions,
  currencyForCountry,
  DEFAULT_CURRENCY,
  STOREFRONT_CURRENCIES,
  storedCurrency,
} from "./storefront";

/**
 * The whole testable surface of first-visit currency detection.
 *
 * The detector itself is a client component and cannot be tested here: both
 * Vitest projects run `environment: "node"`, so no React component in this repo
 * renders in a test. That is why the logic is in this module and the component is
 * a shell around it — and it is why the effect's own behaviour (runs once, skips
 * a URL that names a currency, writes nothing on failure) is verified in a
 * browser instead. No test would have caught a mistake in it.
 */

describe("currencyForCountry", () => {
  it("maps the two places that are not the default", () => {
    expect(currencyForCountry("NG")).toBe("NGN");
    expect(currencyForCountry("GB")).toBe("GBP");
  });

  it("gives sterling to the Crown dependencies and not to Ireland", () => {
    // Sterling circulates in all three. Ireland uses the euro, which we do not
    // sell in, so USD is the closest of the three we have.
    expect(currencyForCountry("IM")).toBe("GBP");
    expect(currencyForCountry("JE")).toBe("GBP");
    expect(currencyForCountry("GG")).toBe("GBP");
    expect(currencyForCountry("IE")).toBe("USD");
  });

  it("gives USD to everywhere else", () => {
    for (const code of ["US", "FR", "ZA", "KE", "IN", "AU"]) {
      expect(currencyForCountry(code)).toBe("USD");
    }
  });

  it("accepts what the endpoint sends, whatever its case", () => {
    expect(currencyForCountry("ng")).toBe("NGN");
    expect(currencyForCountry(" gb ")).toBe("GBP");
  });

  /**
   * The branch the caller depends on.
   *
   * `undefined` means "that was not a country", and the detector writes no cookie
   * for it — so a truncated body or an error page lets the next hard load try
   * again. Returning the default instead would look like a successful detection
   * and stick for thirty days.
   */
  it("returns undefined for anything that is not a two-letter code", () => {
    for (const value of ["", " ", "G", "GBR", "Nigeria", "12", null, undefined, 42, {}]) {
      expect(currencyForCountry(value)).toBeUndefined();
    }
  });

  it("cannot name a currency the storefront does not sell in", () => {
    // The map is hand-written, and a fourth currency added to it without a price
    // on every product is the trap `STOREFRONT_CURRENCIES` exists to describe.
    for (const currency of Object.values(CURRENCY_BY_COUNTRY)) {
      expect(STOREFRONT_CURRENCIES).toContain(currency);
    }
    expect(STOREFRONT_CURRENCIES).toContain(DEFAULT_CURRENCY);
  });
});

describe("storedCurrency", () => {
  it("finds the cookie among others", () => {
    expect(storedCurrency(`theme=dark; ${CURRENCY_COOKIE}=NGN; cosetup_rv=a%2Cb`)).toBe("NGN");
    expect(storedCurrency(`${CURRENCY_COOKIE}=GBP`)).toBe("GBP");
  });

  /**
   * The reason this is a parser and not `header.includes(CURRENCY_COOKIE)`.
   *
   * Cookie names substring-match by accident, and this answers "has the visitor a
   * preference?" — the question that decides whether detection runs at all. A
   * false positive means it never runs; a false negative means it runs on every
   * page load for ever.
   */
  it("is not fooled by a name that merely contains ours", () => {
    expect(storedCurrency(`${CURRENCY_COOKIE}_backup=NGN`)).toBeUndefined();
    expect(storedCurrency(`old_${CURRENCY_COOKIE}=NGN`)).toBeUndefined();
  });

  it("reads a currency we no longer sell in as no preference at all", () => {
    // So detection replaces a dead value rather than the viewer being stuck with
    // it. `resolveStorefrontCurrency` already falls back for the same reason.
    expect(storedCurrency(`${CURRENCY_COOKIE}=EUR`)).toBeUndefined();
    expect(storedCurrency(`${CURRENCY_COOKIE}=`)).toBeUndefined();
  });

  it("handles an empty and a malformed header", () => {
    expect(storedCurrency("")).toBeUndefined();
    expect(storedCurrency("nonsense")).toBeUndefined();
  });
});

describe("currencyCookieOptions", () => {
  it("round-trips through the reader", () => {
    // The two halves of one preference: what the three server writers set, and
    // what the detector reads to decide whether to run at all.
    const { name, value } = currencyCookieOptions("USD", false);
    expect(storedCurrency(`${name}=${value}`)).toBe("USD");
  });
});
