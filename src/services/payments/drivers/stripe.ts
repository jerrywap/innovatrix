import "server-only";
import { serverEnv } from "@/config/env";
import type { CurrencyCode } from "@/lib/money";
import {
  ProviderError,
  SignatureError,
  fromProviderAmount,
  providerFetch,
  readProviderJson,
  toProviderAmount,
  type InitiateInput,
  type InitiateResult,
  type ParsedWebhook,
  type PaymentProviderDriver,
  type VerifyResult,
} from "../provider";
import { verifyStripeSignature } from "../signatures";

/**
 * Stripe — Checkout Sessions over the REST API.
 *
 * ## Why REST rather than the SDK
 *
 * The SDK's one genuine advantage is `constructEvent`, and that is thirty lines
 * of HMAC we can test by generating real signatures (see `signatures.test.ts`)
 * rather than by mocking. Everything else it offers is `fetch` with types.
 *
 * ## Form encoding, not JSON
 *
 * Stripe's API takes `application/x-www-form-urlencoded` with bracket notation
 * for nested values — `line_items[0][price_data][currency]`. Sending JSON gets
 * a 400 that reads like a validation error rather than a content-type problem.
 */

const API = "https://api.stripe.com/v1";

export class StripeDriver implements PaymentProviderDriver {
  readonly key = "stripe" as const;

  supportedCurrencies(): CurrencyCode[] {
    return ["GBP", "USD", "EUR", "NGN"];
  }

  isConfigured(): boolean {
    return Boolean(serverEnv().STRIPE_SECRET_KEY);
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", input.returnUrl);
    body.set("cancel_url", input.returnUrl);
    body.set("customer_email", input.customer.email);

    // Stripe wants the currency lowercased. It accepts uppercase for most, and
    // rejects it for some — lowercasing unconditionally is the only safe rule.
    body.set("line_items[0][price_data][currency]", input.amount.currency.toLowerCase());
    body.set("line_items[0][price_data][product_data][name]", input.description);
    body.set(
      "line_items[0][price_data][unit_amount]",
      String(toProviderAmount("stripe", input.amount)),
    );
    body.set("line_items[0][quantity]", "1");

    // The echo. If our `providerRef` write fails between here and the webhook,
    // this is the only thread back to the payment.
    body.set("metadata[payment_reference]", input.payment.reference);
    body.set("client_reference_id", input.payment.reference);
    for (const [name, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${name}]`, value);
    }

    const session = await this.call<{ id: string; url: string }>("checkout/sessions", {
      method: "POST",
      body,
      // Stripe's own idempotency, keyed on our reference: a retried initiate
      // returns the same session rather than creating a second one.
      idempotencyKey: `initiate:${input.payment.reference}`,
    });

    if (!session.url) {
      throw new ProviderError("stripe", "Stripe did not return a checkout URL.", {
        sessionId: session.id,
      });
    }

    return { redirectUrl: session.url, providerRef: session.id };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const session = await this.call<{
      id: string;
      payment_status: string;
      status: string;
      amount_total: number | null;
      currency: string | null;
      created: number;
    }>(`checkout/sessions/${encodeURIComponent(providerRef)}`, { method: "GET" });

    const currency = (session.currency ?? "GBP").toUpperCase() as CurrencyCode;

    return {
      status: mapStripeStatus(session.payment_status, session.status),
      amount: fromProviderAmount("stripe", session.amount_total ?? 0, currency),
      ...(session.payment_status === "paid" && session.created
        ? { paidAt: new Date(session.created * 1000) }
        : {}),
      raw: session,
    };
  }

  async parseWebhook(input: { rawBody: string; headers: Headers }): Promise<ParsedWebhook> {
    const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
    const valid = verifyStripeSignature({
      rawBody: input.rawBody,
      header: input.headers.get("stripe-signature"),
      secret: secret ?? "",
    });

    if (!valid) throw new SignatureError("stripe");

    const event = JSON.parse(input.rawBody) as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };

    const object = event.data.object;
    const providerRef = String(object.id ?? "");
    const currency = String(object.currency ?? "GBP").toUpperCase() as CurrencyCode;
    const total = object.amount_total ?? object.amount ?? 0;

    return {
      providerRef,
      eventId: event.id,
      type: mapStripeEvent(event.type),
      ...(typeof total === "number"
        ? { amount: fromProviderAmount("stripe", total, currency) }
        : {}),
      raw: event,
    };
  }

  async refund(providerRef: string, amount: { amount: number; currency: string }) {
    // A Checkout Session is not refundable directly — the payment intent is.
    const session = await this.call<{ payment_intent: string | null }>(
      `checkout/sessions/${encodeURIComponent(providerRef)}`,
      { method: "GET" },
    );

    if (!session.payment_intent) {
      throw new ProviderError("stripe", "That Stripe session has no payment to refund.", {
        providerRef,
      });
    }

    const body = new URLSearchParams();
    body.set("payment_intent", session.payment_intent);
    body.set("amount", String(toProviderAmount("stripe", amount as never)));

    const refund = await this.call<{ id: string }>("refunds", { method: "POST", body });
    return { refundRef: refund.id };
  }

  private async call<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: URLSearchParams; idempotencyKey?: string },
  ): Promise<T> {
    const secret = serverEnv().STRIPE_SECRET_KEY;
    if (!secret) {
      throw new ProviderError("stripe", "Stripe is not configured (STRIPE_SECRET_KEY).");
    }

    const response = await providerFetch(this.key, `${API}/${path}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
    });

    const payload = await readProviderJson<Record<string, unknown>>(this.key, response);

    if (!response.ok) {
      const error = payload.error as { message?: string; code?: string } | undefined;
      throw new ProviderError(
        "stripe",
        // Stripe's messages are written for developers and sometimes name
        // internal ids, so callers show their own copy — this is for the log.
        error?.message ?? `Stripe returned ${response.status}.`,
        { status: response.status, code: error?.code, path },
      );
    }

    return payload as T;
  }
}

/**
 * `payment_status` is the money question; `status` is the session's lifecycle.
 *
 * A session can be `complete` with `payment_status: "unpaid"` — a bank transfer
 * awaiting settlement — and treating `complete` as paid would fulfil an order
 * nobody has paid for.
 */
function mapStripeStatus(paymentStatus: string, sessionStatus: string): VerifyResult["status"] {
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") return "succeeded";
  if (sessionStatus === "expired") return "failed";
  return "pending";
}

function mapStripeEvent(type: string): ParsedWebhook["type"] {
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "payment_intent.succeeded":
      return "payment.succeeded";
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return "payment.failed";
    case "charge.refunded":
      return "payment.refunded";
    default:
      // Stripe sends dozens of event types. Anything unrecognised is recorded
      // and acknowledged, never processed — and never an error, because an
      // error here makes Stripe retry something we will keep ignoring.
      return "ignored";
  }
}
