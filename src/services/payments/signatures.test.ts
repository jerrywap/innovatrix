import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPaypalVerification,
  signPaystackPayload,
  signStripePayload,
  STRIPE_TOLERANCE_SECONDS,
  verifyPaystackSignature,
  verifyStripeSignature,
} from "./signatures";
import { decimalStringToMinorUnits, fromProviderAmount, toProviderAmount } from "./provider";

/**
 * The verification path, tested by **generating real signatures**.
 *
 * A recorded fixture only proves the recording still matches itself. Signing a
 * body with a known secret and verifying it exercises the same code an actual
 * webhook would, and flipping one byte then proves the verifier is doing
 * something rather than returning true.
 */

const BODY = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
const SECRET = "whsec_test_secret_value";

describe("Stripe", () => {
  it("accepts a signature it just produced", () => {
    const header = signStripePayload({ rawBody: BODY, secret: SECRET });
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET })).toBe(true);
  });

  it("rejects a body changed by one byte", () => {
    const header = signStripePayload({ rawBody: BODY, secret: SECRET });
    const tampered = BODY.replace("evt_123", "evt_124");
    expect(verifyStripeSignature({ rawBody: tampered, header, secret: SECRET })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const header = signStripePayload({ rawBody: BODY, secret: SECRET });
    expect(
      verifyStripeSignature({ rawBody: BODY, header, secret: "whsec_something_else" }),
    ).toBe(false);
  });

  it("rejects a stale timestamp, so a captured webhook cannot be replayed", () => {
    const stale = Math.floor(Date.now() / 1000) - (STRIPE_TOLERANCE_SECONDS + 60);
    const header = signStripePayload({ rawBody: BODY, secret: SECRET, timestamp: stale });

    // The signature itself is perfectly valid. Without the tolerance check it
    // would stay valid forever.
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET })).toBe(false);
  });

  it("rejects a timestamp from the future beyond tolerance", () => {
    const ahead = Math.floor(Date.now() / 1000) + (STRIPE_TOLERANCE_SECONDS + 60);
    const header = signStripePayload({ rawBody: BODY, secret: SECRET, timestamp: ahead });
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET })).toBe(false);
  });

  it("accepts one valid v1 among several — the secret-rotation case", () => {
    // Stripe signs with both secrets during a rollover. A parser that takes
    // only the first `v1` rejects half the traffic for the duration.
    const timestamp = Math.floor(Date.now() / 1000);
    const valid = createHmac("sha256", SECRET)
      .update(`${timestamp}.${BODY}`, "utf8")
      .digest("hex");
    const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${valid}`;

    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET })).toBe(true);
  });

  it("tolerates whitespace a proxy might introduce", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", SECRET)
      .update(`${timestamp}.${BODY}`, "utf8")
      .digest("hex");

    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: ` t=${timestamp} , v1=${signature} `,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  const malformed = [
    ["an absent header", null],
    ["an empty header", ""],
    ["no timestamp", "v1=abc"],
    ["no signature", "t=123"],
    ["nonsense", "not-a-signature"],
  ] as const;

  it.each(malformed)("rejects %s", (_label, header) => {
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: SECRET })).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    // Otherwise an unconfigured environment accepts every webhook.
    const header = signStripePayload({ rawBody: BODY, secret: SECRET });
    expect(verifyStripeSignature({ rawBody: BODY, header, secret: "" })).toBe(false);
  });
});

describe("Paystack", () => {
  const KEY = "sk_test_paystack_key";

  it("accepts a signature it just produced", () => {
    const header = signPaystackPayload({ rawBody: BODY, secretKey: KEY });
    expect(verifyPaystackSignature({ rawBody: BODY, header, secretKey: KEY })).toBe(true);
  });

  it("uses SHA-512, not SHA-256", () => {
    // Using the wrong digest rejects every legitimate webhook, which presents
    // as a Paystack outage rather than as our bug.
    const sha256 = createHmac("sha256", KEY).update(BODY, "utf8").digest("hex");
    expect(verifyPaystackSignature({ rawBody: BODY, header: sha256, secretKey: KEY })).toBe(
      false,
    );

    const sha512 = createHmac("sha512", KEY).update(BODY, "utf8").digest("hex");
    expect(verifyPaystackSignature({ rawBody: BODY, header: sha512, secretKey: KEY })).toBe(
      true,
    );
  });

  it("rejects a tampered body", () => {
    const header = signPaystackPayload({ rawBody: BODY, secretKey: KEY });
    expect(verifyPaystackSignature({ rawBody: `${BODY} `, header, secretKey: KEY })).toBe(
      false,
    );
  });

  it("rejects an absent header or key", () => {
    expect(verifyPaystackSignature({ rawBody: BODY, header: null, secretKey: KEY })).toBe(
      false,
    );
    const header = signPaystackPayload({ rawBody: BODY, secretKey: KEY });
    expect(verifyPaystackSignature({ rawBody: BODY, header, secretKey: "" })).toBe(false);
  });
});

describe("PayPal", () => {
  const headers = (overrides: Record<string, string> = {}) =>
    new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.paypal.com/cert.pem",
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-sig": "sig-1",
      "paypal-transmission-time": "2026-08-16T00:00:00Z",
      ...overrides,
    });

  it("assembles the verification request PayPal expects", () => {
    const request = buildPaypalVerification({
      rawBody: BODY,
      headers: headers(),
      webhookId: "WH-123",
    });

    expect(request).toMatchObject({
      auth_algo: "SHA256withRSA",
      transmission_id: "tx-1",
      webhook_id: "WH-123",
    });
    expect(request?.webhook_event).toMatchObject({ id: "evt_123" });
  });

  it("returns null when a header is missing", () => {
    // A malformed request, not a failed verification — and sending PayPal a
    // half-filled body just gets an unhelpful 400 back.
    const request = buildPaypalVerification({
      rawBody: BODY,
      headers: new Headers({ "paypal-auth-algo": "SHA256withRSA" }),
      webhookId: "WH-123",
    });
    expect(request).toBeNull();
  });

  it("returns null without a configured webhook id", () => {
    expect(
      buildPaypalVerification({ rawBody: BODY, headers: headers(), webhookId: "" }),
    ).toBeNull();
  });

  it("returns null on an unparseable body", () => {
    expect(
      buildPaypalVerification({ rawBody: "{not json", headers: headers(), webhookId: "WH-1" }),
    ).toBeNull();
  });
});

/* ────────────────────────────────────────────── the money boundary */

describe("amounts crossing the provider boundary", () => {
  it("sends £299.99 as the right thing to each provider", () => {
    const amount = { amount: 29_999, currency: "GBP" } as const;

    // The ticket's own criterion, verbatim.
    expect(toProviderAmount("stripe", amount)).toBe(29_999);
    expect(toProviderAmount("paystack", amount)).toBe(29_999);
    expect(toProviderAmount("paypal", amount)).toBe("299.99");
  });

  it("does not invent decimal places for a zero-exponent currency", () => {
    // `toFixed(2)` here would send PayPal "1000.00" for ¥1,000 — a hundredfold
    // error, and one that looks perfectly normal in a log.
    expect(toProviderAmount("paypal", { amount: 1_000, currency: "JPY" })).toBe("1000");
    expect(toProviderAmount("stripe", { amount: 1_000, currency: "JPY" })).toBe(1_000);
  });

  it("round-trips through each provider's format", () => {
    for (const currency of ["GBP", "USD", "NGN", "JPY"] as const) {
      for (const minor of [0, 1, 99, 100, 29_999, 1_000_000]) {
        const original = { amount: minor, currency };
        for (const provider of ["stripe", "paystack", "paypal"] as const) {
          const sent = toProviderAmount(provider, original);
          expect(fromProviderAmount(provider, sent, currency)).toEqual(original);
        }
      }
    }
  });

  it("parses a decimal string without touching a float", () => {
    // 29.99 × 100 is 2998.9999999999995 in IEEE-754. This must be 2999.
    expect(decimalStringToMinorUnits("29.99", "GBP")).toBe(2_999);
    expect(decimalStringToMinorUnits("0.07", "GBP")).toBe(7);
    expect(decimalStringToMinorUnits("1.1", "GBP")).toBe(110);
    expect(decimalStringToMinorUnits("100", "GBP")).toBe(10_000);
    expect(decimalStringToMinorUnits("1000", "JPY")).toBe(1_000);
  });

  it("truncates precision a currency cannot represent rather than rounding it", () => {
    // A provider sending three decimal places for GBP is reporting something
    // we cannot store. Inventing a rounding rule would hide that.
    expect(decimalStringToMinorUnits("1.999", "GBP")).toBe(199);
  });

  it("refuses a non-integer minor-unit amount from Stripe or Paystack", () => {
    expect(() => fromProviderAmount("stripe", 299.99, "GBP")).toThrow(/non-integer/);
  });

  it("rejects a malformed decimal string", () => {
    expect(() => decimalStringToMinorUnits("abc", "GBP")).toThrow(/not a decimal/);
    expect(() => decimalStringToMinorUnits("1.2.3", "GBP")).toThrow(/not a decimal/);
  });
});
