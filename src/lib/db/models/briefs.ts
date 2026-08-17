import { Schema, type Types } from "mongoose";
import { schemaOptions } from "@/lib/db/base";
import { defineModel } from "@/lib/db/client";
import {
  REQUIREMENT_ORIGINS,
  VENDOR_BRIEF_STATUSES,
  type RequirementOrigin,
  type VendorBriefStatus,
} from "@/lib/db/enums";

/**
 * What a vendor was asked to price — vendor ticket 14.
 *
 * ## Its own collection, and its own copy of the requirements
 *
 * The obvious shape is a subdocument on `CustomerRequest` reading through to
 * `customerRequirements`. Both halves of that are wrong here.
 *
 * **It holds a copy.** A brief is *what the vendor was shown*, and a join would silently
 * re-render if the customer later revised their requirements — which is precisely the moment the
 * distinction matters. Vendor ticket 05 stores the attestation *text* and its version rather than
 * a boolean for the same reason: in a dispute, "this is what we asked them to price" has to be a
 * fixed record. So a revision produces a **new brief**, and staff decide whether to send it; the
 * superseded one goes `withdrawn` and stays readable.
 *
 * **It is a separate collection** because it is a separate conversation subject. `Conversation` is
 * unique on `{subjectType, subjectId}`, and mediation requires the staff↔vendor thread to be a
 * different subject from the customer↔staff one — see `vendor_brief` in `enums.ts` for why one
 * shared thread cannot work. A subdocument has no id to key a conversation by.
 *
 * ## What it holds about the customer, and why
 *
 * No name, no user id, and **nothing a vendor-facing type exposes**. Two fields do point back at
 * the customer's side and both are load-bearing:
 *
 * - `requestId`, so staff can get from a priced brief to the request it answers.
 * - `organizationId`, which is the **tenant scope the thread requires**. `Conversation` and
 *   `Message` both have it `required`, and it is what stops one org's messages being readable from
 *   another's scope. The brief-thread parties are staff and a vendor, so it is scoping data rather
 *   than a participant — but the alternative was making the vendor's own page load the customer's
 *   request to find it, which is worse: it would put the request document in the one code path that
 *   must not touch it.
 *
 * So the boundary is enforced where this codebase already enforces it — at the **type**.
 * `VendorBriefView` has no field for either, exactly as `CustomerMessage` has no `visibility` and a
 * customer's `loadRequest` result has no `internalInterpretation` key at all. The integration test
 * asserts against the serialised vendor payload rather than against the document, because that is
 * the thing that reaches a screen.
 */

/**
 * The same shape as a request's `Requirement`, minus `acceptedByCustomer`.
 *
 * Deliberately not the imported `requirementSchema`: that field is about what the *customer*
 * confirmed, and it is meaningless to a vendor who is being told "price this". Carrying it would
 * invite a vendor-facing screen to render "the customer wasn't sure about this one", which is a
 * negotiating position rather than a specification.
 *
 * `origin` survives, because "we assumed this" is exactly what a vendor pricing the work needs to
 * push back on.
 */
export interface BriefRequirement {
  key: string;
  label: string;
  detail?: string;
  origin: RequirementOrigin;
}

const briefRequirementSchema = new Schema<BriefRequirement>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    detail: String,
    origin: { type: String, enum: REQUIREMENT_ORIGINS, required: true },
  },
  { _id: false },
);

/**
 * The vendor's answer — a price, an effort and the caveats that come with both.
 *
 * `amount` in **minor units** with its currency, like every other money field here; never a float
 * and never through `toFixed`. `validUntil` because a price for bespoke work goes stale and a
 * vendor should not be held to a figure from four months ago.
 *
 * The customer never sees this object. Staff issue the customer's quote *from* it and may add their
 * own margin, so there are two numbers by design — see vendor ticket 14's "what the vendor sees".
 */
export interface VendorProposal {
  amount: number;
  currency: string;
  /** Free text: "about three days", "two weeks, after the API access lands". Not a date. */
  effort: string;
  caveats?: string;
  validUntil?: Date;
  submittedByUserId: Types.ObjectId;
  submittedAt: Date;
}

const vendorProposalSchema = new Schema<VendorProposal>(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    effort: { type: String, required: true, trim: true, maxlength: 400 },
    caveats: { type: String, trim: true, maxlength: 4000 },
    validUntil: Date,
    submittedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, required: true },
  },
  { _id: false },
);

export interface VendorBriefDoc {
  _id: Types.ObjectId;
  /** Staff-only. Never in a vendor-facing type — see the note above. */
  requestId: Types.ObjectId;
  /** The customer's organisation. Tenant scope for the brief thread; never vendor-facing. */
  organizationId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  /** Denormalised so a vendor's list names the product without a join per row. */
  productName: string;
  /** The request's title as the customer wrote it — a summary of the work, not of the customer. */
  title: string;
  /**
   * What the vendor prices in, fixed when the brief was sent.
   *
   * Taken from the **product's own price**, which the vendor set themselves — not from the customer's
   * currency. `money.ts` refuses cross-currency arithmetic and vendor earnings accrue in the currency
   * they were earned in, so pricing bespoke work in a currency the vendor never chose would need an
   * FX decision nobody has taken (see the README's multi-currency payouts exclusion).
   */
  currency: string;
  requirements: BriefRequirement[];
  /** Copied only when the customer gave one; it is about the work, not about them. */
  desiredTimeline?: string;
  /** Which revision of the requirements this brief was cut from. */
  requirementsVersion: number;
  status: VendorBriefStatus;
  proposal?: VendorProposal;
  sentByUserId: Types.ObjectId;
  sentAt: Date;
  declinedReason?: string;
  closedAt?: Date;
}

const vendorBriefSchema = new Schema<VendorBriefDoc>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "CustomerRequest", required: true },
    /*
     * Not `ORG_SCOPE_FIELD`/`orgScoped()`, deliberately.
     *
     * That helper marks a collection as belonging to a customer organisation, and `orgFilter()` is
     * how a customer reads their own rows. Nothing customer-facing ever reads a brief: this is the
     * scope the *thread* needs, and the reader is always either staff or the vendor. Declaring it
     * plainly says so, and keeps `vendorFilter` the only scope that gates this collection.
     */
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    title: { type: String, required: true },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    requirements: { type: [briefRequirementSchema], default: [] },
    desiredTimeline: String,
    requirementsVersion: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      enum: VENDOR_BRIEF_STATUSES,
      required: true,
      default: "sent",
      index: true,
    },
    proposal: { type: vendorProposalSchema },
    sentByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentAt: { type: Date, required: true },
    declinedReason: { type: String, trim: true, maxlength: 2000 },
    closedAt: Date,
  },
  schemaOptions({ collection: "vendorBriefs" }),
);

/** The vendor's own list — newest first, and the only query a vendor screen makes. */
vendorBriefSchema.index({ vendorId: 1, status: 1, sentAt: -1 });

/**
 * Every brief for one request, in order.
 *
 * Not unique: a requirements revision cuts a second brief, so a request can have several and the
 * history is the point. Staff read them newest-first to see what has been asked and answered.
 */
vendorBriefSchema.index({ requestId: 1, sentAt: -1 });

export const VendorBrief = defineModel<VendorBriefDoc>("VendorBrief", vendorBriefSchema);
