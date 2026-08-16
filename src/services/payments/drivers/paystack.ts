import "server-only";
import { serverEnv } from "@/config/env";
import type { CurrencyCode } from "@/lib/money";
import {
  ProviderError,
  SignatureError,
  fromProviderAmount,
  toProviderAmount,
  type InitiateInput,
  type InitiateResult,
  type ParsedWebhook,
  type PaymentProviderDriver,
  type VerifyResult,
} from "../provider";
import { verifyPaystackSignature } from "../signatures";

/**
 * Paystack — the African-currency provider.
 *
 * ## Its `reference` is ours
 *
 * Unlike Stripe, Paystack lets the caller supply the transaction reference and
 * then uses it as the lookup key everywhere — initialise, verify, webhook. So
 * `providerRef` **is** `payment.reference`, and the echo the other drivers put
 * in metadata is structural here.
 *
 * ## Amounts are minor units, and the currency decides which
 *
 * NGN is kobo, GHS is pesewas, ZAR is cents. All two-exponent, so
 * `Money.amount` goes across unchanged — the same as Stripe.
 */

const API = "https://api.paystack.co";

export class PaystackDriver implements PaymentProviderDriver {
  readonly key = "paystack" as const;

  supportedCurrencies(): CurrencyCode[] {
    return ["NGN", "GHS", "ZAR", "KES", "USD"];
  }

  isConfigured(): boolean {
    return Boolean(serverEnv().PAYSTACK_SECRET_KEY);
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const result = await this.call<{
      data: { authorization_url: string; reference: string };
    }>("transaction/initialize", {
      method: "POST",
      body: {
        email: input.customer.email,
        amount: toProviderAmount("paystack", input.amount),
        currency: input.amount.currency,
        // Ours, so verify and the webhook can both find it without a second id.
        reference: input.payment.reference,
        callback_url: input.returnUrl,
        metadata: {
          payment_reference: input.payment.reference,
          organization_id: input.customer.organizationId,
          ...input.metadata,
        },
      },
    });

    return {
      redirectUrl: result.data.authorization_url,
      providerRef: result.data.reference,
    };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const result = await this.call<{
      data: { status: string; amount: number; currency: string; paid_at: string | null };
    }>(`transaction/verify/${encodeURIComponent(providerRef)}`, { method: "GET" });

    const currency = (result.data.currency ?? "NGN").toUpperCase() as CurrencyCode;

    return {
      status: mapPaystackStatus(result.data.status),
      amount: fromProviderAmount("paystack", result.data.amount, currency),
      ...(result.data.paid_at ? { paidAt: new Date(result.data.paid_at) } : {}),
      raw: result.data,
    };
  }

  async parseWebhook(input: { rawBody: string; headers: Headers }): Promise<ParsedWebhook> {
    const valid = verifyPaystackSignature({
      rawBody: input.rawBody,
      header: input.headers.get("x-paystack-signature"),
      secretKey: serverEnv().PAYSTACK_SECRET_KEY ?? "",
    });

    if (!valid) throw new SignatureError("paystack");

    const event = JSON.parse(input.rawBody) as {
      event: string;
      data: { id?: number; reference: string; amount: number; currency?: string };
    };

    const currency = (event.data.currency ?? "NGN").toUpperCase() as CurrencyCode;

    return {
      providerRef: event.data.reference,
      /**
       * Paystack does not send an event id. The transaction id plus the event
       * name is the closest stable identity — and it is what makes
       * `(provider, eventId)` unique work, so a redelivery of
       * `charge.success` for the same transaction is recognised as a duplicate.
       */
      eventId: `${event.event}:${event.data.id ?? event.data.reference}`,
      type: mapPaystackEvent(event.event),
      ...(typeof event.data.amount === "number"
        ? { amount: fromProviderAmount("paystack", event.data.amount, currency) }
        : {}),
      raw: event,
    };
  }

  async refund(providerRef: string, amount: { amount: number; currency: string }) {
    const result = await this.call<{ data: { id: number } }>("refund", {
      method: "POST",
      body: {
        transaction: providerRef,
        amount: toProviderAmount("paystack", amount as never),
      },
    });

    return { refundRef: String(result.data.id) };
  }

  private async call<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown },
  ): Promise<T> {
    const secret = serverEnv().PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw new ProviderError("paystack", "Paystack is not configured (PAYSTACK_SECRET_KEY).");
    }

    const response = await fetch(`${API}/${path}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
    };

    // Paystack returns HTTP 200 with `status: false` for business failures, so
    // checking `response.ok` alone treats a declined card as a success.
    if (!response.ok || payload.status === false) {
      throw new ProviderError(
        "paystack",
        payload.message ?? `Paystack returned ${response.status}.`,
        { status: response.status, path },
      );
    }

    return payload as T;
  }
}

function mapPaystackStatus(status: string): VerifyResult["status"] {
  if (status === "success") return "succeeded";
  if (status === "failed" || status === "reversed") return "failed";
  return "pending";
}

function mapPaystackEvent(event: string): ParsedWebhook["type"] {
  switch (event) {
    case "charge.success":
      return "payment.succeeded";
    case "charge.failed":
      return "payment.failed";
    case "refund.processed":
    case "refund.failed":
      return "payment.refunded";
    default:
      return "ignored";
  }
}
