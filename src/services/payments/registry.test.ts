import { describe, expect, it } from "vitest";
import type { CurrencyCode } from "@/lib/money";
import { currenciesFor } from "./registry";
import type { PaymentProviderDriver } from "./provider";

/**
 * The gate that decides whether a provider is offered a currency.
 *
 * It had no tests, and the bug it now guards against reached a customer: the
 * gate consulted `driver.supportedCurrencies()` — what Paystack supports
 * *anywhere* — while the merchant's own account took NGN alone. Routing chose
 * Paystack for a USD order and relayed the provider's refusal at the last click
 * of checkout.
 */

function driverWith(currencies: string[]): PaymentProviderDriver {
  return {
    key: "paystack",
    supportedCurrencies: () => currencies as CurrencyCode[],
    isConfigured: () => true,
  } as PaymentProviderDriver;
}

const PAYSTACK = driverWith(["NGN", "GHS", "ZAR", "KES", "USD"]);

describe("currenciesFor", () => {
  it("honours what the account is actually provisioned for", () => {
    // The reported case: a Paystack account with only NGN enabled.
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["NGN"] })).toEqual(["NGN"]);
  });

  it("keeps USD out when the account does not have it", () => {
    // Precisely the routing decision that produced "Currency not supported by
    // merchant" — the driver says USD, the account does not.
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["NGN"] })).not.toContain("USD");
  });

  it("treats an empty list as unset, not as none", () => {
    /*
     * `toggleProviderAction` has a path that pushes a provider row with
     * `supportedCurrencies: []`. Read literally that provider would support
     * nothing and vanish from routing the moment somebody toggled it — a worse
     * and quieter bug than the one being fixed.
     */
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: [] })).toEqual(
      PAYSTACK.supportedCurrencies(),
    );
    expect(currenciesFor(PAYSTACK, undefined)).toEqual(PAYSTACK.supportedCurrencies());
  });

  it("refuses to widen past what the driver can do", () => {
    // A stored GBP on Paystack is not an instruction to try: `toProviderAmount`
    // would have to format an amount the driver has no rule for.
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["NGN", "GBP"] })).toEqual(["NGN"]);
  });

  it("falls back to the driver when every stored value is outside the ceiling", () => {
    // A stale row from before a driver dropped a currency. Trusting it would
    // silently disable the provider for everything.
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["GBP", "EUR"] })).toEqual(
      PAYSTACK.supportedCurrencies(),
    );
  });

  it("preserves the driver's ordering rather than the stored ordering", () => {
    // Order is the provider's preference, not an admin's tick order.
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["USD", "NGN"] })).toEqual([
      "NGN",
      "USD",
    ]);
  });

  it("narrows to several when several are enabled", () => {
    expect(currenciesFor(PAYSTACK, { supportedCurrencies: ["NGN", "KES"] })).toEqual([
      "NGN",
      "KES",
    ]);
  });
});
