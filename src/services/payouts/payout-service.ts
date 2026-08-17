import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { counterStore } from "@/lib/db/counter-store";
import { LedgerEntry, Payout, PayoutSkip } from "@/lib/db/models/ledger";
import type { LedgerEntryDoc, PayoutDoc } from "@/lib/db/models/ledger";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import type { PayoutSkipReason, PayoutStatus } from "@/lib/db/enums";
import { PAYOUT_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateReference } from "@/lib/references";
import { isCurrencyCode, money, sum, toDocument, type Money } from "@/lib/money";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";
import { emit } from "@/lib/events";
import { writeAuditLog, statusChange, type AuditActor } from "@/services/audit";
import {
  DEFAULT_PAYOUT_METHOD,
  payoutCadenceDays,
  payoutDriverFor,
  payoutPeriod,
  payoutThreshold,
} from "./registry";

/**
 * Money leaving — vendor ticket 09.
 *
 * The first outbound money in the platform's history, and the place where the most
 * expensive possible bug lives: paying twice. Three guards, in the manner of
 * `processPaymentSucceeded`:
 *
 * 1. **A draft claims its entries** by stamping `payoutId` on them, so a second batch cannot
 *    see money a first one is already about to send.
 * 2. **Entries move to `paid` inside the same transaction** that marks the payout `paid`, and
 *    the update is guarded on them still being `cleared` and still claimed by *this* payout.
 *    A mismatched count aborts the whole thing.
 * 3. **Every transition is guarded on the current status**, so a retried confirmation finds
 *    nothing to change rather than re-applying.
 *
 * None of that is a check-then-write. Each one is a condition in the query, which is the only
 * kind of guard that holds when two people click at once.
 */

/* ────────────────────────────────────────────── drafting a batch */

export interface DraftOutcome {
  drafted: Array<{ payoutId: string; vendorId: string; reference: string; amount: Money }>;
  skipped: Array<{ vendorId: string; reason: PayoutSkipReason }>;
}

/**
 * Draft one payout per eligible vendor, and record why the others were skipped.
 *
 * **Nothing here sends anything.** A batch is prepared automatically and released
 * deliberately — money leaving the platform on a schedule with nobody looking is not a
 * feature, which is why `draft → approved` is a human transition and this function cannot
 * take it.
 *
 * Every vendor is either drafted or skipped **with a reason they can read**. A vendor
 * silently excluded from three runs has no way to discover it, asks support, and support has
 * no answer either.
 */
export async function draftBatch(
  options: { now?: Date; actor?: AuditActor } = {},
): Promise<DraftOutcome> {
  await connectToDatabase();

  const now = options.now ?? new Date();
  const cadence = await payoutCadenceDays();
  const period = payoutPeriod(now, cadence);

  const vendors = await Vendor.find({
    deletedAt: null,
    // `offboarded` and `rejected` vendors are not skipped-with-a-reason; they are not
    // participants. A skip row for a vendor who left would be a message to nobody.
    status: { $in: ["verified", "suspended"] },
  }).lean<VendorDoc[]>();

  const outcome: DraftOutcome = { drafted: [], skipped: [] };

  for (const vendor of vendors) {
    const vendorId = String(vendor._id);
    const skip = async (reason: PayoutSkipReason, balance?: Money) => {
      await recordSkip(vendorId, period, reason, balance);
      outcome.skipped.push({ vendorId, reason });
    };

    if (vendor.status === "suspended") {
      await skip("suspended");
      continue;
    }
    if (vendor.verification.business.status !== "approved") {
      // Vendor ticket 02's whole purpose: money must not leave to an unverified account.
      await skip("unverified");
      continue;
    }
    if (!vendor.payout?.accountIdentifier) {
      await skip("no_account");
      continue;
    }

    // Unclaimed cleared entries, grouped by currency — a vendor earning in two currencies
    // gets two payouts, because `money.ts` refuses to add them and inventing a rate here
    // would be an FX decision nobody took (decision **V5**).
    const claimable = await unclaimedCleared(vendorId);
    if (claimable.length === 0) {
      await skip("below_threshold", money(0, "GBP"));
      continue;
    }

    const byCurrency = new Map<string, LedgerEntryDoc[]>();
    for (const entry of claimable) {
      const bucket = byCurrency.get(entry.amount.currency) ?? [];
      bucket.push(entry);
      byCurrency.set(entry.amount.currency, bucket);
    }

    let draftedAny = false;
    let lastSkip: { reason: PayoutSkipReason; balance: Money } | null = null;

    for (const [currency, entries] of byCurrency) {
      if (!isCurrencyCode(currency)) continue;

      const total = sum(
        entries.map((entry) => money(entry.amount.amount, currency)),
        currency,
      );

      if (total.amount < 0) {
        lastSkip = { reason: "negative_balance", balance: total };
        continue;
      }

      const threshold = await payoutThreshold(currency);
      if (total.amount < threshold.amount) {
        lastSkip = { reason: "below_threshold", balance: total };
        continue;
      }

      const driver = payoutDriverFor(DEFAULT_PAYOUT_METHOD);
      if (
        !driver.supports({
          currency,
          ...(vendor.payout.country ? { country: vendor.payout.country } : {}),
        })
      ) {
        lastSkip = { reason: "no_account", balance: total };
        continue;
      }

      const payout = await createDraft({
        vendor,
        period,
        amount: total,
        entries,
        method: driver.key,
        ...(options.actor ? { actor: options.actor } : {}),
      });

      if (payout) {
        draftedAny = true;
        outcome.drafted.push({
          payoutId: String(payout._id),
          vendorId,
          reference: payout.reference,
          amount: total,
        });
      }
    }

    // A skip row only when *nothing* drafted. A vendor paid in GBP and short of the
    // threshold in NGN has been paid; telling them they were skipped would be false.
    if (!draftedAny && lastSkip) await skip(lastSkip.reason, lastSkip.balance);
  }

  return outcome;
}

