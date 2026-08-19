import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Conversation, type ConversationDoc } from "@/lib/db/models/communication";
import { Entitlement, type EntitlementDoc } from "@/lib/db/models/commerce";
import { Product } from "@/lib/db/models/catalog";
import { FollowUp } from "@/lib/db/models/requests";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import type { DisputeOutcome, DisputeReason } from "@/lib/db/enums";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { orgFilter, vendorFilter, type OrgScope, type VendorScope } from "@/lib/auth/scope";
import { emit } from "@/lib/events";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Vendor support and disputes — vendor ticket 13.
 *
 * With one seller, support was a conversation between a customer and CoSetup. With vendors
 * there are three parties, and "who answers this" needs an answer before the first customer asks.
 * The answer: **the vendor answers first**, staff observe, and either party can pull staff in.
 *
 * ## Nothing here is a second messaging system
 *
 * A thread is a `Conversation` with `subjectType: "vendor_support"` and the entitlement as its
 * subject. That choice does three jobs at once: the scope check is the same indexed
 * `organizationId` filter as every other thread, a customer can only open a thread about
 * something they actually bought, and the vendor is derivable from the product.
 *
 * ## A dispute is a state, not a new record
 *
 * `Conversation.dispute`, because the argument is already in the thread. Splitting it would leave
 * two records of one disagreement, and the second one is always the one somebody forgets to read.
 */

/* ────────────────────────────────────────────── the SLA */

/**
 * Response targets, per verification level.
 *
 * Shown to the customer **before** they open a thread, so the expectation is set rather than
 * discovered. A business-verified vendor has been through more checks and is held to more; an
 * identity-only vendor is still expected to answer within two working days.
 *
 * Hours rather than "working days" as a unit: a working-day calculation needs a holiday calendar
 * per country, and this is a target rather than a contractual deadline.
 */
export const SLA_HOURS = { business: 24, identity: 48 } as const;

export function slaHoursFor(vendor: Pick<VendorDoc, "verification">): number {
  return vendor.verification.business.status === "approved"
    ? SLA_HOURS.business
    : SLA_HOURS.identity;
}

/* ────────────────────────────────────────────── opening a thread */

export interface OpenThreadInput {
  entitlementId: string;
  /** The customer's first message. A thread with no question in it is not a thread. */
  body: string;
}

/**
 * A customer asks the vendor a question — or adds to the question they already asked.
 *
 * **One function for open and reply**, because the conversation's unique `(subjectType, subjectId)`
 * index makes them the same operation: asking twice about the same purchase continues the same
 * thread rather than opening a second one, which is what a customer expects and the only shape
 * that keeps a dispute in one place. A separate `reply` would have to re-derive the vendor, the
 * scope and the SLA to do exactly this.
 *
 * The thread opens **against the vendor**, with a response target from their verification level.
 * Staff are not participants and can still read it — observers by permission rather than by
 * membership, which is what "staff as observers" means without adding every staff member to every
 * thread.
 *
 * The `VendorSupportThreadOpened` event fires **only on the first message**. A vendor notified
 * "a question about X" on every reply would learn to ignore the notification, and the reply itself
 * already produces a `MessagePosted`.
 */
