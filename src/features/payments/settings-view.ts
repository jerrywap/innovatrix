import "server-only";
import { serverEnv } from "@/config/env";
import { STOREFRONT_CURRENCIES, type StorefrontCurrency } from "@/config/storefront";
import type { PaymentProvider as ProviderKey } from "@/lib/db/enums";
import {
  SECRET_ENV_VARS,
  allDrivers,
  currenciesFor,
  getPaymentSettings,
  providersFor,
} from "@/services/payments/registry";

/**
 * What `/admin/settings/payments` renders — §62, §88.
 *
 * ## The one thing this view must never contain
 *
 * A secret. Not truncated, not masked, not "last four". The screen reports the
 * **name** of the environment variable and a boolean for whether it is set, and
 * that is the entire surface. There is no field here that could hold a value,
 * which is why there is no risk of one being logged, cached, or sent to a
 * client component by a later refactor.
 *
 * `secretPresent` is computed here, server-side, from `serverEnv()` — the
 * boolean crosses the RSC boundary, never the string.
 */

export interface ProviderSettingsView {
  key: ProviderKey;
  label: string;
  enabled: boolean;
  mode: "test" | "live";
  /** The env var's **name**. Never its value. */
  secretEnvVar: string;
  secretPresent: boolean;
  /** What this merchant account is provisioned for — what routing honours. */
  supportedCurrencies: string[];
  /** What the provider supports at all; the ceiling the editor offers. */
  availableCurrencies: string[];
  /** Set when the admin enabled it but the key is missing — the usual mistake. */
  misconfigured: boolean;
}

export interface CurrencyRoutingView {
  currency: StorefrontCurrency;
  primary?: ProviderKey;
  fallbacks: ProviderKey[];
  /** Which providers could actually serve it right now. */
  available: ProviderKey[];
  covered: boolean;
  /** The stored primary is not one `available` would pick — see below. */
  stalePrimary: boolean;
}

export interface PaymentSettingsView {
  providers: ProviderSettingsView[];
  routing: CurrencyRoutingView[];
  uncovered: StorefrontCurrency[];
  webhookUrls: Array<{ provider: ProviderKey; url: string }>;
  /** Bank transfer — a value, not an env-var name, because customers read it. */
  offline: { enabled: boolean; instructions: string };
}

const LABELS: Record<string, string> = {
  stripe: "Stripe",
  paystack: "Paystack",
  paypal: "PayPal",
};

export async function loadPaymentSettings(): Promise<PaymentSettingsView> {
  const settings = await getPaymentSettings();
  const env = serverEnv();
  const origin = env.APP_URL.replace(/\/$/, "");

  const stored = new Map(settings.providers.map((provider) => [provider.key, provider]));

  const providers: ProviderSettingsView[] = allDrivers().map((driver) => {
    const record = stored.get(driver.key);
    const envVar = SECRET_ENV_VARS[driver.key as keyof typeof SECRET_ENV_VARS];
    const present = driver.isConfigured();

    return {
      key: driver.key,
      label: LABELS[driver.key] ?? driver.key,
      enabled: record?.enabled ?? false,
      mode: record?.mode ?? "test",
      secretEnvVar: envVar,
      secretPresent: present,
      // What this account takes, not what the provider could take anywhere.
      supportedCurrencies: currenciesFor(driver, record),
      // Everything the provider is capable of — the ceiling the editor offers,
      // and what makes the narrowing visible as a choice rather than a fact.
      availableCurrencies: driver.supportedCurrencies(),
      // Enabled with no key is the misconfiguration that produces a checkout
      // failing at the last step, so it is called out rather than inferred.
      misconfigured: (record?.enabled ?? false) && !present,
    };
  });

  const routing: CurrencyRoutingView[] = [];
  const uncovered: StorefrontCurrency[] = [];

  for (const currency of STOREFRONT_CURRENCIES) {
    const configured = settings.currencyRouting.find(
      (route) => route.currency.toUpperCase() === currency,
    );
    const available = (await providersFor(currency)).map((entry) => entry.key);

    if (available.length === 0) uncovered.push(currency);

    routing.push({
      currency,
      ...(configured?.primary ? { primary: configured.primary } : {}),
      fallbacks: configured?.fallbacks ?? [],
      available,
      covered: available.length > 0,
      /*
       * A stored primary the resolver would not pick.
       *
       * The `<select>` lists `available`, so a primary outside it matched no
       * option and the browser fell back to showing the first — the screen then
       * displayed a route that was not the stored one, and saving overwrote the
       * real value with the one the admin never chose. Surfacing it is the fix;
       * silently agreeing with the browser was the bug.
       */
      stalePrimary: Boolean(configured?.primary && !available.includes(configured.primary)),
    });
  }

  return {
    providers,
    routing,
    uncovered,
    webhookUrls: allDrivers().map((driver) => ({
      provider: driver.key,
      url: `${origin}/api/webhooks/${driver.key}`,
    })),
    offline: {
      enabled: settings.offlineEnabled ?? true,
      instructions: settings.offlineInstructions ?? "",
    },
  };
}
