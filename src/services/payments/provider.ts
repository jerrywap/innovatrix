import "server-only";
import type { PaymentProvider as ProviderKey } from "@/lib/db/enums";
import type { PaymentDoc } from "@/lib/db/models/commerce";
import { DomainError, ProviderUnavailableError } from "@/lib/errors";
import { formatPlain, type CurrencyCode, type Money } from "@/lib/money";

/**
 * One interface, three drivers — §62.
 *
 * The rest of the platform must not learn which provider ran. Checkout asks for
 * a redirect, the webhook asks what a payload means, and reconciliation asks
 * whether money arrived. None of them names Stripe.
 *
 * ## The rules every driver obeys
 *
 * 1. **Amounts cross the boundary in the provider's own units, converted
 *    here and nowhere else.** Stripe and Paystack take integer minor units;
 *    PayPal takes a decimal *string*. `toProviderAmount()` is the only place
 *    that knows, so a driver that forgets is a driver that fails a test rather
 *    than one that charges a hundred times too much.
 *
 * 2. **Every driver echoes `payment.reference` into provider metadata.** If our
 *    `providerRef` write failed between initiating and the webhook arriving,
 *    that echo is the only thread back to the order.
 *
 * 3. **Drivers never write domain state.** They return data. Ticket 13's
 *    service decides what it means. A driver that marked an order paid would
 *    make "the webhook is the authority" untrue in three places at once.
 */

export interface InitiateInput {
  /** Our record, already persisted — so `reference` exists to echo. */
  payment: Pick<PaymentDoc, "reference" | "subjectType"> & { _id: unknown };
  amount: Money;
  customer: { email: string; name?: string; organizationId: string };
  description: string;
  returnUrl: string;
  /** Merged with our reference. Provider-side strings only. */
  metadata: Record<string, string>;
}

export interface InitiateResult {
  redirectUrl: string;
  providerRef: string;
}

export interface VerifyResult {
  status: "pending" | "succeeded" | "failed";
  amount: Money;
  paidAt?: Date;
  /** The provider's own payload, stored verbatim for disputes. */
  raw: unknown;
}

export type WebhookEventType =
  "payment.succeeded" | "payment.failed" | "payment.refunded" | "ignored";

export interface ParsedWebhook {
  providerRef: string;
  /** The provider's own event id — our idempotency key. */
  eventId: string;
  type: WebhookEventType;
  amount?: Money;
  raw: unknown;
}

export interface PaymentProviderDriver {
  readonly key: ProviderKey;

  /** Which currencies this provider can actually take money in. */
  supportedCurrencies(): CurrencyCode[];

  /** Is this driver usable — are its secrets present? */
  isConfigured(): boolean;

  initiate(input: InitiateInput): Promise<InitiateResult>;

  /** Authoritative, server-to-server. Never trust the browser. */
  verify(providerRef: string): Promise<VerifyResult>;

  /** Verify the signature, then normalise. Throws on an invalid signature. */
  parseWebhook(input: { rawBody: string; headers: Headers }): Promise<ParsedWebhook>;

  refund(providerRef: string, amount: Money): Promise<{ refundRef: string }>;
}

/* ────────────────────────────────────────────── errors */

/**
 * Something went wrong *at the provider*, as opposed to in our code.
 *
 * Distinguished because the two want different handling: a provider error is
 * often transient and worth retrying, and its message is frequently unsafe to
 * show a customer verbatim.
 */
export class ProviderError extends DomainError {
  constructor(
    readonly provider: ProviderKey,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super("PROVIDER_UNAVAILABLE", message, { context: { provider, ...context }, cause });
    this.name = "ProviderError";
  }
}

/** An invalid webhook signature. Always a 400, never a retry. */
export class SignatureError extends DomainError {
  constructor(
    readonly provider: ProviderKey,
    message = "Webhook signature verification failed.",
  ) {
    super("FORBIDDEN", message, { context: { provider } });
    this.name = "SignatureError";
  }
}

/* ────────────────────────────────────────────── the transport boundary */

/** How long to wait on a provider before calling it unreachable. */
const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * `fetch`, with the two failures every driver used to let escape.
 *
 * A driver models "the provider said no" as a `ProviderError`. It said nothing
 * about "we could not reach the provider at all" — DNS, TLS, a proxy, no
 * network, a request that never returns. Those reject with a bare `TypeError`,
 * which is not a `DomainError`, so `withAction` reported them as
 * "Something went wrong on our side" with nothing to act on.
 *
 * `ProviderUnavailableError` already existed for exactly this and had no
 * callers. This is the caller.
 *
 * The timeout matters as much as the wrapper: without one a hung request holds
 * the server action open until the platform kills it, and the customer watches
 * a spinner with no idea anything is wrong.
 */
