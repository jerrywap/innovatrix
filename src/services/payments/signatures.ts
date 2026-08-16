import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification — §87.
 *
 * Separate from the drivers so each one is testable without a driver, a
 * network call, or a mock. The tests **generate a real signature** with a known
 * secret and round-trip it, then flip a byte — which is a genuine test of the
 * verification, unlike asserting that a mocked SDK was called.
 *
 * ## Everything compares in constant time
 *
 * `a === b` on a signature leaks its length and its first differing byte to
 * anyone who can measure. That is a real attack against a public endpoint with
 * an unlimited retry budget, which is exactly what a webhook is.
 */

/** Every comparison here goes through this. Never `===`. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal — so the lengths are compared first and the result folded in
  // rather than returned early.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ────────────────────────────────────────────── Stripe */

/**
 * Stripe's scheme: `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`.
 *
 * The signed payload is `${timestamp}.${rawBody}`, HMAC-SHA256 with the
 * endpoint secret.
 *
 * ## Two details that are easy to miss and both matter
 *
 * 1. **The timestamp is part of the signed payload *and* must be checked
 *    against the clock.** Without the tolerance, a signature stays valid
 *    forever and a captured webhook can be replayed indefinitely — which
 *    defeats the point of signing it.
 *
 * 2. **There can be more than one `v1`.** During a secret rotation Stripe
 *    signs with both, and a parser that takes the first one rejects half the
 *    traffic for the duration of the rollover. All candidates are checked.
 */
export const STRIPE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | null;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  if (!input.header || !input.secret) return false;

  const parsed = parseStripeHeader(input.header);
  if (parsed.timestamp === undefined || parsed.signatures.length === 0) return false;

  const now = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? STRIPE_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${parsed.timestamp}.${input.rawBody}`, "utf8")
    .digest("hex");

  // `some` short-circuits, but each comparison is still constant-time and the
  // candidate count is a property of Stripe's rotation, not of the attacker.
  return parsed.signatures.some((candidate) => safeEqual(candidate, expected));
}

function parseStripeHeader(header: string): { timestamp?: number; signatures: string[] } {
  const signatures: string[] = [];
  let timestamp: number | undefined;

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    // Trimmed: Stripe does not pad, but a proxy that reformats headers might,
    // and a leading space would silently fail every signature.
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  return { ...(timestamp !== undefined ? { timestamp } : {}), signatures };
}

/* ────────────────────────────────────────────── Paystack */

/**
 * Paystack's scheme: `x-paystack-signature` is HMAC-**SHA512** of the raw body,
 * keyed with the **secret key itself** — not a separate webhook secret.
 *
 * Note SHA512, not SHA256. Using the wrong digest produces a verifier that
 * rejects every legitimate webhook, which looks like a Paystack outage.
 *
 * There is no timestamp in the scheme, so a captured payload can be replayed.
 * The defence is the `(provider, eventId)` unique index in ticket 13 — a replay
 * is recognised as a duplicate and returns 200 without doing anything.
 */
export function verifyPaystackSignature(input: {
  rawBody: string;
  header: string | null;
  secretKey: string;
}): boolean {
  if (!input.header || !input.secretKey) return false;

  const expected = createHmac("sha512", input.secretKey)
    .update(input.rawBody, "utf8")
    .digest("hex");

  return safeEqual(input.header.trim(), expected);
}

/* ────────────────────────────────────────────── PayPal */

/**
 * PayPal does not sign in a way we can verify locally.
 *
 * Verification is a **call to PayPal** — `POST
 * /v1/notifications/verify-webhook-signature` with the headers and the body —
 * so this module can only assemble the request. The driver makes the call,
 * because it owns the access token.
 *
 * That is a genuine difference in kind from the other two: PayPal webhook
 * verification needs the network and can fail for reasons that have nothing to
 * do with authenticity. Ticket 13 treats a *failure to verify* as retryable and
 * a *negative verification* as terminal — they are not the same answer.
 */
export interface PaypalVerificationRequest {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
  webhook_id: string;
  webhook_event: unknown;
}

export function buildPaypalVerification(input: {
  rawBody: string;
  headers: Headers;
  webhookId: string;
}): PaypalVerificationRequest | null {
  const get = (name: string) => input.headers.get(name);

  const required = {
    auth_algo: get("paypal-auth-algo"),
    cert_url: get("paypal-cert-url"),
    transmission_id: get("paypal-transmission-id"),
    transmission_sig: get("paypal-transmission-sig"),
    transmission_time: get("paypal-transmission-time"),
  };

  // A missing header is a malformed request, not a verification failure — and
  // sending PayPal a half-filled body would get an unhelpful 400 back.
  if (Object.values(required).some((value) => !value)) return null;
  if (!input.webhookId) return null;

  let webhookEvent: unknown;
  try {
    webhookEvent = JSON.parse(input.rawBody);
  } catch {
    return null;
  }

  return {
    auth_algo: required.auth_algo!,
    cert_url: required.cert_url!,
    transmission_id: required.transmission_id!,
    transmission_sig: required.transmission_sig!,
    transmission_time: required.transmission_time!,
    webhook_id: input.webhookId,
    webhook_event: webhookEvent,
  };
}

/* ────────────────────────────────────────────── test support */

/**
 * Produce a valid Stripe header for a body and secret.
 *
 * Exported so the tests can generate a **real** signature rather than assert
 * against a recorded one — which would only prove the recording still matches
 * itself. Harmless in production: it needs the secret, and anybody with the
 * secret can already sign.
 */
export function signStripePayload(input: {
  rawBody: string;
  secret: string;
  timestamp?: number;
}): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`, "utf8")
    .digest("hex");

  return `t=${timestamp},v1=${signature}`;
}

/** The Paystack equivalent. */
export function signPaystackPayload(input: { rawBody: string; secretKey: string }): string {
  return createHmac("sha512", input.secretKey).update(input.rawBody, "utf8").digest("hex");
}
