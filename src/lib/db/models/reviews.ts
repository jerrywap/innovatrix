import { Schema, type Types } from "mongoose";
import { ORG_SCOPE_FIELD, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  REVIEW_REPORT_REASONS,
  REVIEW_STATUSES,
  type ReviewReportReason,
  type ReviewStatus,
} from "../enums";

/**
 * Ratings and reviews — vendor ticket 10.
 *
 * §6 lists these as "if introduced" and `01-mvp-todo.md` deferred them; this **un-defers a
 * listed item**, which is worth saying because the deferral was a decision. It also matters
 * more with vendors than without: when the platform is the only seller a rating is feedback,
 * and when a customer is choosing between third-party products it is the primary signal.
 *
 * ## The purchase gate is an index, not a check
 *
 * `entitlementId` is **unique**. One review per purchase, enforced by the database rather
 * than by a read-then-write that two tabs can both pass. And because an entitlement is only
 * issued by fulfilment, "did they buy it" needs no separate question — which removes review
 * spam, competitor attacks and paid-review farms as a *class* of problem rather than as
 * something moderation has to catch.
 */

export interface ReviewDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  /** Denormalised for the vendor-level aggregate — vendor ticket 12 reads it per vendor. */
  vendorId?: Types.ObjectId;
  organizationId: Types.ObjectId;
  authorUserId: Types.ObjectId;
  /** The purchase. Unique, and the whole gate. */
  entitlementId: Types.ObjectId;
  /** 1–5, integer. A half-star average is derived; a half-star *rating* is not offered. */
  rating: number;
  title?: string;
  body: string;
  /**
   * Which version they actually used.
   *
   * A two-star review of a version fixed a year ago is information about the past, and the
   * product page can say so rather than leaving the reader to assume it is current.
   */
  versionAtReview?: string;
  status: ReviewStatus;
  /** Why staff hid it. The author is told; the public is not. */
  moderationReason?: string;
  /**
   * The vendor's public answer — one per review, edit-visible.
   *
   * §37 in one direction: nothing internal — no staff note, no dispute detail — may ever
   * reach this field. It is enforced by the field simply not being reachable from any
   * internal write path, which is stronger than remembering to filter.
   */
  vendorResponse?: { body: string; at: Date; byUserId: Types.ObjectId; editedAt?: Date };
  reportCount: number;
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ReviewDoc>(
  {
    /*
     * Declared inline rather than through `orgScoped()`.
     *
     * The helper's return type is `T & SchemaDefinition`, which widens every literal union
     * in the definition to `string` and makes `new Schema<ReviewDoc>` reject the whole
     * object. `Product` and `Cart` already spell the field out for the same reason; the
     * shape is identical to what the helper produces.
     */
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    entitlementId: { type: Schema.Types.ObjectId, ref: "Entitlement", required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: (value: unknown) => Number.isInteger(value),
    },
    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    versionAtReview: { type: String, trim: true },
    status: { type: String, enum: REVIEW_STATUSES, required: true, default: "published" },
    moderationReason: { type: String, trim: true },
    vendorResponse: {
      type: new Schema(
        {
          body: { type: String, required: true, trim: true, maxlength: 2000 },
          at: { type: Date, required: true },
          byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          editedAt: Date,
        },
        { _id: false },
      ),
    },
    reportCount: { type: Number, default: 0, min: 0 },
    editedAt: Date,
  },
  schemaOptions({ collection: "reviews" }),
);

/**
 * The purchase gate.
 *
 * Unconditional and unique. A partial filter on `status` would let a removed review be
 * replaced by a fresh one from the same purchase, which is exactly how a removed review
 * comes back.
 */
reviewSchema.index({ entitlementId: 1 }, { unique: true });

/** The product page's own query: published reviews, newest first. */
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
/** The vendor's list, and the aggregate behind their rating. */
reviewSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
/** The moderation queue — most-reported first. */
reviewSchema.index({ status: 1, reportCount: -1 });
/** "Have I reviewed this?" on My Purchases, and the author's own edits. */
reviewSchema.index({ authorUserId: 1, productId: 1 });

export const Review = defineModel<ReviewDoc>("Review", reviewSchema);

/* ────────────────────────────────────────────── ReviewReport */

/**
 * One person's report of one review.
 *
 * A row rather than a counter increment, because the counter alone cannot answer "who
 * reported this, and did the same account report forty reviews in an hour" — which is the
 * question that separates a brigading campaign from a genuinely bad review.
 *
 * Unique on `(reviewId, reportedByUserId)`: reporting twice is not twice as serious, and a
 * refreshed page must not inflate the count.
 */
export interface ReviewReportDoc {
  _id: Types.ObjectId;
  reviewId: Types.ObjectId;
  reportedByUserId: Types.ObjectId;
  /** A vendor may report; they may never hide. Recorded so the queue can say who asked. */
  reportedByVendorId?: Types.ObjectId;
  reason: ReviewReportReason;
  detail?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewReportSchema = new Schema<ReviewReportDoc>(
  {
    reviewId: { type: Schema.Types.ObjectId, ref: "Review", required: true },
    reportedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reportedByVendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    reason: { type: String, enum: REVIEW_REPORT_REASONS, required: true },
    detail: { type: String, trim: true, maxlength: 1000 },
  },
  schemaOptions({ collection: "reviewReports" }),
);

reviewReportSchema.index({ reviewId: 1, reportedByUserId: 1 }, { unique: true });
reviewReportSchema.index({ reviewId: 1, createdAt: -1 });
reviewReportSchema.index({ reportedByUserId: 1, createdAt: -1 });

export const ReviewReport = defineModel<ReviewReportDoc>("ReviewReport", reviewReportSchema);

/** Named so the threshold is one number in one place rather than a literal in a branch. */
export const REPORT_THRESHOLD = 3;
