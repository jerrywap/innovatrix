import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { Product } from "@/lib/db/models/catalog";
import {
  VendorBrief,
  type VendorBriefDoc,
  type BriefRequirement,
} from "@/lib/db/models/briefs";
import { CustomerRequest, type CustomerRequestDoc } from "@/lib/db/models/requests";
import { Vendor } from "@/lib/db/models/vendors";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";
import { emit } from "@/lib/events";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import * as requestService from "@/services/requests/request-service";

/**
 * Vendor-directed customization — vendor ticket 14.
 *
 * A customer asks for changes to a vendor's product. The vendor is the one who knows the code and
 * the one who can say what a change costs, so the request reaches them — **without reaching the
 * customer's identity**, which is decision W2.
 *
 * ## Mediation is two threads, not a visibility flag
 *
 * The §37 table says a `customer`-visibility message is visible to the **vendor**; that is what makes
 * a support thread three-party. There is no level meaning "customer and staff but not the vendor",
 * and `VendorMessage extends CustomerMessage` so it carries `senderName` too. A fourth level would
 * fix the projection and not the problem: `visibility` defaults to `customer` on a customer's own
 * message, so one missed case exposes the history — and no rule stops a customer typing their own
 * phone number into a body.
 *
 * So the vendor is not a participant in the customer's conversation at all. Two subjects:
 *
 * - `request` — customer ↔ staff, exactly as before this ticket.
 * - `vendor_brief` — staff ↔ vendor, keyed by the brief.
 *
 * Staff relay between them. That is more staff work and it is the point: mediation that depends on
 * nobody making a mistake is not mediation.
 *
 * ## Where the redaction happens
 *
 * Once, in `briefFrom()`, and nowhere else. This is the only module that reads a `CustomerRequest`
 * in order to write a `VendorBrief`, which is what makes "the vendor cannot see who asked" a claim
 * about one function rather than about a codebase. Everything downstream reads the brief.
 *
 * ## What this does not do
 *
 * The vendor never moves the customer's request. `technical_review` already exists in
 * `REQUEST_TRANSITIONS` and *with the vendor* is what it means for a vendor-owned request, so
 * routing is an ordinary staff transition and `TransitionRule` keeps its two actors. A vendor
 * declining is a **brief** outcome; staff then decide what the request does, because only they can
 * see the customer it belongs to.
 */

/* ────────────────────────────────────────────── the staff side */

export interface RouteInput {
  requestId: string;
  /** Sent to the vendor verbatim, above the requirements. Optional; staff often have context. */
  note?: string;
}

/**
 * Hand a request to the vendor whose product it is about.
 *
 * Deliberately a separate act from submission (decision W3): `submitFromConversation` stamps
 * `vendorId` and tells nobody, so junk, abuse and off-topic requests never reach a vendor. This is
 * the gate, and a staff member is standing at it.
 *
 * Refusals, in the order they are checked:
 *
 * 1. No such request → 404.
 * 2. First-party product → a `ValidationError` naming that, because "route to vendor" on a product
 *    the platform wrote has no destination and a silent no-op would look like it worked.
 * 3. A brief already open → `ConflictError`. One open brief per request: two vendors cannot be
 *    pricing the same work, and the same vendor holding two copies is how a stale one gets answered.
 * 4. Vendor not `verified` → refused. An unverified vendor cannot list a product, and asking them to
 *    price bespoke work on one would be extending them a relationship they have not been granted.
 */
