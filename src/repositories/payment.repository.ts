import type { ClientSession } from "mongoose";
import { OrgScopedRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { Payment, type PaymentDoc } from "@/lib/db/models/commerce";
import type { PaymentProvider, PaymentStatus } from "@/lib/db/enums";

/**
 * Payments — §62, §87.
 *
 * The unique index on `(provider, providerRef)` is the idempotency key for the
 * entire fulfilment path, and every method here is written around it. Nothing
 * in this file does read-then-write on that pair; the index decides.
 */
export class PaymentRepository extends OrgScopedRepository<PaymentDoc> {
  async findByProviderRef(
    provider: PaymentProvider,
    providerRef: string,
    options: { session?: ClientSession } = {},
  ): Promise<PaymentDoc | null> {
    return this.model
      .findOne({ provider, providerRef })
      .session(options.session ?? null)
      .lean<PaymentDoc>();
  }

  async findByReference(reference: string): Promise<PaymentDoc | null> {
    return this.model.findOne({ reference }).lean<PaymentDoc>();
  }

  async findForSubject(
    subjectId: string,
    options: { session?: ClientSession } = {},
  ): Promise<PaymentDoc[]> {
    return this.model
      .find({ subjectId: toObjectId(subjectId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .session(options.session ?? null)
      .lean<PaymentDoc[]>();
  }

  /**
   * Guarded transition — the second concurrent caller gets `null`.
   *
   * This is what makes a webhook and the reconciliation sweep safe to race:
   * both may decide a payment succeeded, and exactly one may write it.
   */
  async setStatusIfCurrent(
    paymentId: string,
    from: PaymentStatus,
    to: PaymentStatus,
    extra: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<PaymentDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(paymentId), status: from },
        { $set: { status: to, ...extra } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<PaymentDoc>();
  }

  /**
   * Payments a provider has not confirmed — ticket 13's reconciliation sweep.
   *
   * `provider: { $ne: "manual" }` because a manual bank transfer has no
   * provider to ask; it is confirmed by the staff member who recorded it.
   */
  /**
   * `createdAt` is in the return type because the caller needs it.
   *
   * `schemaOptions` sets `timestamps: true`, so it is on every document — but
   * `PaymentDoc` does not declare it, and ticket 27's stuck-payment alert has
   * to know how long "pending" has been going on. Narrowing it here rather
   * than adding it to `PaymentDoc` keeps the claim next to the query that
   * filters and sorts by it, which is the only place it is guaranteed loaded.
   */
  async pendingSince(
    cutoff: Date,
    limit = 50,
  ): Promise<Array<PaymentDoc & { createdAt: Date }>> {
    return this.model
      .find({ status: "pending", provider: { $ne: "manual" }, createdAt: { $lte: cutoff } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<Array<PaymentDoc & { createdAt: Date }>>();
  }
}

export const payments = new PaymentRepository(Payment);