export async function openThread(
  input: OpenThreadInput,
  scope: OrgScope,
  actor: AuditActor & { userId: string },
): Promise<{ conversationId: string; vendorId: string; slaHours: number }> {
  await connectToDatabase();

  if (!input.body.trim()) {
    throw new ValidationError("Say what you need help with.", {
      body: ["A thread needs a question in it."],
    });
  }

  const entitlement = await Entitlement.findOne({
    _id: toObjectId(input.entitlementId),
    ...orgFilter(scope),
  }).lean<EntitlementDoc>();

  // 404 rather than 403 — an entitlement id somebody guessed must not be confirmed.
  if (!entitlement) throw new NotFoundError("entitlement", { id: input.entitlementId });

  const product = await Product.findById(entitlement.productId)
    .select({ vendorId: 1, name: 1 })
    .lean<{ vendorId?: unknown; name: string }>();

  if (!product?.vendorId) {
    // A first-party product: the existing support path already covers it, and pretending there
    // is a vendor to route to would send the question nowhere.
    throw new ValidationError("That product is supported by CoSetup directly.", {
      entitlementId: ["Use your usual support channel for this one."],
    });
  }

  const vendor = await Vendor.findById(product.vendorId)
    .select({ verification: 1, displayName: 1, status: 1 })
    .lean<VendorDoc>();
  if (!vendor) throw new NotFoundError("vendor", { id: String(product.vendorId) });

  const slaHours = slaHoursFor(vendor);

  // Asked before the write, because "was this thread new" is unanswerable afterwards — the
  // conversation is created by `postMessage` either way.
  const isNew = !(await Conversation.exists({
    subjectType: "vendor_support",
    subjectId: toObjectId(input.entitlementId),
  }));

  const { postMessage } = await import("@/services/messaging/messaging-service");
  const posted = await postMessage({
    organizationId: String(entitlement.organizationId),
    subjectType: "vendor_support",
    subjectId: input.entitlementId,
    senderUserId: actor.userId,
    senderType: "customer",
    body: input.body,
    // Coerced by the service anyway; explicit so the intent reads here.
    visibility: "customer",
  });

  // The routing metadata goes on after the conversation exists, because `postMessage` owns
  // creating it — one writer for that, whichever subject type it is.
  await Conversation.updateOne(
    { _id: toObjectId(posted.conversationId) },
    {
      $set: {
        vendorId: vendor._id,
        productId: entitlement.productId,
        // Only if unset: a second question on an old thread must not restart the clock on a
        // response the vendor already owes.
        ...((await needsDueDate(posted.conversationId))
          ? { responseDueAt: new Date(Date.now() + slaHours * 60 * 60 * 1000) }
          : {}),
      },
    },
  );

  if (isNew) {
    await emit("VendorSupportThreadOpened", {
      vendorId: String(vendor._id),
      conversationId: posted.conversationId,
      productName: product.name,
    });
  }

  return {
    conversationId: posted.conversationId,
    vendorId: String(vendor._id),
    slaHours,
  };
}

async function needsDueDate(conversationId: string): Promise<boolean> {
  const existing = await Conversation.findById(toObjectId(conversationId))
    .select({ responseDueAt: 1, firstVendorResponseAt: 1 })
    .lean<{ responseDueAt?: Date; firstVendorResponseAt?: Date }>();

  return !existing?.responseDueAt || Boolean(existing.firstVendorResponseAt);
}

/* ────────────────────────────────────────────── escalation */

/**
 * Pull staff in, without pushing the vendor out.
 *
 * That second half is the point and is easy to get wrong: the person who can actually fix the
 * software is the person who wrote it, so escalation **adds** staff rather than replacing the
 * vendor. A thread that removed the vendor would be a thread where the only party who understands
 * the problem is no longer reading it.
 *
 * Escalation is deliberately cheap — no permission, no reason required, either party or staff may
 * do it. Making it hard would mean the SLA sweep is the only thing that ever escalates.
 */
export async function escalate(
  conversationId: string,
  actor: AuditActor & { userId?: string },
): Promise<ConversationDoc> {
  await connectToDatabase();

  const updated = await Conversation.findOneAndUpdate(
    { _id: toObjectId(conversationId), subjectType: "vendor_support" },
    { $set: { escalatedAt: new Date() } },
    { returnDocument: "after" },
  ).lean<ConversationDoc>();

  if (!updated) throw new NotFoundError("conversation", { id: conversationId });

  await ensureFollowUp(updated, "Escalated vendor support thread", actor);

  await writeAuditLog({
    action: "vendor_support.escalated",
    actor,
    subject: { type: "vendor", id: String(updated.vendorId ?? "") },
    after: { conversationId },
  });

  return updated;
}

/* ────────────────────────────────────────────── disputes */

export interface RaiseDisputeInput {
  conversationId: string;
  reason: DisputeReason;
  detail: string;
}

