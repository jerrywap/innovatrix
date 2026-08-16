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
import { buildPaypalVerification } from "../signatures";

/**
 * PayPal — Orders v2.
 *
 * Three things make this driver unlike the other two:
 *
 * 1. **Amounts are decimal strings.** `"299.99"`, not `29999`. The conversion
 *    is in `toProviderAmount`, and getting it wrong is a hundredfold error that
 *    looks perfectly ordinary in a log.
 *
 * 2. **Webhook verification is a network call**, not local HMAC. That means it
 *    can fail for reasons unrelated to authenticity — a timeout, an expired
 *    token — and those two outcomes must not be conflated. A *failure to
 *    verify* is retryable; a *negative verification* is a forgery.
 *
 * 3. **OAuth, not a static key.** An access token is fetched and cached for
 *    slightly less than its stated lifetime.
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | undefined;

export class PaypalDriver implements PaymentProviderDriver {
  readonly key = "paypal" as const;

  supportedCurrencies(): CurrencyCode[] {
    return ["GBP", "USD", "EUR"];
  }

  isConfigured(): boolean {
    const env = serverEnv();
    return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  }

  private base(): string {
    return serverEnv().PAYPAL_ENV === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const order = await this.call<{
      id: string;
      links: Array<{ rel: string; href: string }>;
    }>("v2/checkout/orders", {
      method: "POST",
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            // The echo. PayPal surfaces this on the order and in the webhook.
            custom_id: input.payment.reference,
            invoice_id: input.payment.reference,
            description: input.description.slice(0, 127),
            amount: {
              currency_code: input.amount.currency,
              value: toProviderAmount("paypal", input.amount),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.returnUrl,
              user_action: "PAY_NOW",
            },
          },
        },
      },
      // PayPal's own idempotency header.
      requestId: `initiate:${input.payment.reference}`,
    });

    const approve = order.links.find(
      (link) => link.rel === "payer-action" || link.rel === "approve",
    );
    if (!approve) {
      throw new ProviderError("paypal", "PayPal did not return an approval link.", {
        orderId: order.id,
      });
    }

    return { redirectUrl: approve.href, providerRef: order.id };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const order = await this.call<{
      status: string;
      purchase_units: Array<{
        amount: { currency_code: string; value: string };
        payments?: { captures?: Array<{ status: string; create_time: string }> };
      }>;
    }>(`v2/checkout/orders/${encodeURIComponent(providerRef)}`, { method: "GET" });

    const unit = order.purchase_units[0];
    const currency = (unit?.amount.currency_code ?? "GBP").toUpperCase() as CurrencyCode;
    const capture = unit?.payments?.captures?.[0];

    return {
      status: mapPaypalStatus(order.status, capture?.status),
      amount: fromProviderAmount("paypal", unit?.amount.value ?? "0", currency),
      ...(capture?.create_time ? { paidAt: new Date(capture.create_time) } : {}),
      raw: order,
    };
  }

  /**
   * Ask PayPal whether it sent this.
   *
   * The failure/forgery distinction lives here: a `SignatureError` means PayPal
   * said no, while a `ProviderError` means we could not ask. Ticket 13 retries
   * the second and never the first.
   */
  async parseWebhook(input: { rawBody: string; headers: Headers }): Promise<ParsedWebhook> {
    const request = buildPaypalVerification({
      rawBody: input.rawBody,
      headers: input.headers,
      webhookId: serverEnv().PAYPAL_WEBHOOK_ID ?? "",
    });

    if (!request) throw new SignatureError("paypal", "PayPal webhook headers were incomplete.");

    const result = await this.call<{ verification_status: string }>(
      "v1/notifications/verify-webhook-signature",
      { method: "POST", body: request },
    );

    if (result.verification_status !== "SUCCESS") {
      throw new SignatureError("paypal");
    }

    const event = JSON.parse(input.rawBody) as {
      id: string;
      event_type: string;
      resource: {
        id?: string;
        custom_id?: string;
        invoice_id?: string;
        supplementary_data?: { related_ids?: { order_id?: string } };
        amount?: { currency_code: string; value: string };
      };
    };

    const resource = event.resource;
    // A capture event's `id` is the *capture*, not the order. The order id is
    // what we stored as `providerRef`, so it is preferred where present.
    const providerRef = resource.supplementary_data?.related_ids?.order_id ?? resource.id ?? "";

    const currency = (resource.amount?.currency_code ?? "GBP").toUpperCase() as CurrencyCode;

    return {
      providerRef,
      eventId: event.id,
      type: mapPaypalEvent(event.event_type),
      ...(resource.amount
        ? { amount: fromProviderAmount("paypal", resource.amount.value, currency) }
        : {}),
      raw: event,
    };
  }

  async refund(providerRef: string, amount: { amount: number; currency: string }) {
    const order = await this.call<{
      purchase_units: Array<{ payments?: { captures?: Array<{ id: string }> } }>;
    }>(`v2/checkout/orders/${encodeURIComponent(providerRef)}`, { method: "GET" });

    const captureId = order.purchase_units[0]?.payments?.captures?.[0]?.id;
    if (!captureId) {
      throw new ProviderError("paypal", "That PayPal order has no capture to refund.", {
        providerRef,
      });
    }

    const refund = await this.call<{ id: string }>(
      `v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      {
        method: "POST",
        body: {
          amount: {
            currency_code: amount.currency,
            value: toProviderAmount("paypal", amount as never),
          },
        },
      },
    );

    return { refundRef: refund.id };
  }

  /** OAuth token, cached until shortly before it expires. */
  private async accessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

    const env = serverEnv();
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new ProviderError("paypal", "PayPal is not configured (client id or secret).");
    }

    const credentials = Buffer.from(
      `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
    ).toString("base64");

    const response = await fetch(`${this.base()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw new ProviderError("paypal", `PayPal token request failed (${response.status}).`);
    }

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      token: payload.access_token,
      // A minute early, so a token never expires mid-request.
      expiresAt: Date.now() + (payload.expires_in - 60) * 1000,
    };

    return cachedToken.token;
  }

  private async call<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown; requestId?: string },
  ): Promise<T> {
    const token = await this.accessToken();

    const response = await fetch(`${this.base()}/${path}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.requestId ? { "paypal-request-id": options.requestId } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      throw new ProviderError(
        "paypal",
        payload.message ?? `PayPal returned ${response.status}.`,
        { status: response.status, name: payload.name, path },
      );
    }

    return payload as T;
  }
}

/** Exported for tests — the token cache is module state and must be resettable. */
export function resetPaypalTokenCache(): void {
  cachedToken = undefined;
}

/**
 * An order is `COMPLETED` when captured. `APPROVED` means the customer said yes
 * and **the money has not moved** — treating that as paid fulfils an order
 * against an authorisation that may never capture.
 */
function mapPaypalStatus(orderStatus: string, captureStatus?: string): VerifyResult["status"] {
  if (orderStatus === "COMPLETED" && captureStatus === "COMPLETED") return "succeeded";
  if (orderStatus === "VOIDED") return "failed";
  return "pending";
}

function mapPaypalEvent(type: string): ParsedWebhook["type"] {
  switch (type) {
    case "PAYMENT.CAPTURE.COMPLETED":
    case "CHECKOUT.ORDER.COMPLETED":
      return "payment.succeeded";
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return "payment.failed";
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED":
      return "payment.refunded";
    default:
      return "ignored";
  }
}
