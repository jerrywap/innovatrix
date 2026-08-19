import { Schema, type Types } from "mongoose";
import { schemaOptions } from "../base";
import { defineModel } from "../client";
import { TAKEDOWN_STATUSES, type TakedownStatus } from "../enums";

/**
 * A copyright or licence claim against a product — vendor ticket 13.
 *
 * ## Why this is a record rather than an email thread
 *
 * A takedown is the thing most likely to be litigated. The claim, who made it, what exactly was
 * alleged, when the product came down, when the vendor was told, what they said, and what was
 * decided — all of it gets read later, by somebody who was not there. An email thread cannot be
 * relied on to still exist in that form, and a decision made under time pressure with no defined
 * path is the decision that looks worst in retrospect.
 *
 * ## What it is *not*
 *
 * Not automated processing (out of scope), and not a substitute for the audit log: every step
 * writes an audit row as well, because this document is mutable by design — its status moves —
 * and §90's append-only record is what proves the sequence.
 */

export interface TakedownClaimDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  vendorId?: Types.ObjectId;
  status: TakedownStatus;
  /**
   * Who is claiming.
   *
   * Free text with an email, deliberately: a rights holder is usually not a user of the
   * platform, and requiring an account before they can report infringement would make the
   * process useless.
   */
  claimant: { name: string; email: string; organisation?: string };
  /** What specifically is alleged. The whole value of the record is in the specificity. */
  allegation: string;
  /** Where the claimed original lives, if they gave one. */
  referenceUrl?: string;
  /** Set when the product came down, so "how fast did we act" is answerable. */
  delistedAt?: Date;
  /** When the vendor was told, and what they said. */
  vendorNotifiedAt?: Date;
  vendorResponse?: { body: string; at: Date; byUserId: Types.ObjectId };
  /** The window they were given — a claim with no deadline is one that sits. */
  vendorResponseDueAt?: Date;
  resolution?: {
    outcome: "reinstated" | "removed" | "vendor_offboarded" | "claim_rejected";
    reason: string;
    at: Date;
    byUserId: Types.ObjectId;
  };
  receivedByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const takedownSchema = new Schema<TakedownClaimDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    status: { type: String, enum: TAKEDOWN_STATUSES, required: true, default: "received" },
    claimant: {
      type: new Schema(
        {
          name: { type: String, required: true, trim: true, maxlength: 200 },
          email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
          organisation: { type: String, trim: true, maxlength: 200 },
        },
        { _id: false },
      ),
      required: true,
    },
    allegation: { type: String, required: true, trim: true, maxlength: 8000 },
    referenceUrl: { type: String, trim: true, maxlength: 2048 },
    delistedAt: Date,
    vendorNotifiedAt: Date,
    vendorResponse: {
      type: new Schema(
        {
          body: { type: String, required: true, trim: true, maxlength: 8000 },
          at: { type: Date, required: true },
          byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        },
        { _id: false },
      ),
    },
    vendorResponseDueAt: Date,
    resolution: {
      type: new Schema(
        {
          outcome: {
            type: String,
            enum: ["reinstated", "removed", "vendor_offboarded", "claim_rejected"],
            required: true,
          },
          reason: { type: String, required: true, trim: true, maxlength: 4000 },
          at: { type: Date, required: true },
          byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        },
        { _id: false },
      ),
    },
    receivedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "takedownClaims" }),
);

/** The queue: unresolved first, oldest first. */
takedownSchema.index({ status: 1, createdAt: 1 });
takedownSchema.index({ productId: 1, createdAt: -1 });
takedownSchema.index({ vendorId: 1, createdAt: -1 });

export const TakedownClaim = defineModel<TakedownClaimDoc>("TakedownClaim", takedownSchema);