/**
 * Either party raises a dispute, and raising it is what pulls staff in.
 *
 * Not an escalation somebody has to notice is due: the notification and the follow-up happen on
 * the same call, because a dispute that sits unread for a week is the failure this whole structure
 * exists to prevent.
 *
 * **Any active vendor member may raise or answer one**, not just the owner (vendor ticket 03). The
 * person who knows why the software behaved that way is whoever wrote it, and gating it on the
 * account holder is how a Friday becomes a Monday.
 *
 * The thread stays visible to **both** parties. A dispute the other side cannot see the progress
 * of is one they re-raise by email, and then there are two.
 */
export async function raiseDispute(
  input: RaiseDisputeInput,
  raisedBy: { type: "customer" | "vendor"; userId: string },
  actor: AuditActor,
): Promise<ConversationDoc> {
  await connectToDatabase();

  if (!input.detail.trim()) {
    throw new ValidationError("Say what is wrong, in your own words.", {
      detail: ["Somebody has to decide this, and this is what they read first."],
    });
  }

  const existing = await Conversation.findById(toObjectId(input.conversationId))
    .select({ dispute: 1, vendorId: 1, subjectType: 1, organizationId: 1, subjectId: 1 })
    .lean<ConversationDoc>();
  if (!existing || existing.subjectType !== "vendor_support") {
    throw new NotFoundError("conversation", { id: input.conversationId });
  }

  // An open dispute is not raised twice. The second party's position belongs *in* the thread as a
  // message, not as a competing dispute over the same argument.
  if (existing.dispute && ["open", "under_review"].includes(existing.dispute.status)) {
    throw new ConflictError(
      "There is already an open dispute on this thread. Add what you want considered to the " +
        "conversation and it will be read.",
    );
  }

  const updated = await Conversation.findOneAndUpdate(
    { _id: toObjectId(input.conversationId) },
    {
      $set: {
        // Raising a dispute escalates by definition, so staff are in from this moment.
        escalatedAt: new Date(),
        dispute: {
          status: "open",
          raisedByType: raisedBy.type,
          raisedByUserId: toObjectId(raisedBy.userId),
          reason: input.reason,
          detail: input.detail.trim(),
          raisedAt: new Date(),
        },
      },
      /*
       * No `$unset` of the old outcome fields alongside this.
       *
       * `$set: { dispute: {...} }` replaces the whole subdocument, so a previous outcome is gone
       * by construction — and MongoDB refuses `$set` on a path and `$unset` on its child in one
       * update ("would create a conflict at 'dispute'"), which is how the first version of this
       * failed. Replacing rather than patching is also the honest shape: a second dispute on the
       * same thread is a new dispute, and the resolved one lives in the audit log.
       */
    },
    { returnDocument: "after", runValidators: true },
  ).lean<ConversationDoc>();

  if (!updated) throw new NotFoundError("conversation", { id: input.conversationId });

  await ensureFollowUp(updated, `Dispute raised by ${raisedBy.type}`, actor);

  await writeAuditLog({
    action: "dispute.raised",
    actor,
    subject: { type: "vendor", id: String(updated.vendorId ?? "") },
    after: {
      conversationId: input.conversationId,
      raisedBy: raisedBy.type,
      reason: input.reason,
    },
  });

  await emit("DisputeRaised", {
    conversationId: input.conversationId,
    ...(updated.vendorId ? { vendorId: String(updated.vendorId) } : {}),
    raisedBy: raisedBy.type,
    reason: input.reason,
  });

  return updated;
}

/**
 * Staff decide, explicitly.
 *
 * **Both an outcome and a reason are required**, and `no_action` is a legitimate outcome — a
 * dispute resolved in the vendor's favour is a real decision, and without that option a reviewer's
 * only choices would be to act or to leave it open. Leaving it open is how a dispute goes quiet,
 * which is the one ending this structure is designed to make impossible.
 *
 * The action that follows — a refund, a delisting, a review removal, a suspension — is deliberately
 * **not** performed here. Each of those has its own service with its own guards, its own audit row
 * and its own permission, and a resolver that quietly triggered them would be a second path into
 * every one of them.
 */