export async function routeToVendor(
  input: RouteInput,
  actor: AuditActor & { userId: string },
): Promise<VendorBriefDoc> {
  await connectToDatabase();

  const request = await CustomerRequest.findById(toObjectId(input.requestId))
    .lean<CustomerRequestDoc>()
    .exec();
  if (!request) throw new NotFoundError("request", { id: input.requestId });

  if (!request.vendorId) {
    throw new ValidationError(
      request.baseProductId
        ? "That product is ours, so there is no vendor to send it to."
        : "A custom build has no base product, so there is no vendor to send it to.",
      { requestId: ["This one stays with us."] },
    );
  }

  const open = await VendorBrief.findOne({
    requestId: request._id,
    status: { $in: ["sent", "answered"] },
  })
    .lean<VendorBriefDoc>()
    .exec();

  if (open) {
    throw new ConflictError(
      open.status === "sent"
        ? "The vendor already has this one and has not come back yet."
        : "The vendor has already priced this one. Withdraw that brief before sending another.",
    );
  }

  const vendor = await Vendor.findById(request.vendorId)
    .select({ status: 1, displayName: 1 })
    .lean<{ status: string; displayName: string }>()
    .exec();
  if (!vendor) throw new NotFoundError("vendor", { id: String(request.vendorId) });

  if (vendor.status !== "verified") {
    throw new ValidationError(
      `${vendor.displayName} is not currently verified, so we cannot send them work.`,
      { requestId: ["Check the vendor's standing first."] },
    );
  }

  const product = await Product.findById(request.baseProductId)
    .select({ name: 1, prices: 1 })
    .lean<{ name: string; prices?: Array<{ currency: string }> }>()
    .exec();

  const brief = await VendorBrief.create({
    ...briefFrom(request),
    productName: product?.name ?? "Their product",
    /*
     * The product's own currency, which the vendor chose when they priced it — not the customer's.
     * A vendor quoting bespoke work in a currency they never opted into would need converting at
     * payout, and that is the FX decision the vendor README explicitly leaves out.
     */
    currency: product?.prices?.[0]?.currency ?? DEFAULT_CURRENCY,
    sentByUserId: toObjectId(actor.userId),
    sentAt: new Date(),
    status: "sent" as const,
  });

  /*
   * `technical_review` — an edge that already existed, and already means "somebody who is not the
   * reviewer is looking at it". Tolerating a refusal rather than failing the routing: the brief is
   * the thing that matters, and a request already in `technical_review` from an earlier round would
   * otherwise make sending a second brief impossible.
   */
  if (request.status === "under_review") {
    await requestService.transition({
      requestId: String(request._id),
      to: "technical_review",
      actor: {
        type: "staff",
        userId: actor.userId,
        permissions: new Set(["request.update_status"]),
      },
      internalNote: `Sent to ${vendor.displayName} to price.`,
    });
  }

  // The note is a staff message on the brief thread rather than a field on the brief: it is one side
  // of a conversation, and putting it anywhere else would give it a different lifetime from the
  // reply it invites.
  if (input.note?.trim()) {
    const { postMessage } = await import("@/services/messaging/messaging-service");
    await postMessage({
      organizationId: String(request.organizationId),
      subjectType: "vendor_brief",
      subjectId: String(brief._id),
      senderUserId: actor.userId,
      senderType: "staff",
      body: input.note,
      // Not `customer`: on this subject there is no customer, and `vendor` is the level that says
      // "the other party in this thread reads it".
      visibility: "vendor",
    });
  }

  await writeAuditLog({
    action: "vendor_brief.sent",
    actor,
    subject: { type: "request", id: String(request._id) },
    after: { briefId: String(brief._id), vendorId: String(request.vendorId) },
    source: "staff",
  });

  await emit("CustomizationRoutedToVendor", {
    briefId: String(brief._id),
    vendorId: String(request.vendorId),
    productName: product?.name ?? "your product",
  });

  return brief.toObject();
}

/**
 * The redaction, and the only place a request becomes a brief.
 *
 * What is copied: the title, the requirements, and the timeline if there is one. What is not: the
 * customer's name, their user id, their organisation as anything but the thread's tenant scope, the
 * reference (their handle for it), `internalInterpretation` (staff's own reading), `assumptions`
 * (the model's guesses, which are not a specification), and the attachments — a file a customer
 * uploaded is the most likely place for a letterhead or a signature.
 *
 * `acceptedByCustomer` is dropped per requirement, not because it is sensitive but because it is
 * a negotiating position: a vendor pricing work does not need to know which lines the customer was
 * unsure about.
 */
function briefFrom(request: CustomerRequestDoc) {
  return {
    requestId: request._id,
    organizationId: request.organizationId,
    vendorId: request.vendorId!,
    productId: request.baseProductId!,
    title: request.title,
    requirements: request.customerRequirements.map((requirement): BriefRequirement => ({
      key: requirement.key,
      label: requirement.label,
      ...(requirement.detail ? { detail: requirement.detail } : {}),
      origin: requirement.origin,
    })),
    ...(request.desiredTimeline ? { desiredTimeline: request.desiredTimeline } : {}),
    requirementsVersion: request.requirementsVersion,
  };
}

/**
 * Pull a brief back.
 *
 * Also what a requirements revision does: the brief the vendor holds describes work the customer has
 * since changed, and leaving it open invites a price for the wrong thing. Staff cut a new one.
 */
