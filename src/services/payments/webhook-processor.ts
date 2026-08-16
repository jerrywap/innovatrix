import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import type { PaymentProvider as ProviderKey } from "@/lib/db/enums";
import { webhookEvents } from "@/repositories/webhook-event.repository";
import { ProviderError, SignatureError, type ParsedWebhook } from "./provider";
import {
  processPaymentFailed,
  processPaymentRefunded,
  processPaymentSucceeded,
  type FulfilmentResult,
  type FulfilmentSource,
} from "./fulfilment";

/**
 * Turning a stored webhook event into a fulfilment — §87.
 *
 * Separate from the route so the **same function** serves `after()` and the
 * reconciliation sweep. They race routinely, and `webhookEvents.claim()` is
 * what makes that safe: a guarded `received → processing` transition, so
 * whichever arrives second gets `null` and stops.
 *
 * ## Retryable versus terminal
 *
 * The distinction decides whether a customer who paid gets their licence:
 *
 * - **Retryable** — a provider timeout, a database blip, a payment we cannot
 *   find *yet* (the webhook can beat our own `providerRef` write). Back to
 *   `received`, and the sweep picks it up.
 * - **Terminal** — a forged signature, a payload we cannot parse, an event type
 *   we ignore. `failed`, and the sweep skips it.
 *
 * Marking a transient failure terminal is the bug that loses a sale silently.
 */

export async function processWebhookEvent(eventId: string): Promise<FulfilmentResult | null> {
  await connectToDatabase();

  const event = await webhookEvents.claim(eventId);
  // Claimed by the other racer, or already done. Either way: not ours.
  if (!event) return null;

  try {
    const parsed = event.payload as unknown as { __parsed?: ParsedWebhook };
    const normalised = parsed.__parsed;

    if (!normalised) {
      await webhookEvents.markFailed(eventId, "Stored event has no normalised payload.", false);
      return null;
    }

    const result = await dispatch(normalised, event.provider, "webhook");
    await settle(eventId, result);
    return result;
  } catch (error) {
    const retryable = !(error instanceof SignatureError);
    await webhookEvents.markFailed(
      eventId,
      error instanceof Error ? error.message : String(error),
      retryable,
    );
    // Rethrown so `after()` logs it and the sweep sees a stuck event, but the
    // HTTP response has already gone — the provider is not made to retry.
    throw error;
  }
}

/** Shared by the webhook and the sweep, so both interpret an event identically. */
export async function dispatch(
  parsed: ParsedWebhook,
  provider: ProviderKey,
  source: FulfilmentSource,
): Promise<FulfilmentResult> {
  const actor = { type: "system" } as const;

  switch (parsed.type) {
    case "payment.succeeded":
      return processPaymentSucceeded({
        provider,
        providerRef: parsed.providerRef,
        source,
        actor,
      });

    case "payment.failed":
      return processPaymentFailed({
        provider,
        providerRef: parsed.providerRef,
        reason: "Provider reported a failed payment.",
        source,
        actor,
      });

    case "payment.refunded":
      return processPaymentRefunded({
        provider,
        providerRef: parsed.providerRef,
        source,
        actor,
      });

    case "ignored":
    default:
      // Recorded and acknowledged. Providers send dozens of event types we have
      // no use for, and erroring on them makes the provider retry forever.
      return { outcome: "already_processed" };
  }
}

/**
 * Record how it went.
 *
 * `not_found` is **retryable**, and that is the subtle one: a webhook can beat
 * our own `providerRef` write by milliseconds, so "no payment for this ref"
 * often means "not yet" rather than "never".
 */
async function settle(eventId: string, result: FulfilmentResult): Promise<void> {
  if (result.outcome === "not_found") {
    await webhookEvents.markFailed(eventId, result.reason ?? "Payment not found.", true);
    return;
  }

  if (result.outcome === "requires_review") {
    // Terminal for the *event*: a human has to look, and retrying will produce
    // the same mismatch every time.
    await webhookEvents.markFailed(eventId, result.reason ?? "Amount mismatch.", false);
    return;
  }

  await webhookEvents.markProcessed(eventId);
}

export { ProviderError };
