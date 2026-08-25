import type { ProductPrice } from "@/lib/db/models/catalog";

/**
 * What the marketplace advertises: the cheapest package, per currency.
 *
 * ## Why derived and not entered
 *
 * `product.prices` is read by the grid's `activePrice`, the price filter, the
 * price sort, the cards, the detail page, JSON-LD `offers`, the admin list and
 * the upsell banner. `licencePackages[].prices` is read by the cart, the order
 * line and the payment. Both were entered by hand, nothing reconciled them, and
 * `readiness.ts` had grown a whole publish gate — `unbuyable_currency` — whose
 * only job was to notice when they disagreed.
 *
 * Deriving one from the other removes the disagreement rather than policing it.
 *
 * ## Cheapest, not first
 *
 * "From £29" is the honest claim for a product sold in tiers, and it is what a
 * customer comparing cards expects. Taking the first package instead would make
 * the advertised price depend on the order somebody happened to drag rows into.
 *
 * A currency priced in **no** package is absent from the result, which is exactly
 * right: every renderer already reads a missing row as "Price on request", and a
 * product nobody can check out in should not advertise a number.
 *
 * ## Why it lives here and not beside the section config that needed it first
 *
 * `template-sibling.ts` applies the same rule, and a service importing from
 * `features/` is the wrong direction.
 */
export function advertisedPrices(
  packages: ReadonlyArray<{ prices: readonly ProductPrice[] }>,
): ProductPrice[] {
  const cheapest = new Map<string, number>();

  for (const pkg of packages) {
    for (const price of pkg.prices) {
      const current = cheapest.get(price.currency);
      // `<`, and a zero is a real amount: a free package is the cheapest there is
      // and must win, rather than being mistaken for "no price".
      if (current === undefined || price.amount < current) {
        cheapest.set(price.currency, price.amount);
      }
    }
  }

  return [...cheapest].map(([currency, amount]) => ({ currency, amount }));
}
