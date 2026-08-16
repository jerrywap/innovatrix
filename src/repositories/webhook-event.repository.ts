import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { WebhookEvent, type WebhookEventDoc } from "@/lib/db/models/commerce";
import type { PaymentProvider } from "@/lib/db/enums";

/**
 * Webhook events — §87.
 *
 * Not org-scoped: a webhook arrives before we know whose it is, and the
 * provider's `eventId` is the only identity it has until we look it up.
 */
export class WebhookEventRepository extends BaseRepository<WebhookEventDoc> {
  /**
   * Record an event, or report that it is already known.
   *
   * Duplicate delivery is **normal**, not an error (§87), so this returns a
   * flag rather than throwing. An upsert with `$setOnInsert` and a check of
   * whether the returned document is the one we just made — the unique index
   * on `(provider, eventId)` is what decides, not a prior read.
   */
  async record(input: {
    provider: PaymentProvider;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ event: WebhookEventDoc; isDuplicate: boolean }> {
    const before = await this.model.findOne({
      provider: input.provider,
      eventId: input.eventId,
    });

    if (before) {
      return { event: before.toObject() as WebhookEventDoc, isDuplicate: true };
    }

    try {
      const created = await this.model.create({
        provider: input.provider,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        status: "received",
        attempts: 0,
      });
      return { event: created.toObject() as WebhookEventDoc, isDuplicate: false };
    } catch (error) {
      // Two deliveries landed in the same millisecond. The index refused the
      // second, which is exactly right — read back the winner and report it as
      // the duplicate it is.
      if (isDuplicateKey(error)) {
        const existing = await this.model.findOne({
          provider: input.provider,
          eventId: input.eventId,
        });
        if (existing) {
          return { event: existing.toObject() as WebhookEventDoc, isDuplicate: true };
        }
      }
      throw error;
    }
  }

  /**
   * Take exclusive ownership of an event for processing.
   *
   * The guard on `status: "received"` is what makes a webhook and the
   * reconciliation sweep safe to run simultaneously: whichever arrives second
   * gets `null` and stops. Without it both would fulfil.
   */
  async claim(eventId: string): Promise<WebhookEventDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(eventId), status: "received" },
        { $set: { status: "processing" }, $inc: { attempts: 1 } },
        { returnDocument: "after" },
      )
      .lean<WebhookEventDoc>();
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.model.updateOne(
      { _id: toObjectId(eventId) },
      { $set: { status: "processed", processedAt: new Date() }, $unset: { error: "" } },
    );
  }

  /**
   * Back to `received`, not to `failed`, when the failure is retryable.
   *
   * `failed` is terminal and the sweep skips it; a transient provider timeout
   * left there means a customer paid and never got their licence. Only a
   * non-retryable failure — a malformed payload, a payment we will never find —
   * is terminal, and the caller decides which this was.
   */
  async markFailed(eventId: string, error: string, retryable: boolean): Promise<void> {
    await this.model.updateOne(
      { _id: toObjectId(eventId) },
      { $set: { status: retryable ? "received" : "failed", error } },
    );
  }

  /** Events stuck mid-flight — the app was killed, or a retry is due. */
  async stuckSince(cutoff: Date, limit = 50): Promise<WebhookEventDoc[]> {
    return this.model
      .find({
        status: { $in: ["received", "processing"] },
        updatedAt: { $lte: cutoff },
        attempts: { $lt: 10 },
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<WebhookEventDoc[]>();
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export const webhookEvents = new WebhookEventRepository(WebhookEvent);
