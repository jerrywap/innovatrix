import { describe, expect, it } from "vitest";
import { advertisedPrices } from "./advertised-price";

/**
 * The derivation every marketplace read depends on.
 *
 * `product.prices` feeds the grid's `activePrice`, the price filter, the price
 * sort, the cards, the detail page and JSON-LD `offers`. It used to be typed by
 * hand alongside the package prices, with nothing reconciling the two; it is now
 * derived from them. A wrong derivation is a wrong price on every published
 * listing at once, and nothing else in the suite would notice.
 */
describe("advertisedPrices", () => {
  const pkg = (...prices: Array<[string, number]>) => ({
    prices: prices.map(([currency, amount]) => ({ currency, amount })),
  });

  const byCurrency = (result: ReturnType<typeof advertisedPrices>) =>
    Object.fromEntries(result.map((price) => [price.currency, price.amount]));

  it("takes the cheapest package per currency, not the first", () => {
    // Ordering is a thing somebody drags rows into; it must not decide the price.
    const result = advertisedPrices([
      pkg(["GBP", 49_900], ["USD", 59_900]),
      pkg(["GBP", 29_900], ["USD", 79_900]),
    ]);

    expect(byCurrency(result)).toEqual({ GBP: 29_900, USD: 59_900 });
  });

  it("keeps a currency only one package prices", () => {
    // Not a hole: a tier sold only in NGN is still buyable in NGN.
    const result = advertisedPrices([
      pkg(["GBP", 29_900]),
      pkg(["GBP", 49_900], ["NGN", 500_000]),
    ]);

    expect(byCurrency(result)).toEqual({ GBP: 29_900, NGN: 500_000 });
  });

  it("treats zero as the cheapest price, not as no price", () => {
    // A free tier is what "Free" on a card means. Mistaking it for absent would
    // advertise the paid tier's number on a product somebody can have for nothing.
    const result = advertisedPrices([pkg(["GBP", 29_900]), pkg(["GBP", 0])]);

    expect(byCurrency(result)).toEqual({ GBP: 0 });
  });

  it("omits a currency no package prices, so nothing advertises what cannot be bought", () => {
    // This is what retired `unbuyable_currency`: the gap existed because the two
    // stores could disagree, and a derived price cannot.
    const result = advertisedPrices([pkg(["GBP", 29_900])]);

    expect(result.map((price) => price.currency)).toEqual(["GBP"]);
  });

  it("returns nothing for a package with no prices, rather than a zero", () => {
    // A brand-new draft's seeded package. `no_price` blocks publish; the card
    // shows "Price on request" — both correct, and both wrong if this invented a 0.
    expect(advertisedPrices([pkg()])).toEqual([]);
    expect(advertisedPrices([])).toEqual([]);
  });
});