export async function withdraw(
  briefId: string,
  actor: AuditActor & { userId: string },
): Promise<VendorBriefDoc> {
  await connectToDatabase();

  const updated = await VendorBrief.findOneAndUpdate(
    { _id: toObjectId(briefId), status: { $in: ["sent", "answered"] } },
    { $set: { status: "withdrawn", closedAt: new Date() } },
    { returnDocument: "after" },
  )
    .lean<VendorBriefDoc>()
    .exec();

  if (!updated) {
    throw new ConflictError("That brief is already closed.");
  }

  await writeAuditLog({
    action: "vendor_brief.withdrawn",
    actor,
    subject: { type: "request", id: String(updated.requestId) },
    after: { briefId },
    source: "staff",
  });

  return updated;
}

/**
 * The thread's tenant scope for a **staff** caller.
 *
 * Unscoped, because staff read across organisations (§30) — but still read off the brief rather than
 * the request, so the staff and vendor sides of the relay derive it from one place. Two callers
 * deriving the same id two ways is how they end up posting into two different conversations.
 */
export async function threadScopeForStaff(briefId: string): Promise<string> {
  await connectToDatabase();

  const brief = await VendorBrief.findById(toObjectId(briefId))
    .select({ organizationId: 1 })
    .lean<{ organizationId: unknown }>()
    .exec();

  if (!brief) throw new NotFoundError("brief", { id: briefId });

  return String(brief.organizationId);
}

/** Every brief cut for one request, newest first — the staff-side history. */
export async function listForRequest(requestId: string): Promise<VendorBriefDoc[]> {
  await connectToDatabase();

  return VendorBrief.find({ requestId: toObjectId(requestId) })
    .sort({ sentAt: -1 })
    .lean<VendorBriefDoc[]>()
    .exec();
}

/* ────────────────────────────────────────────── the vendor side */

/**
 * What a vendor may read — and a type with **no field for what they may not**.
 *
 * Layer 3 of §37's boundary, the same one that gives `CustomerMessage` no `visibility`: a type that
 * cannot express the customer's identity cannot serialise it, even if a query were got wrong. There
 * is no `requestId`, no `organizationId`, no customer name and no reference.
 */
export interface VendorBriefView {
  id: string;
  productId: string;
  productName: string;
  title: string;
  currency: string;
  requirements: BriefRequirement[];
  desiredTimeline?: string;
  status: VendorBriefDoc["status"];
  sentAt: string;
  proposal?: {
    amount: number;
    currency: string;
    effort: string;
    caveats?: string;
    validUntil?: string;
    submittedAt: string;
  };
  declinedReason?: string;
}

function toVendorView(brief: VendorBriefDoc): VendorBriefView {
  return {
    id: String(brief._id),
    productId: String(brief.productId),
    productName: brief.productName,
    title: brief.title,
    currency: brief.currency,
    requirements: brief.requirements,
    ...(brief.desiredTimeline ? { desiredTimeline: brief.desiredTimeline } : {}),
    status: brief.status,
    sentAt: brief.sentAt.toISOString(),
    ...(brief.proposal
      ? {
          proposal: {
            amount: brief.proposal.amount,
            currency: brief.proposal.currency,
            effort: brief.proposal.effort,
            ...(brief.proposal.caveats ? { caveats: brief.proposal.caveats } : {}),
            ...(brief.proposal.validUntil
              ? { validUntil: brief.proposal.validUntil.toISOString() }
              : {}),
            submittedAt: brief.proposal.submittedAt.toISOString(),
          },
        }
      : {}),
    ...(brief.declinedReason ? { declinedReason: brief.declinedReason } : {}),
  };
}

/**
 * A vendor's own briefs.
 *
 * `vendorFilter(scope)` is **in the query**, from the session — the same line that makes
 * `listForVendor` in `support-service` safe. Its empty-string guard is what stops a missing scope
 * reading every brief on the platform rather than none.
 */
export async function listForVendor(
  scope: VendorScope,
  options: { openOnly?: boolean; limit?: number } = {},
): Promise<VendorBriefView[]> {
  await connectToDatabase();

  const rows = await VendorBrief.find({
    ...vendorFilter(scope),
    ...(options.openOnly ? { status: { $in: ["sent", "answered"] } } : {}),
  })
    .sort({ sentAt: -1 })
    .limit(Math.min(options.limit ?? 50, 200))
    .lean<VendorBriefDoc[]>()
    .exec();

  return rows.map(toVendorView);
}

/**
 * One brief, scoped — and **404 for somebody else's**, never 403.
 *
 * The same position the platform takes on downloads, AI conversations and vendor products: telling a
 * caller "that exists but is not yours" turns the screen into an oracle for which ids are real.
 */