export async function providerFetch(
  provider: ProviderKey,
  url: string,
  init: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    throw new ProviderUnavailableError(provider, cause);
  }
}

/**
 * Read a provider's JSON body, treating "not JSON" as a transport failure.
 *
 * The old shape was `await response.json().catch(() => ({}))`, which turns an
 * HTML error page from a proxy into `{}`. A `{}` then passes every
 * `payload.status === false` style guard, is returned as `T`, and the caller
 * finally throws `Cannot read properties of undefined` several lines later —
 * far from the cause, and unmodelled.
 *
 * A provider that is not speaking JSON is not a provider that declined us.
 */
export async function readProviderJson<T>(
  provider: ProviderKey,
  response: Response,
): Promise<T> {
  const text = await response.text();

  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch (cause) {
    throw new ProviderUnavailableError(provider, cause);
  }
}

/* ────────────────────────────────────────────── the money boundary */

/**
 * An amount, in the shape this provider's API wants.
 *
 * **The single most error-prone line in the payments code**, so it lives once:
 *
 * - Stripe and Paystack want **integer minor units** — `29999` is £299.99.
 *   That is exactly what `Money.amount` already is, so no conversion happens.
 * - PayPal wants a **decimal string** — `"299.99"`.
 *
 * `formatPlain()` produces the decimal from the currency's own exponent, so a
 * zero-exponent currency renders `"1000"` rather than `"1000.00"`. **Never
 * `toFixed(2)`** here: JPY has no minor unit, and hard-coding two places would
 * send PayPal a hundredfold error.
 */
export function toProviderAmount(provider: ProviderKey, amount: Money): number | string {
  switch (provider) {
    case "stripe":
    case "paystack":
      return amount.amount;
    case "paypal":
      return formatPlain(amount);
    case "manual":
    case "free":
      // Never sent anywhere — both are driverless. Present so the switch is
      // exhaustive rather than defaulting, which is what would let a new
      // provider slip through.
      return amount.amount;
    default: {
      const exhaustive: never = provider;
      throw new Error(`No amount format for provider ${String(exhaustive)}`);
    }
  }
}

/** The inverse — a provider's amount back into our integer minor units. */
export function fromProviderAmount(
  provider: ProviderKey,
  value: number | string,
  currency: CurrencyCode,
): Money {
  if (provider === "paypal") {
    // A decimal string. Parsing to float then multiplying is the obvious
    // version and it is wrong: 29.99 × 100 is 2998.9999999999995. Splitting on
    // the point and padding keeps it exact.
    return { amount: decimalStringToMinorUnits(String(value), currency), currency };
  }

  const amount = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isInteger(amount)) {
    throw new ProviderError(
      provider,
      `Received a non-integer minor-unit amount (${String(value)}) from ${provider}.`,
    );
  }
  return { amount, currency };
}

/**
 * `"299.99"` → `29999`, without touching a float.
 *
 * Exported for its test: this is the conversion a rounding bug hides in, and
 * the failure is silent — a customer charged 30p instead of £299.99 looks like
 * a successful payment right up until reconciliation.
 */
export function decimalStringToMinorUnits(value: string, currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENTS[currency] ?? 2;
  const trimmed = value.trim();

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${value}" is not a decimal amount.`);
  }

  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace("-", "").split(".");

  // Pad or truncate to the currency's own number of places. Truncating rather
  // than rounding is deliberate: a provider that sends more precision than the
  // currency has is reporting something we cannot represent, and inventing a
  // rounding rule for it would hide that.
  const padded = fraction.padEnd(exponent, "0").slice(0, exponent);
  const amount = Number.parseInt(`${whole}${padded}` || "0", 10);

  return negative ? -amount : amount;
}

/**
 * Kept here rather than imported from `money.ts` so this module stays usable in
 * a driver test without pulling the whole money registry — and so a currency
 * the storefront does not sell can still be *parsed* from a provider payload.
 */
const CURRENCY_EXPONENTS: Record<string, number> = {
  GBP: 2,
  USD: 2,
  EUR: 2,
  NGN: 2,
  GHS: 2,
  ZAR: 2,
  KES: 2,
  JPY: 0,
};
