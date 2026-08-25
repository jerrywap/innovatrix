import { describe, expect, it } from "vitest";
import { isFreeIn } from "./free-claim";

/**
 * `isFreeIn` decides whether a product is handed over without payment, so the
 * absent-vs-zero distinction it rests on is worth asserting directly.
 *
 * Pure, so no database and no preamble. The same distinction is protected one
 * layer up by `advertised-price.test.ts` ("treats zero as the cheapest price, not
 * as no price"); this is the other half of it, where getting it backwards gives
 * away a paid listing rather than mispricing one.
 */
describe("isFreeIn", () => {
  it("is free when the currency is priced at zero", () => {
    expect(isFreeIn([{ currency: "GBP", amount: 0 }], "GBP")).toBe(true);
  });

  it("is not free when the currency is absent", () => {
    // The whole point. A missing row means "not sold in this currency", not
    // "free" — so a product priced only in GBP must not be given away to a
    // visitor browsing in USD.
    expect(isFreeIn([{ currency: "GBP", amount: 0 }], "USD")).toBe(false);
  });

  it("is not free when there are no prices at all", () => {
    expect(isFreeIn([], "GBP")).toBe(false);
  });

  it("is not free when the currency has a price", () => {
    expect(isFreeIn([{ currency: "GBP", amount: 2_900 }], "GBP")).toBe(false);
  });

  it("reads the asked-for currency, not the first row", () => {
    const prices = [
      { currency: "GBP", amount: 2_900 },
      { currency: "USD", amount: 0 },
    ];
    expect(isFreeIn(prices, "USD")).toBe(true);
    expect(isFreeIn(prices, "GBP")).toBe(false);
  });
});
