import { describe, expect, it } from "vitest";
import { DEFAULT_CURRENCY, STOREFRONT_CURRENCIES } from "@/config/storefront";
import { offeredFrom, preferredOf, transferCoverage } from "./offered-currencies";

/**
 * Which currencies the storefront may offer, as pure rules.
 *
 * The composed `offeredCurrencies()` reads the settings document and every enabled
 * driver, so it belongs to the integration half; what is worth holding here is the
 * three decisions inside it, each of which is easy to write backwards and none of
 * which a type would catch: empty transfer list means none, a missing
 * `offlineEnabled` means on, and an empty union falls back to USD rather than
 * leaving the storefront with no currency at all.
 */

describe("transferCoverage", () => {
  it("treats an empty list as none, not as all", () => {
    /*
     * The opposite of `currenciesFor`'s rule, and the reason the field exists: a
     * provider's list narrows a known ceiling, while a bank account either exists
     * or does not. Reading empty as "all" is how a transfer gets offered in a
     * currency nobody holds an account in.
     */
    expect(transferCoverage({ offlineEnabled: true, offlineCurrencies: [] }).size).toBe(0);
  });

  it("reads a missing flag as enabled, matching the schema default", () => {
    // A settings document written before `offlineEnabled` existed. Treating the
    // absence as "off" would withdraw an option nobody turned off.
    expect(transferCoverage({ offlineCurrencies: ["GBP"] } as never).has("GBP")).toBe(true);
  });

  it("takes nothing when transfer is switched off, whatever is listed", () => {
    expect(transferCoverage({ offlineEnabled: false, offlineCurrencies: ["GBP"] }).size).toBe(
      0,
    );
  });

  it("normalises case, because the field is a plain string array", () => {
    expect(
      transferCoverage({ offlineEnabled: true, offlineCurrencies: ["gbp"] }).has("GBP"),
    ).toBe(true);
  });
});

describe("offeredFrom", () => {
  it("offers a currency covered by card alone", () => {
    expect(offeredFrom(["NGN"], new Set())).toEqual(["NGN"]);
  });

  it("offers a currency covered by transfer alone", () => {
    // The whole point of the second list: no provider serves it, and we can still
    // be paid.
    expect(offeredFrom([], new Set(["GBP"]))).toEqual(["GBP"]);
  });

  it("is a union, not an intersection", () => {
    expect(offeredFrom(["NGN"], new Set(["GBP"])).sort()).toEqual(["GBP", "NGN"]);
  });

  it("keeps storefront order rather than the order of its inputs", () => {
    // So toggling a provider does not reshuffle the switcher.
    const offered = offeredFrom([...STOREFRONT_CURRENCIES].reverse(), new Set());
    expect(offered).toEqual([...STOREFRONT_CURRENCIES]);
  });

  it("falls back to the default currency when nothing is configured", () => {
    /*
     * A fresh install. It does not make a payment possible — checkout still refuses
     * — but the storefront renders in USD rather than collapsing into a site with no
     * prices and no switcher.
     */
    expect(offeredFrom([], new Set())).toEqual([DEFAULT_CURRENCY]);
  });

  it("ignores a currency the storefront does not price in", () => {
    // `offlineCurrencies` is a string array in the database, so it can hold one.
    expect(offeredFrom(["JPY"], new Set(["EUR"]))).toEqual([DEFAULT_CURRENCY]);
  });
});

describe("preferredOf", () => {
  it("prefers the default currency when it is on offer", () => {
    // So a stale `?currency=GBP` link lands somewhere predictable rather than on
    // whatever happens to sort first.
    expect(preferredOf(["NGN", DEFAULT_CURRENCY])).toBe(DEFAULT_CURRENCY);
  });

  it("takes the first offered currency when the default is not one", () => {
    expect(preferredOf(["NGN", "GBP"])).toBe("NGN");
  });
});
