import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { DEFAULT_CURRENCY, STOREFRONT_CURRENCIES } from "@/config/storefront";
import type { StorefrontCurrency } from "@/config/storefront";
import { CACHE_PROFILE, PAYMENT_SETTINGS_TAG } from "@/services/catalog/cache";
import type { PaymentSettingsDoc } from "@/lib/db/models/commerce";
import { getPaymentSettings, providersFor } from "./registry";

/**
 * Which currencies the storefront may actually offer today.
 *
 * ## The distinction this file exists to draw
 *
 * There are three lists and they are not the same thing:
 *
 * | | |
 * |---|---|
 * | `CURRENCIES` (`lib/money.ts`) | what the money *type* can represent — eight |
 * | `STOREFRONT_CURRENCIES` | what the business prices in — three, in code |
 * | this | what an admin has configured a way to be **paid** in — runtime |
 *
 * The vocabulary stays in code, and deliberately: `storefront.ts` argues that
 * adding a currency "needs a price on every product, a column in the admin pricing
 * matrix, and a decision about what happens to the products that don't have one",
 * and that reasoning is untouched by this. Keeping it a literal tuple is also what
 * keeps `StorefrontCurrency` a union rather than `string`, and with it six
 * `z.enum(STOREFRONT_CURRENCIES)` action validators.
 *
 * What changes is *availability*, which was never a commercial decision and has
 * always lived in `PaymentSettings`. Before this, only two surfaces asked —
 * tipping and the checkout card gate — so the storefront offered GBP whether or
 * not anything could charge in GBP, and the refusal arrived at the last click.
 *
 * **Vocabulary in code, availability in data.**
 *
 * ## Two ways to be paid
 *
 * A card provider (`providersFor`), or a bank transfer into an account we actually
 * hold (`offlineCurrencies`). The second needed its own field because a transfer
 * has no provider to ask and enabling it would otherwise make every currency
 * payable by assumption — see `PaymentSettingsDoc.offlineCurrencies`.
 *
 * ## Never empty
 *
 * A platform with nothing configured still has to render. It falls back to
 * `DEFAULT_CURRENCY` so the storefront stays coherent rather than collapsing into a
 * page with no prices and no switcher.
 *
 * That fallback does **not** make a payment possible — there is no provider to make
 * one with, and checkout still says so. What it buys is a site that looks
 * unconfigured rather than broken, which is the state a fresh install is genuinely
 * in.
 */
async function read(): Promise<StorefrontCurrency[]> {
  "use cache";
  cacheTag(PAYMENT_SETTINGS_TAG);
  cacheLife(CACHE_PROFILE.paymentSettings);

  const settings = await getPaymentSettings();
  const transfer = transferCoverage(settings);

  const card: StorefrontCurrency[] = [];
  for (const currency of STOREFRONT_CURRENCIES) {
    if ((await providersFor(currency)).length > 0) card.push(currency);
  }

  return offeredFrom(card, transfer);
}

/**
 * The currencies a bank transfer can be received in, from the settings document.
 *
 * Pure, exported and tested — the two rules in it are both easy to get backwards
 * and neither is visible at the call site.
 *
 * **Empty means none**, unlike `currenciesFor`. The asymmetry is deliberate and the
 * reason is on the field: a provider's list narrows a known ceiling, so an empty
 * narrowing reads as "unset"; a bank account either exists or does not.
 *
 * **A missing `offlineEnabled` means on**, matching the schema default and
 * `settings-view`'s reading of the same field. A settings document written before
 * the flag existed has no value, and treating that as "off" would withdraw a
 * transfer option nobody turned off.
 */
export function transferCoverage(
  settings: Pick<PaymentSettingsDoc, "offlineEnabled" | "offlineCurrencies">,
): Set<string> {
  if (!(settings.offlineEnabled ?? true)) return new Set();
  return new Set((settings.offlineCurrencies ?? []).map((currency) => currency.toUpperCase()));
}

/**
 * The union of the two ways to be paid, in storefront order, never empty.
 *
 * Order comes from `STOREFRONT_CURRENCIES` rather than from either input, so the
 * switcher does not reshuffle itself when a provider is toggled.
 */
export function offeredFrom(
  card: readonly string[],
  transfer: ReadonlySet<string>,
): StorefrontCurrency[] {
  const offered = STOREFRONT_CURRENCIES.filter(
    (currency) => card.includes(currency) || transfer.has(currency),
  );

  return offered.length > 0 ? [...offered] : [DEFAULT_CURRENCY];
}

/**
 * `DEFAULT_CURRENCY` when it is offered, otherwise the first that is.
 *
 * Split out from `fallbackCurrency` so the rule can be asserted without a database.
 */
export function preferredOf(offered: readonly StorefrontCurrency[]): StorefrontCurrency {
  return offered.includes(DEFAULT_CURRENCY) ? DEFAULT_CURRENCY : offered[0]!;
}

/**
 * Memoised per request on top of the cross-request cache.
 *
 * `read` is `"use cache"`, so this is not about the database — it is about the
 * dozen components on one page that each want the answer. React's `cache` collapses
 * those into one call, the same way `resolveStorefrontCurrency` is wrapped.
 */
export const offeredCurrencies = cache(read);

/** Whether one currency is on offer. The question most callers actually have. */
export async function isOfferedCurrency(currency: string): Promise<boolean> {
  return (await offeredCurrencies()).includes(currency as StorefrontCurrency);
}

/**
 * The currency to use when the viewer's own choice is not on offer.
 *
 * `DEFAULT_CURRENCY` when it is offered, so a stale `?currency=GBP` link lands
 * somewhere predictable rather than on whatever happens to sort first; otherwise the
 * first currency that is.
 */
export async function fallbackCurrency(): Promise<StorefrontCurrency> {
  return preferredOf(await offeredCurrencies());
}

/**
 * The other side of the same list, for the screens that warn rather than hide.
 *
 * The pricing form still offers every storefront currency — turning a provider off
 * must not strand prices a vendor has already set, and turning it back on must
 * bring them back — so it needs to know which columns are currently dead rather
 * than which are alive.
 */
export async function unofferedCurrencies(): Promise<StorefrontCurrency[]> {
  const offered = await offeredCurrencies();
  return STOREFRONT_CURRENCIES.filter((currency) => !offered.includes(currency));
}

/**
 * How a currency can be paid, for the admin screen and for checkout copy.
 *
 * Returned together because the two questions are always asked together: a currency
 * covered only by transfer must not offer a card button, and a currency covered by
 * neither is on the page only because of the `DEFAULT_CURRENCY` fallback.
 */
export async function coverageFor(
  currency: StorefrontCurrency,
): Promise<{ card: boolean; transfer: boolean }> {
  const settings = await getPaymentSettings();

  return {
    card: (await providersFor(currency)).length > 0,
    transfer: transferCoverage(settings).has(currency),
  };
}
