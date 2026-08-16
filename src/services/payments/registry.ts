import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import type { PaymentProvider as ProviderKey } from "@/lib/db/enums";
import { PaymentSettings, type PaymentSettingsDoc } from "@/lib/db/models/commerce";
import { ValidationError } from "@/lib/errors";
import type { CurrencyCode } from "@/lib/money";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { PaypalDriver } from "./drivers/paypal";
import { PaystackDriver } from "./drivers/paystack";
import { StripeDriver } from "./drivers/stripe";
import type { PaymentProviderDriver } from "./provider";

/**
 * Which provider handles what — §62.
 *
 * ## Adding a fourth is two lines here and nothing anywhere else
 *
 * That is the acceptance criterion: implement the interface, add it to
 * `DRIVERS`, and checkout, invoices and every UI carry on unchanged. This
 * module is the only place that names all three, which is what makes that true.
 */

const DRIVERS: Record<Exclude<ProviderKey, "manual">, PaymentProviderDriver> = {
  stripe: new StripeDriver(),
  paystack: new PaystackDriver(),
  paypal: new PaypalDriver(),
};

export function driverFor(key: ProviderKey): PaymentProviderDriver {
  if (key === "manual") {
    // A bank transfer has no driver: staff confirm it, and ticket 13 runs the
    // same fulfilment path afterwards. Asking for one is a bug in the caller.
    throw new Error("Manual payments have no provider driver.");
  }
  return DRIVERS[key];
}

export function allDrivers(): PaymentProviderDriver[] {
  return Object.values(DRIVERS);
}

/* ────────────────────────────────────────────── settings */

export async function getPaymentSettings(): Promise<PaymentSettingsDoc> {
  await connectToDatabase();

  const existing = await PaymentSettings.findOne({
    singleton: "global",
  }).lean<PaymentSettingsDoc>();
  if (existing) return existing;

  // Created on first read rather than by a migration, so a fresh database has
  // a settings document to edit instead of a screen that errors.
  const created = await PaymentSettings.findOneAndUpdate(
    { singleton: "global" },
    {
      $setOnInsert: {
        singleton: "global",
        providers: allDrivers().map((driver) => ({
          key: driver.key,
          enabled: false,
          mode: "test",
          // `driver.key` is narrowed by the `DRIVERS` record's own key type,
          // but `PaymentProviderDriver.key` widens it back to include
          // `manual` — which has no driver and therefore no secret.
          secretEnvVar: SECRET_ENV_VARS[driver.key as keyof typeof SECRET_ENV_VARS],
          supportedCurrencies: driver.supportedCurrencies(),
        })),
        currencyRouting: [],
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean<PaymentSettingsDoc>();

  return created!;
}

/**
 * Which environment variable each provider's secret lives in.
 *
 * The **name**, never the value (§88). The admin screen shows which variable is
 * expected and whether it is set; nothing writes a secret into MongoDB, and
 * there is no input on that screen that could.
 */
export const SECRET_ENV_VARS: Record<Exclude<ProviderKey, "manual">, string> = {
  stripe: "STRIPE_SECRET_KEY",
  paystack: "PAYSTACK_SECRET_KEY",
  paypal: "PAYPAL_CLIENT_SECRET",
};

/* ────────────────────────────────────────────── resolution */

export interface ResolvedProvider {
  driver: PaymentProviderDriver;
  key: ProviderKey;
}

/**
 * The provider for a currency, honouring the admin's routing.
 *
 * Order: the customer's preference (if it is actually enabled and supports the
 * currency) → the configured primary → the configured fallbacks → any enabled
 * provider that supports it.
 *
 * ## It refuses rather than letting the provider refuse
 *
 * Disabling every provider for a currency must block checkout **with a message
 * that says so**, not produce a 400 from an API the customer never heard of.
 * That is the acceptance criterion, and it is why this throws a
 * `ValidationError` with the currency named.
 */
export async function resolveProvider(
  currency: CurrencyCode,
  preferred?: ProviderKey,
): Promise<ResolvedProvider> {
  const candidates = await providersFor(currency);

  if (candidates.length === 0) {
    throw new ValidationError(
      `We can't take payment in ${currency} at the moment. Try another currency, or get in touch.`,
      { currency: [`No payment provider is available for ${currency}.`] },
    );
  }

  const chosen =
    (preferred && candidates.find((candidate) => candidate.key === preferred)) ??
    candidates[0]!;

  return chosen;
}

/**
 * Every provider that could take this currency, best first.
 *
 * Returned as a list because §62 says "if two providers serve the currency, the
 * customer picks" — so checkout needs the options, not just the winner.
 */
export async function providersFor(currency: CurrencyCode): Promise<ResolvedProvider[]> {
  const settings = await getPaymentSettings();

  const enabled = new Map(
    settings.providers
      .filter((provider) => provider.enabled && provider.key !== "manual")
      .map((provider) => [provider.key, provider]),
  );

  const routing = settings.currencyRouting.find(
    (route) => route.currency.toUpperCase() === currency,
  );

  // Preference order, deduplicated, with anything unusable filtered out at the
  // end rather than at each step — so a disabled primary falls through to its
  // fallback instead of emptying the list.
  const ordered: ProviderKey[] = [
    ...(routing ? [routing.primary, ...routing.fallbacks] : []),
    ...[...enabled.keys()],
  ];

  const seen = new Set<ProviderKey>();
  const resolved: ResolvedProvider[] = [];

  for (const key of ordered) {
    if (seen.has(key) || key === "manual") continue;
    seen.add(key);

    const configured = enabled.get(key);
    if (!configured) continue;

    const driver = DRIVERS[key];
    // Three separate gates, and all three matter: the admin enabled it, the
    // driver can actually take this currency, and the secret is present. A
    // provider enabled without its key is the most likely misconfiguration.
    if (!driver.supportedCurrencies().includes(currency)) continue;
    if (!driver.isConfigured()) continue;

    resolved.push({ driver, key });
  }

  return resolved;
}

/**
 * Which storefront currencies nobody can take money in.
 *
 * The admin screen shows this as a validation error, because a currency the
 * marketplace prices in and cannot charge for is a checkout that fails at the
 * last step — the most expensive place to discover a configuration mistake.
 */
export async function uncoveredCurrencies(): Promise<CurrencyCode[]> {
  const uncovered: CurrencyCode[] = [];

  for (const currency of STOREFRONT_CURRENCIES) {
    const candidates = await providersFor(currency);
    if (candidates.length === 0) uncovered.push(currency);
  }

  return uncovered;
}