/**
 * Cleared entries nobody has claimed.
 *
 * `payoutId` absent is the claim check, and it is why a second batch cannot see money the
 * first is about to send. Status alone would not do it: an entry stays `cleared` right up
 * until the transfer settles, precisely so a failed transfer strands nothing.
 */
async function unclaimedCleared(vendorId: string): Promise<LedgerEntryDoc[]> {
  return LedgerEntry.find({
    vendorId: toObjectId(vendorId),
    status: "cleared",
    payoutId: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .lean<LedgerEntryDoc[]>();
}

/**
 * Create the draft and stamp the claim, atomically.
 *
 * Returns `null` when the unique `(vendorId, periodStart, periodEnd)` index refuses — which
 * means another run of the same batch got there first, and is the second of the three
 * idempotency guards. Not an error: the desired state already exists.
 */
async function createDraft(input: {
  vendor: VendorDoc;
  period: { start: Date; end: Date };
  amount: Money;
  entries: LedgerEntryDoc[];
  method: string;
  actor?: AuditActor;
}): Promise<PayoutDoc | null> {
  const write = async (session?: ClientSession) => {
    const reference = await generateReference(counterStore(session), "POU");

    const [created] = await Payout.create(
      [
        {
          reference,
          vendorId: input.vendor._id,
          amount: toDocument(input.amount),
          status: "draft",
          method: input.method,
          periodStart: input.period.start,
          periodEnd: input.period.end,
          entryIds: input.entries.map((entry) => entry._id),
        },
      ],
      session ? { session, ordered: true } : { ordered: true },
    );

    if (!created) throw new Error("Payout.create returned nothing.");

    // The claim. Guarded on the entries still being unclaimed, so two simultaneous drafts
    // cannot both take them — the loser writes fewer than it listed and aborts.
    const claim = await LedgerEntry.updateMany(
      { _id: { $in: input.entries.map((entry) => entry._id) }, payoutId: { $exists: false } },
      { $set: { payoutId: created._id } },
      session ? { session } : {},
    );

    if (claim.modifiedCount !== input.entries.length) {
      throw new ConflictError(
        "Some of those ledger entries were claimed by another payout while this batch " +
          "was drafting. Nothing was written; the next run will pick them up.",
      );
    }

    await writeAuditLog(
      {
        action: "payout.drafted",
        actor: input.actor ?? { type: "system" },
        subject: { type: "vendor", id: String(input.vendor._id) },
        after: {
          reference,
          amount: input.amount.amount,
          currency: input.amount.currency,
          entries: input.entries.length,
        },
        source: "system",
      },
      session,
    );

    return created.toObject() as PayoutDoc;
  };

  try {
    return supportsTransactions() ? await withTransaction(write) : await write();
  } catch (error) {
    if (isDuplicatePeriod(error)) return null;
    throw error;
  }
}

async function recordSkip(
  vendorId: string,
  period: { start: Date; end: Date },
  reason: PayoutSkipReason,
  balance?: Money,
): Promise<void> {
  // Upserted against the unique period index, so a re-run overwrites the reason rather than
  // appending a second row — and the reason can only have changed if the situation did.
  await PayoutSkip.findOneAndUpdate(
    { vendorId: toObjectId(vendorId), periodStart: period.start, periodEnd: period.end },
    { $set: { reason, ...(balance ? { balance: toDocument(balance) } : {}) } },
    { upsert: true, returnDocument: "after" },
  );
}

/* ────────────────────────────────────────────── the human decisions */

/**
 * `draft → approved`. A person, holding `payout.approve`, and no code path anywhere else.
 *
 * The guard is in the action; what this enforces is that the transition is legal and that
 * nobody approved it twice.
 */
export async function approve(payoutId: string, actor: AuditActor): Promise<PayoutDoc> {
  return transition(payoutId, "approved", actor, {
    stamp: (userId) => (userId ? { approvedByUserId: toObjectId(userId) } : {}),
  });
}

/** `draft → cancelled` or `approved → cancelled`, releasing the claim. */
export async function cancel(
  payoutId: string,
  reason: string,
  actor: AuditActor,
): Promise<PayoutDoc> {
  if (!reason.trim()) {
    throw new ValidationError("Say why this payout was cancelled.", {
      reason: ["The vendor may ask, and somebody will have to answer."],
    });
  }

  const cancelled = await transition(payoutId, "cancelled", actor, {
    stamp: () => ({ failureReason: reason.trim() }),
    // Released, not paid: the entries go back to the pool and the next batch picks them up.
    release: true,
  });

  return cancelled;
}

/**
 * `approved → sending`, then ask the driver.
 *
 * The status moves **before** the driver is called, deliberately. If the call throws after
 * the bank has accepted the instruction, a payout left in `approved` would be sent again by
 * the next person to press the button; one left in `sending` is a question somebody has to
 * answer, which is the failure mode to prefer when the alternative is paying twice.
 */
export async function send(payoutId: string, actor: AuditActor): Promise<PayoutDoc> {
  await connectToDatabase();

  const payout = await findById(payoutId);
  if (!payout) throw new NotFoundError("payout", { id: payoutId });

  const vendor = await Vendor.findById(payout.vendorId).lean<VendorDoc>();
  if (!vendor) throw new NotFoundError("vendor", { id: String(payout.vendorId) });

  if (!vendor.payout?.accountIdentifier) {
    throw new ValidationError("This vendor has no payout account on file.", {
      account: ["Ask them to add one before sending."],
    });
  }

  const sending = await transition(payoutId, "sending", actor, {
    stamp: (userId) => (userId ? { sentByUserId: toObjectId(userId) } : {}),
  });

  const driver = payoutDriverFor(payout.method);
  const result = await driver.send({
    reference: payout.reference,
    amount: money(payout.amount.amount, payout.amount.currency as never),
    account: vendor.payout,
    vendor: {
      id: String(vendor._id),
      displayName: vendor.displayName,
      contactEmail: vendor.contactEmail,
    },
  });

  if (result.status === "paid") {
    return markPaid(
      payoutId,
      result.externalReference ? { externalReference: result.externalReference } : {},
      actor,
    );
  }
  if (result.status === "failed") {
    return markFailed(payoutId, result.failureReason ?? "The provider refused it.", actor);
  }

  // `sent`: instructed and waiting. The `manual` driver always lands here, and a person
  // records the confirmation afterwards.
  if (result.externalReference) {
    await Payout.updateOne(
      { _id: toObjectId(payoutId) },
      { $set: { externalReference: result.externalReference } },
    );
  }

  return sending;
}

/**
 * `sending → paid`, **with the entries, in one transaction**.
 *
 * This is guard 1 and guard 3 together, and the most important function in the file. The
 * entry update is conditional on each entry still being `cleared` *and* still claimed by this
 * payout; a count mismatch aborts, which is what makes "an entry cannot appear in two
 * payouts" a property of the database rather than a promise about the code.
 */
export async function markPaid(
  payoutId: string,
  input: {
    externalReference?: string;
    evidence?: { storageKey: string; filename: string; contentType?: string };
  },
  actor: AuditActor,
): Promise<PayoutDoc> {
  await connectToDatabase();

  const before = await findById(payoutId);
  if (!before) throw new NotFoundError("payout", { id: payoutId });

  // A retried confirmation of an already-paid payout changes nothing, and says so rather
  // than throwing: the desired state exists, and the person clicking twice is not wrong.
  if (before.status === "paid") return before;

  assertTransition("payout", PAYOUT_TRANSITIONS, before.status, "paid");

  const paidAt = new Date();

  const write = async (session?: ClientSession) => {
    const updated = await Payout.findOneAndUpdate(
      { _id: toObjectId(payoutId), status: before.status },
      {
        $set: {
          status: "paid",
          paidAt,
          ...(input.externalReference ? { externalReference: input.externalReference } : {}),
          ...(input.evidence
            ? {
                evidenceKey: input.evidence.storageKey,
                evidenceFilename: input.evidence.filename,
                ...(input.evidence.contentType
                  ? { evidenceContentType: input.evidence.contentType }
                  : {}),
              }
            : {}),
        },
        $unset: { failureReason: "" },
      },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<PayoutDoc>();

    if (!updated) {
      throw new ConflictError(
        "Somebody else moved this payout while you were confirming it. Reload and look again.",
      );
    }

    const settled = await LedgerEntry.updateMany(
      { _id: { $in: before.entryIds }, payoutId: toObjectId(payoutId), status: "cleared" },
      { $set: { status: "paid" } },
      session ? { session } : {},
    );

    if (settled.modifiedCount !== before.entryIds.length) {
      throw new ConflictError(
        `This payout claims ${before.entryIds.length} ledger entries and only ` +
          `${settled.modifiedCount} were still payable — one may have been reversed by a ` +
          `refund. Nothing was written. Cancel this payout and let the next batch redraft it.`,
      );
    }

    await writeAuditLog(
      {
        action: "payout.paid",
        actor,
        subject: { type: "vendor", id: String(before.vendorId) },
        ...statusChange(before.status, "paid", {
          reference: before.reference,
          amount: before.amount.amount,
          currency: before.amount.currency,
          entries: before.entryIds.length,
        }),
      },
      session,
    );

    return updated;
  };

  const updated = supportsTransactions() ? await withTransaction(write) : await write();

  await emit("VendorPayoutPaid", {
    vendorId: String(before.vendorId),
    payoutId,
    reference: before.reference,
    amount: before.amount.amount,
    currency: before.amount.currency,
  });

  return updated;
}

/**
 * A refused transfer.
 *
 * The entries **never left `cleared`** — they only become `paid` when a transfer settles —
 * so nothing has to be put back. What happens here is that the reason is recorded and the
 * payout returns to `approved`, still holding its claim, so the next attempt pays exactly
 * the same entries rather than a recomputed set that may have drifted.
 *
 * Two legal transitions in one call (`sending → failed → approved`), because "failed" is a
 * fact about an attempt and "approved" is where the payout now sits. Both are audited. A
 * payout that should not be retried is cancelled by a person, which releases the claim.
 */
export async function markFailed(
  payoutId: string,
  reason: string,
  actor: AuditActor,
): Promise<PayoutDoc> {
  await connectToDatabase();

  const failed = await transition(payoutId, "failed", actor, {
    stamp: () => ({ failureReason: reason.trim() || "The transfer failed." }),
  });

  const requeued = await transition(payoutId, "approved", actor, {});

  await emit("VendorPayoutFailed", {
    vendorId: String(failed.vendorId),
    payoutId,
    reference: failed.reference,
    reason: failed.failureReason ?? reason,
  });

  return requeued;
}

/**
 * A payout stuck in `sending` — the outbound equivalent of a payment pending too long.
 *
 * Asks the driver, because an automated one can answer. The `manual` driver truthfully says
 * "still sending", so this surfaces the payout for a **person** rather than resolving it,
 * which is right: for a manual payout, the person is the provider.
 */
export async function reconcileSending(
  olderThanHours = 48,
): Promise<{ checked: number; resolved: number; stuck: PayoutDoc[] }> {
  await connectToDatabase();

  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const candidates = await Payout.find({ status: "sending", updatedAt: { $lte: cutoff } })
    .limit(200)
    .lean<PayoutDoc[]>();

  const stuck: PayoutDoc[] = [];
  let resolved = 0;

  for (const payout of candidates) {
    const driver = payoutDriverFor(payout.method);

    if (!payout.externalReference) {
      stuck.push(payout);
      continue;
    }

    const status = await driver.verify(payout.externalReference);
    if (status.status === "paid") {
      await markPaid(String(payout._id), {}, { type: "system" });
      resolved += 1;
    } else if (status.status === "failed") {
      await markFailed(
        String(payout._id),
        status.failureReason ?? "The provider reported a failure.",
        { type: "system" },
      );
      resolved += 1;
    } else {
      stuck.push(payout);
    }
  }

  return { checked: candidates.length, resolved, stuck };
}

/* ────────────────────────────────────────────── the shared transition */

async function transition(
  payoutId: string,
  to: PayoutStatus,
  actor: AuditActor,
  options: {
    stamp?: (userId?: string) => Record<string, unknown>;
    /** Release the entry claim — cancellation only. */
    release?: boolean;
  },
): Promise<PayoutDoc> {
  await connectToDatabase();

  const before = await findById(payoutId);
  if (!before) throw new NotFoundError("payout", { id: payoutId });

  const from = before.status;
  assertTransition("payout", PAYOUT_TRANSITIONS, from, to);

  const userId = "userId" in actor ? actor.userId : undefined;

  const write = async (session?: ClientSession) => {
    const updated = await Payout.findOneAndUpdate(
      { _id: toObjectId(payoutId), status: from },
      { $set: { status: to, ...(options.stamp?.(userId) ?? {}) } },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<PayoutDoc>();

    if (!updated) {
      throw new ConflictError(
        "Somebody else moved this payout while you were deciding. Reload and look again.",
      );
    }

    if (options.release) {
      await LedgerEntry.updateMany(
        { payoutId: toObjectId(payoutId), status: "cleared" },
        { $unset: { payoutId: "" } },
        session ? { session } : {},
      );
    }

    await writeAuditLog(
      {
        action: "payout.status_changed",
        actor,
        subject: { type: "vendor", id: String(before.vendorId) },
        ...statusChange(from, to, { reference: before.reference }),
      },
      session,
    );

    return updated;
  };

  return supportsTransactions() ? await withTransaction(write) : await write();
}

/* ────────────────────────────────────────────── reading */

export async function findById(payoutId: string): Promise<PayoutDoc | null> {
  await connectToDatabase();
  return Payout.findById(toObjectId(payoutId)).lean<PayoutDoc>();
}

/** By reference, scoped when a vendor asks — 404 rather than 403 for somebody else's. */
export async function findByReference(
  reference: string,
  scope?: VendorScope,
): Promise<PayoutDoc | null> {
  await connectToDatabase();
  return Payout.findOne({
    reference: reference.trim().toUpperCase(),
    ...(scope ? vendorFilter(scope) : {}),
  }).lean<PayoutDoc>();
}

export async function listForVendor(scope: VendorScope, limit = 50): Promise<PayoutDoc[]> {
  await connectToDatabase();
  return Payout.find(vendorFilter(scope))
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean<PayoutDoc[]>();
}

export async function listByStatus(
  status: PayoutStatus | undefined,
  limit = 100,
): Promise<PayoutDoc[]> {
  await connectToDatabase();
  return Payout.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 500))
    .lean<PayoutDoc[]>();
}

/** The most recent skip for a vendor, so their earnings screen can say why. */
export async function latestSkipFor(scope: VendorScope) {
  await connectToDatabase();
  return PayoutSkip.findOne(vendorFilter(scope)).sort({ createdAt: -1 }).lean();
}

/** How many payouts are waiting on a person — for `/staff`'s counters. */
export async function countAwaitingDecision(): Promise<number> {
  await connectToDatabase();
  return Payout.countDocuments({ status: { $in: ["draft", "failed"] } });
}

function isDuplicatePeriod(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