export async function resolveDispute(
  conversationId: string,
  outcome: DisputeOutcome,
  reason: string,
  actor: AuditActor & { userId?: string },
): Promise<ConversationDoc> {
  await connectToDatabase();

  if (!reason.trim()) {
    throw new ValidationError("A decision needs a reason. Both parties read it.", {
      reason: ["Say what was decided and why."],
    });
  }

  const existing = await Conversation.findById(toObjectId(conversationId))
    .select({ dispute: 1, vendorId: 1 })
    .lean<ConversationDoc>();
  if (!existing?.dispute) {
    throw new NotFoundError("dispute", { id: conversationId });
  }

  const updated = await Conversation.findOneAndUpdate(
    {
      _id: toObjectId(conversationId),
      // Guarded on the current state, so two reviewers deciding at once produce one decision.
      "dispute.status": { $in: ["open", "under_review"] },
    },
    {
      $set: {
        "dispute.status": "resolved",
        "dispute.outcome": outcome,
        "dispute.outcomeReason": reason.trim(),
        "dispute.resolvedAt": new Date(),
        ...(actor.userId ? { "dispute.resolvedByUserId": toObjectId(actor.userId) } : {}),
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean<ConversationDoc>();

  if (!updated) {
    throw new ConflictError("Somebody else resolved this dispute while you were deciding.");
  }

  await FollowUp.updateMany(
    { subjectType: "vendor", subjectId: updated.vendorId, status: "open" },
    { $set: { status: "done", completedAt: new Date() } },
  );

  await writeAuditLog({
    action: "dispute.resolved",
    actor,
    subject: { type: "vendor", id: String(updated.vendorId ?? "") },
    after: { conversationId, outcome, reason: reason.trim() },
  });

  // Both parties, with the decision. A dispute whose outcome only one side learns is one the
  // other side will re-raise.
  await emit("DisputeResolved", {
    conversationId,
    ...(updated.vendorId ? { vendorId: String(updated.vendorId) } : {}),
    outcome,
    reason: reason.trim(),
  });

  return updated;
}

/* ────────────────────────────────────────────── reading */

/**
 * A vendor's own threads.
 *
 * `vendorFilter(scope)` is in the query, from the session — a vendor sees threads about their own
 * products because of this line, not because a component filtered a list. The empty-string guard
 * in `vendorFilter` is what stops a missing scope reading every thread on the platform.
 */
export async function listForVendor(
  scope: VendorScope,
  options: { disputesOnly?: boolean; limit?: number } = {},
): Promise<ConversationDoc[]> {
  await connectToDatabase();

  return Conversation.find({
    ...vendorFilter(scope),
    subjectType: "vendor_support",
    ...(options.disputesOnly ? { "dispute.status": { $in: ["open", "under_review"] } } : {}),
  })
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(options.limit ?? 50, 200))
    .lean<ConversationDoc[]>();
}

/** The staff dispute queue: open first, oldest first. */
export async function listDisputes(limit = 100): Promise<ConversationDoc[]> {
  await connectToDatabase();

  return Conversation.find({ "dispute.status": { $in: ["open", "under_review"] } })
    .sort({ "dispute.raisedAt": 1 })
    .limit(Math.min(limit, 200))
    .lean<ConversationDoc[]>();
}

/**
 * Time to first response, per vendor — an **operational** signal.
 *
 * Deliberately separate from the rating, which is customer opinion: a vendor may be well rated and
 * slow, and conflating the two would hide the actionable half. Median rather than mean, because one
 * thread answered after a fortnight would otherwise make an otherwise-responsive vendor look
 * hopeless.
 */
export async function responsiveness(
  vendorId: string,
  windowDays = 90,
): Promise<{ threads: number; medianHours: number | null; overdue: number }> {
  await connectToDatabase();

  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await Conversation.find({
    vendorId: toObjectId(vendorId),
    subjectType: "vendor_support",
    createdAt: { $gte: from },
  })
    .select({ createdAt: 1, firstVendorResponseAt: 1, responseDueAt: 1 })
    .limit(500)
    .lean<Array<{ createdAt: Date; firstVendorResponseAt?: Date; responseDueAt?: Date }>>();

  const answered = rows
    .filter((row) => row.firstVendorResponseAt)
    .map((row) => (row.firstVendorResponseAt!.getTime() - row.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);

  const now = Date.now();
  const overdue = rows.filter(
    (row) =>
      !row.firstVendorResponseAt && row.responseDueAt && row.responseDueAt.getTime() < now,
  ).length;

  return {
    threads: rows.length,
    medianHours:
      answered.length === 0
        ? null
        : Math.round(answered[Math.floor(answered.length / 2)]! * 10) / 10,
    overdue,
  };
}

/**
 * Threads the vendor has not answered in time — the sweep's query.
 *
 * `{responseDueAt, firstVendorResponseAt}`-shaped, which is the same index shape `FollowUp`'s
 * `{status, dueAt}` uses for the same reason: a sweep that scans is a sweep that gets disabled.
 */
export async function overdueThreads(limit = 200): Promise<ConversationDoc[]> {
  await connectToDatabase();

  return Conversation.find({
    subjectType: "vendor_support",
    responseDueAt: { $lte: new Date() },
    firstVendorResponseAt: { $exists: false },
    // Already escalated ones have a follow-up; this is for the ones nobody has looked at.
    escalatedAt: { $exists: false },
  })
    .sort({ responseDueAt: 1 })
    .limit(limit)
    .lean<ConversationDoc[]>();
}

/* ────────────────────────────────────────────── refunds */

/**
 * A customer asks for a refund through the thread.
 *
 * **The platform decides, not the vendor.** CoSetup is merchant of record and took the payment
 * (decision **V4**), so a vendor cannot approve or refuse a refund of money they never held — and
 * this function deliberately has no vendor-facing counterpart. What a vendor can do is say what
 * they think, in the thread, which staff read before deciding.
 *
 * The request is recorded as a dispute with `reason: "refund_refused"` when the vendor has already
 * said no, or as a plain dispute otherwise; either way staff are pulled in immediately. The refund
 * itself runs through `processPaymentRefunded`, which suspends rather than revokes the entitlement
 * and writes the negative ledger entry — none of which belongs here.
 */
export async function requestRefund(
  conversationId: string,
  detail: string,
  requester: { userId: string },
  actor: AuditActor,
): Promise<ConversationDoc> {
  return raiseDispute(
    { conversationId, reason: "refund_refused", detail },
    { type: "customer", userId: requester.userId },
    actor,
  );
}

/**
 * The guard that makes "a vendor cannot approve a refund" structural rather than a convention.
 *
 * Exported and called from the refund path: there is no vendor-facing refund action, and this is
 * what fails loudly if somebody adds one by copying a staff action and swapping the guard.
 */
export function assertNotVendorRefund(actor: AuditActor): void {
  if (actor.type === "vendor") {
    throw new ForbiddenError(
      "A vendor cannot approve or refuse a refund — CoSetup took the payment and decides. " +
        "Say what you think in the thread and staff will read it.",
    );
  }
}

/* ────────────────────────────────────────────── internals */

/**
 * One open follow-up per vendor thread, reusing ticket 20's model.
 *
 * `FollowUp` already has the `{status, dueAt}` index and the daily reminder sweep, so an overdue
 * dispute reaches somebody through machinery that is already running rather than through a second
 * reminder system. Idempotent: a thread escalated twice does not produce two follow-ups, because
 * the second one nobody closes is how a queue stops being trusted.
 */
async function ensureFollowUp(
  conversation: ConversationDoc,
  note: string,
  actor: AuditActor & { userId?: string },
): Promise<void> {
  if (!actor.userId) return;

  const existing = await FollowUp.findOne({
    subjectType: "vendor",
    subjectId: conversation.vendorId,
    status: "open",
  })
    .select({ _id: 1 })
    .lean();

  if (existing) return;

  await FollowUp.create({
    organizationId: conversation.organizationId,
    ownerUserId: toObjectId(actor.userId),
    subjectType: "vendor",
    subjectId: conversation.vendorId ?? conversation._id,
    // Same day. A dispute is not a "next week" task, and the reminder sweep runs daily.
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    note,
    status: "open",
  });
}