export async function briefForVendor(
  briefId: string,
  scope: VendorScope,
): Promise<VendorBriefView> {
  await connectToDatabase();

  const brief = await VendorBrief.findOne({
    _id: toObjectId(briefId),
    ...vendorFilter(scope),
  })
    .lean<VendorBriefDoc>()
    .exec();

  if (!brief) throw new NotFoundError("brief", { id: briefId });

  return toVendorView(brief);
}

/**
 * The thread's tenant scope, for a vendor-facing caller that must not touch the request.
 *
 * `vendorThread()` needs an `organizationId` and a vendor's page has no business loading the
 * customer's request to find one. This returns it from the **brief**, still gated on the vendor
 * scope, so the id a page passes to the messaging layer is one it was entitled to. It is not on
 * `VendorBriefView` because it must never be serialised to a client.
 */
export async function threadScopeForVendor(
  briefId: string,
  scope: VendorScope,
): Promise<string> {
  await connectToDatabase();

  const brief = await VendorBrief.findOne({
    _id: toObjectId(briefId),
    ...vendorFilter(scope),
  })
    .select({ organizationId: 1 })
    .lean<{ organizationId: unknown }>()
    .exec();

  if (!brief) throw new NotFoundError("brief", { id: briefId });

  return String(brief.organizationId);
}

export interface ProposalInput {
  briefId: string;
  amount: number;
  currency: string;
  effort: string;
  caveats?: string;
  validUntil?: string;
}

/**
 * The vendor prices it — decision W1.
 *
 * Guarded on `{_id, vendorId, status: "sent"}` in one write, which does three things at once: it
 * scopes to the vendor, it 404s somebody else's brief, and it refuses a withdrawn one without a
 * separate read that could go stale between the two.
 *
 * A vendor may re-price an `answered` brief only by staff sending a new one. That is deliberate: the
 * price staff quoted the customer was taken from a specific proposal, and letting the underlying
 * figure move afterwards would leave the quote citing a number that no longer exists.
 */
export async function submitProposal(
  input: ProposalInput,
  scope: VendorScope,
  actor: AuditActor & { userId: string },
): Promise<VendorBriefView> {
  await connectToDatabase();

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError("Give a price for the work.", {
      amount: ["A whole number, in the smallest unit of the currency."],
    });
  }
  if (!input.effort.trim()) {
    throw new ValidationError("Say roughly how long it would take.", {
      effort: ["Required — “about three days” is enough."],
    });
  }

  const updated = await VendorBrief.findOneAndUpdate(
    { _id: toObjectId(input.briefId), ...vendorFilter(scope), status: "sent" },
    {
      $set: {
        status: "answered",
        proposal: {
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          effort: input.effort.trim(),
          ...(input.caveats?.trim() ? { caveats: input.caveats.trim() } : {}),
          ...(input.validUntil ? { validUntil: new Date(input.validUntil) } : {}),
          submittedByUserId: toObjectId(actor.userId),
          submittedAt: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  )
    .lean<VendorBriefDoc>()
    .exec();

  if (!updated) throw new NotFoundError("brief", { id: input.briefId });

  await writeAuditLog({
    action: "vendor_brief.priced",
    actor,
    subject: { type: "request", id: String(updated.requestId) },
    // The figure is in the brief where staff read it. An audit row records that a price was given
    // and by whom, not a copy of it — the same line the request audit draws around prices.
    after: { briefId: input.briefId, currency: updated.proposal?.currency },
    source: "vendor",
  });

  await emit("VendorBriefAnswered", {
    briefId: input.briefId,
    requestId: String(updated.requestId),
    vendorId: String(updated.vendorId),
    productName: updated.productName,
  });

  return toVendorView(updated);
}

/**
 * The vendor says no, with a reason.
 *
 * The reason is required and staff read it verbatim: "we don't have capacity until March" and "that
 * change would break every other customer's install" call for completely different things to be
 * said to the customer, and staff cannot tell which without being told.
 */
export async function decline(
  input: { briefId: string; reason: string },
  scope: VendorScope,
  actor: AuditActor & { userId: string },
): Promise<VendorBriefView> {
  await connectToDatabase();

  if (!input.reason.trim()) {
    throw new ValidationError("Say why, so we can tell the customer something useful.", {
      reason: ["Required."],
    });
  }

  const updated = await VendorBrief.findOneAndUpdate(
    {
      _id: toObjectId(input.briefId),
      ...vendorFilter(scope),
      status: { $in: ["sent", "answered"] },
    },
    {
      $set: {
        status: "declined",
        declinedReason: input.reason.trim(),
        closedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  )
    .lean<VendorBriefDoc>()
    .exec();

  if (!updated) throw new NotFoundError("brief", { id: input.briefId });

  await writeAuditLog({
    action: "vendor_brief.declined",
    actor,
    subject: { type: "request", id: String(updated.requestId) },
    after: { briefId: input.briefId },
    source: "vendor",
  });

  await emit("VendorBriefDeclined", {
    briefId: input.briefId,
    requestId: String(updated.requestId),
    vendorId: String(updated.vendorId),
    productName: updated.productName,
    reason: input.reason.trim(),
  });

  return toVendorView(updated);
}

/** How many briefs are waiting on a vendor — for the vendor dashboard's "what needs doing". */
export async function countAwaitingVendor(scope: VendorScope): Promise<number> {
  await connectToDatabase();

  return VendorBrief.countDocuments({ ...vendorFilter(scope), status: "sent" });
}

/* ────────────────────────────────────────────── turning a price into a quote */

export interface QuotableBrief {
  briefId: string;
  requestId: string;
  organizationId: string;
  vendorId: string;
  vendorName: string;
  productName: string;
  title: string;
  requirements: BriefRequirement[];
  /** The vendor's own figure, in minor units. */
  amount: number;
  currency: string;
  effort: string;
  caveats?: string;
  /** Resolved now and snapshotted onto the quote — never re-read afterwards. */
  commissionBasisPoints: number;
}

/**
 * Everything staff need to draft the customer's quote from a vendor's price — milestone B.
 *
 * ## Why the commission is resolved *here* and not at payment
 *
 * `resolveCommissionForVendor()` reads the rate that is in force **today**. Reading it when the
 * invoice is paid — weeks later, possibly after a renegotiation — would mean a rate change silently
 * altering what a vendor is owed on work they already priced and agreed. So it is resolved at the
 * moment of quoting and written onto the quote, which is the same rule
 * `OrderLine.commissionBasisPoints` follows at checkout: *resolved once, never re-read*.
 *
 * ## Two numbers, and this returns the vendor's
 *
 * `amount` is what the vendor priced. The customer's total is staff's to set — defaulting to this
 * figure — and any excess is platform margin on top of commission. That is why the quote stores both:
 * deriving the vendor's share from the total would let a staff member raise what we owe by raising
 * the price, which is not what "the vendor prices the work" promised.
 *
 * Refuses a brief that is not `answered`, because there is no price on it to quote.
 */
export async function quotableBrief(briefId: string): Promise<QuotableBrief> {
  await connectToDatabase();

  const brief = await VendorBrief.findById(toObjectId(briefId)).lean<VendorBriefDoc>().exec();
  if (!brief) throw new NotFoundError("brief", { id: briefId });

  if (brief.status !== "answered" || !brief.proposal) {
    throw new ValidationError(
      brief.status === "declined"
        ? "The vendor declined this one, so there is no price to quote."
        : "The vendor has not priced this yet.",
      { briefId: ["Wait for their figure, or send a fresh brief."] },
    );
  }

  const vendor = await Vendor.findById(brief.vendorId)
    .select({ displayName: 1 })
    .lean<{ displayName: string }>()
    .exec();

  const { resolveCommissionForVendor } = await import("./commission-service");
  const commission = await resolveCommissionForVendor(String(brief.vendorId));

  return {
    briefId: String(brief._id),
    requestId: String(brief.requestId),
    organizationId: String(brief.organizationId),
    vendorId: String(brief.vendorId),
    vendorName: vendor?.displayName ?? "The vendor",
    productName: brief.productName,
    title: brief.title,
    requirements: brief.requirements,
    amount: brief.proposal.amount,
    currency: brief.proposal.currency,
    effort: brief.proposal.effort,
    ...(brief.proposal.caveats ? { caveats: brief.proposal.caveats } : {}),
    commissionBasisPoints: commission.basisPoints,
  };
}

/**
 * The newest priced brief for a request, if there is one — what the quote builder prefills from.
 *
 * Newest rather than only: a withdrawn-and-resent round leaves several, and the last price given is
 * the live one. Returns `null` rather than throwing when there is nothing to quote from, because the
 * quote screen is reachable for every request and a vendor price is the exception.
 */
export async function latestPricedBrief(requestId: string): Promise<QuotableBrief | null> {
  await connectToDatabase();

  const brief = await VendorBrief.findOne({
    requestId: toObjectId(requestId),
    status: "answered",
  })
    .sort({ sentAt: -1 })
    .select({ _id: 1 })
    .lean<{ _id: unknown }>()
    .exec();

  if (!brief) return null;

  // Through `quotableBrief` rather than mapping here, so the commission is resolved and snapshotted
  // by the one function that knows to do it.
  return quotableBrief(String(brief._id));
}
