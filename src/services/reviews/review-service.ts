import "server-only";
import type { ClientSession, Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { Product } from "@/lib/db/models/catalog";
import { Download, Entitlement, type EntitlementDoc } from "@/lib/db/models/commerce";
import { Review, ReviewReport, REPORT_THRESHOLD } from "@/lib/db/models/reviews";
import type { ReviewDoc, ReviewReportDoc } from "@/lib/db/models/reviews";
import { Vendor } from "@/lib/db/models/vendors";
import type { ReviewReportReason, ReviewStatus } from "@/lib/db/enums";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { orgFilter, type OrgScope } from "@/lib/auth/scope";
import { emit } from "@/lib/events";
import { writeAuditLog, statusChange, type AuditActor } from "@/services/audit";

/**
 * Reviews — vendor ticket 10.
 *
 * Three rules do most of the work, and each is enforced where it cannot be bypassed:
 *
 * 1. **Only somebody who bought it.** An active entitlement, scoped to the caller's
 *    organisation, checked here rather than by a hidden form.
 * 2. **One review per entitlement**, by unique index rather than read-then-write.
 * 3. **Aggregates are recomputed from the reviews**, in the same transaction as the write,
 *    so the cache can never disagree with its source (§103).
 *
 * Who may do what is the other half, and the asymmetry is deliberate: an **author** edits
 * their own words and nobody else's, **staff** hide or remove but never edit, and a
 * **vendor** responds and reports but can do nothing else to a review of their own product.
 * A seller who can suppress criticism makes every remaining review worthless.
 */

/* ────────────────────────────────────────────── writing */

export interface SubmitReviewInput {
  entitlementId: string;
  rating: number;
  title?: string;
  body: string;
}

/**
 * Leave a review.
 *
 * The entitlement is the gate *and* the subject: it names the product, the organisation and
 * the version they bought, so nothing about what is being reviewed comes from the request.
 * A client-supplied `productId` would be a claim; this way there is no field to lie in.
 *
 * `active` only. A suspended entitlement is a refunded or disputed purchase, and a review
 * from one is the shape of a "refund me or I review you" campaign.
 */
export async function submit(
  input: SubmitReviewInput,
  scope: OrgScope,
  actor: AuditActor & { userId: string },
): Promise<ReviewDoc> {
  await connectToDatabase();

  const entitlement = await Entitlement.findOne({
    _id: toObjectId(input.entitlementId),
    ...orgFilter(scope),
  }).lean<EntitlementDoc>();

  // 404 rather than 403: somebody probing entitlement ids must not learn which exist.
  if (!entitlement) throw new NotFoundError("entitlement", { id: input.entitlementId });

  if (entitlement.status !== "active") {
    throw new ValidationError("You can only review software you currently own.", {
      entitlementId: ["This purchase is not active."],
    });
  }

  const product = await Product.findById(entitlement.productId)
    .select({ vendorId: 1, name: 1, currentVersionId: 1 })
    .lean<{ _id: Types.ObjectId; vendorId?: Types.ObjectId; name: string }>();
  if (!product) throw new NotFoundError("product", { id: String(entitlement.productId) });

  const version = await versionLabel(entitlement);

  const write = async (session?: ClientSession) => {
    const [created] = await Review.create(
      [
        {
          productId: entitlement.productId,
          ...(product.vendorId ? { vendorId: product.vendorId } : {}),
          organizationId: entitlement.organizationId,
          authorUserId: toObjectId(actor.userId),
          entitlementId: entitlement._id,
          rating: input.rating,
          ...(input.title ? { title: input.title } : {}),
          body: input.body,
          ...(version ? { versionAtReview: version } : {}),
          status: "published" as const,
        },
      ],
      session ? { session, ordered: true } : { ordered: true },
    );

    if (!created) throw new Error("Review.create returned nothing.");

    // In the same transaction, deliberately: a review that committed without its aggregate
    // is a product whose rating is wrong until somebody notices, and nothing would notice.
    await recomputeProductRating(String(entitlement.productId), session);
    if (product.vendorId) await recomputeVendorRating(String(product.vendorId), session);

    return created.toObject() as ReviewDoc;
  };

  let review: ReviewDoc;
  try {
    review = supportsTransactions() ? await withTransaction(write) : await write();
  } catch (error) {
    // The unique index on `entitlementId` — the gate doing its job against two tabs.
    if (isDuplicateKey(error)) {
      throw new ConflictError(
        "You have already reviewed this. Edit your review rather than writing a second one.",
      );
    }
    throw error;
  }

  if (product.vendorId) {
    await emit("ProductReviewPublished", {
      productId: String(entitlement.productId),
      productName: product.name,
      vendorId: String(product.vendorId),
      reviewId: String(review._id),
      rating: review.rating,
    });
  }

  return review;
}

/**
 * The author edits their own review.
 *
 * `authorUserId` is in the filter, not checked after the read: a guard that reads then
 * decides is a guard with a window in it. Staff cannot reach this path at all — they hide
 * or remove, which is a different thing and says so on the screen.
 *
 * `editedAt` is set every time, because the ticket's requirement is that an edited review is
 * **visibly** edited. A review quietly rewritten after a vendor responds to it would make
 * the response look unhinged.
 */
export async function edit(
  reviewId: string,
  input: { rating: number; title?: string; body: string },
  actor: AuditActor & { userId: string },
): Promise<ReviewDoc> {
  await connectToDatabase();

  const before = await Review.findOne({
    _id: toObjectId(reviewId),
    authorUserId: toObjectId(actor.userId),
  }).lean<ReviewDoc>();
  if (!before) throw new NotFoundError("review", { id: reviewId });

  if (before.status === "removed") {
    throw new ValidationError("This review was removed and cannot be edited.", {
      body: ["Contact support if you think that was a mistake."],
    });
  }

  const write = async (session?: ClientSession) => {
    const updated = await Review.findOneAndUpdate(
      { _id: toObjectId(reviewId), authorUserId: toObjectId(actor.userId) },
      {
        $set: {
          rating: input.rating,
          body: input.body,
          editedAt: new Date(),
          ...(input.title ? { title: input.title } : {}),
        },
        ...(input.title ? {} : { $unset: { title: "" } }),
      },
      { returnDocument: "after", runValidators: true, ...(session ? { session } : {}) },
    ).lean<ReviewDoc>();

    if (!updated) throw new NotFoundError("review", { id: reviewId });

    // The rating may have changed, so the aggregate must move with it.
    await recomputeProductRating(String(before.productId), session);
    if (before.vendorId) await recomputeVendorRating(String(before.vendorId), session);

    return updated;
  };

  return supportsTransactions() ? await withTransaction(write) : await write();
}

/* ────────────────────────────────────────────── the vendor's reply */

/**
 * One public response per review, edit-visible.
 *
 * The vendor's answer to a bad review is often more useful to the next buyer than the
 * review, and a vendor with no reply is left arguing in support email nobody else reads.
 *
 * `vendorId` is in the filter, from the session. A vendor cannot respond to a review of
 * somebody else's product, and the refusal is a 404 — consistent with everything else in the
 * vendor workspace, where the existence of another vendor's records is not ours to confirm.
 */
export async function respond(
  reviewId: string,
  body: string,
  vendorId: string,
  actor: AuditActor & { userId: string },
): Promise<ReviewDoc> {
  await connectToDatabase();

  if (!body.trim()) {
    throw new ValidationError("Say something, or leave it without a reply.", {
      body: ["A response cannot be empty."],
    });
  }

  const existing = await Review.findOne({
    _id: toObjectId(reviewId),
    vendorId: toObjectId(vendorId),
  }).lean<ReviewDoc>();
  if (!existing) throw new NotFoundError("review", { id: reviewId });

  if (existing.status === "removed") {
    throw new ValidationError("This review was removed. There is nothing to reply to.");
  }

  const now = new Date();
  const updated = await Review.findOneAndUpdate(
    { _id: toObjectId(reviewId), vendorId: toObjectId(vendorId) },
    {
      $set: {
        "vendorResponse.body": body.trim(),
        "vendorResponse.byUserId": toObjectId(actor.userId),
        // The original timestamp survives an edit; `editedAt` records that it changed. A
        // response whose date silently moved would read as a reply to something later.
        ...(existing.vendorResponse
          ? { "vendorResponse.editedAt": now }
          : { "vendorResponse.at": now }),
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean<ReviewDoc>();

  if (!updated) throw new NotFoundError("review", { id: reviewId });

  await writeAuditLog({
    action: existing.vendorResponse ? "review.response_edited" : "review.responded",
    actor,
    subject: { type: "review", id: reviewId },
    // Field names, not the text. The response is public anyway, but an audit row is
    // append-only and a 2,000-character reply in it twice over is not a record anybody wants.
    after: { fields: ["vendorResponse"] },
    source: "vendor",
  });

  return updated;
}

/* ────────────────────────────────────────────── reporting and moderation */

/**
 * Report a review.
 *
 * Anybody signed in may report, including the vendor being reviewed — reporting is asking
 * somebody else to look, which is exactly what a vendor should be able to do about a review
 * they believe breaks the rules. What they cannot do is act on it.
 *
 * The count is `reviewReports.countDocuments`, not an `$inc`: the rows are the truth, the
 * unique index makes a second report from the same person a no-op, and a counter that can
 * drift from the rows behind it is the bug this shape avoids.
 */
export async function report(
  reviewId: string,
  input: { reason: ReviewReportReason; detail?: string; vendorId?: string },
  actor: AuditActor & { userId: string },
): Promise<{ reportCount: number; queued: boolean }> {
  await connectToDatabase();

  const review = await Review.findById(toObjectId(reviewId)).lean<ReviewDoc>();
  if (!review) throw new NotFoundError("review", { id: reviewId });

  if (input.reason === "other" && !input.detail?.trim()) {
    throw new ValidationError("Say what is wrong with it.", {
      detail: ["Required when the reason is 'other'."],
    });
  }

  try {
    await ReviewReport.create({
      reviewId: review._id,
      reportedByUserId: toObjectId(actor.userId),
      ...(input.vendorId ? { reportedByVendorId: toObjectId(input.vendorId) } : {}),
      reason: input.reason,
      ...(input.detail ? { detail: input.detail.trim() } : {}),
    });
  } catch (error) {
    // Already reported by this person. Not an error worth showing: the desired state exists.
    if (!isDuplicateKey(error)) throw error;
  }

  const reportCount = await ReviewReport.countDocuments({ reviewId: review._id });
  await Review.updateOne({ _id: review._id }, { $set: { reportCount } });

  const queued = reportCount >= REPORT_THRESHOLD;

  // Emitted on crossing the threshold, not on every report: staff need to be told once, and
  // a notification per report on a brigaded review is how a queue becomes noise.
  if (queued && reportCount === REPORT_THRESHOLD) {
    await emit("ProductReviewFlagged", {
      reviewId: String(review._id),
      productId: String(review.productId),
      reportCount,
    });
  }

  return { reportCount, queued };
}

/**
 * Staff hide, unhide or remove. They never edit.
 *
 * The distinction is the whole moderation model: **hidden** is reversible and the author is
 * told why, **removed** is a policy breach, and neither touches a word the author wrote.
 * Staff editing somebody's review would produce a public opinion attributed to a person who
 * did not express it.
 *
 * Hiding removes it from the aggregate **immediately**, in the same transaction — a hidden
 * review still counted in the average would be moderation that changes nothing a reader sees.
 */
export async function moderate(
  reviewId: string,
  to: ReviewStatus,
  reason: string,
  actor: AuditActor,
): Promise<ReviewDoc> {
  await connectToDatabase();

  const before = await Review.findById(toObjectId(reviewId)).lean<ReviewDoc>();
  if (!before) throw new NotFoundError("review", { id: reviewId });

  if (to !== "published" && !reason.trim()) {
    throw new ValidationError("Say why. The author is told, in these words.", {
      reason: ["Required when hiding or removing a review."],
    });
  }

  const write = async (session?: ClientSession) => {
    const updated = await Review.findOneAndUpdate(
      { _id: toObjectId(reviewId), status: before.status },
      {
        $set: {
          status: to,
          ...(to === "published" ? {} : { moderationReason: reason.trim() }),
        },
        ...(to === "published" ? { $unset: { moderationReason: "" } } : {}),
      },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<ReviewDoc>();

    if (!updated) {
      throw new ConflictError("Somebody else moderated this review while you were deciding.");
    }

    await recomputeProductRating(String(before.productId), session);
    if (before.vendorId) await recomputeVendorRating(String(before.vendorId), session);

    await writeAuditLog(
      {
        action: "review.moderated",
        actor,
        subject: { type: "review", id: reviewId },
        ...statusChange(before.status, to, { reason: reason.trim() || undefined }),
      },
      session,
    );

    return updated;
  };

  return supportsTransactions() ? await withTransaction(write) : await write();
}

/* ────────────────────────────────────────────── the aggregates */

/**
 * Recompute a product's rating **from its reviews**.
 *
 * An aggregation rather than an increment. An `$inc` is cheaper and cannot express the cases
 * that actually happen — a rating edited from 5 to 2, a review hidden, a review restored —
 * and each of those would leave the cache a little further from the truth with nothing to
 * detect it. Recomputing is one indexed aggregation on `{productId, status}`.
 *
 * A product with no published reviews has the fields **unset**, not zeroed: absent is what
 * the card and the JSON-LD read as "no rating", and a stored `0` would render as a zero-star
 * product and emit a fabricated `AggregateRating`.
 */
export async function recomputeProductRating(
  productId: string,
  session?: ClientSession,
): Promise<{ count: number; sum: number }> {
  const rows = await Review.aggregate<{ _id: number; count: number }>(
    [
      { $match: { productId: toObjectId(productId), status: "published" } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ],
    session ? { session } : {},
  );

  const distribution = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;

  for (const row of rows) {
    const index = row._id - 1;
    if (index < 0 || index > 4) continue;
    distribution[index] = row.count;
    count += row.count;
    sum += row._id * row.count;
  }

  await Product.updateOne(
    { _id: toObjectId(productId) },
    count === 0
      ? { $unset: { ratingSum: "", ratingCount: "", ratingDistribution: "" } }
      : { $set: { ratingSum: sum, ratingCount: count, ratingDistribution: distribution } },
    session ? { session } : {},
  );

  return { count, sum };
}

/**
 * Recompute a vendor's rating across every product they sell.
 *
 * The mean of the **reviews**, not the mean of the products' means: a product with two
 * hundred reviews counts two hundred times, which is what "weighted" means and what a buyer
 * assumes a vendor rating is. Averaging the averages would let one five-star review of an
 * unpopular product cancel out a hundred two-star reviews of a popular one.
 */
export async function recomputeVendorRating(
  vendorId: string,
  session?: ClientSession,
): Promise<{ count: number; sum: number }> {
  const [row] = await Review.aggregate<{ count: number; sum: number }>(
    [
      { $match: { vendorId: toObjectId(vendorId), status: "published" } },
      { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: "$rating" } } },
    ],
    session ? { session } : {},
  );

  const count = row?.count ?? 0;
  const sum = row?.sum ?? 0;

  await Vendor.updateOne(
    { _id: toObjectId(vendorId) },
    count === 0
      ? { $unset: { ratingSum: "", ratingCount: "" } }
      : { $set: { ratingSum: sum, ratingCount: count } },
    session ? { session } : {},
  );

  return { count, sum };
}

/**
 * A whole-number-and-a-bit average, to one decimal place.
 *
 * Derived here and nowhere else. `Math.round(x * 10) / 10` on a rational of two integers is
 * exact enough for a star row and for `AggregateRating`, and it means no float is ever stored.
 */
export function averageRating(sum?: number, count?: number): number | null {
  if (!sum || !count) return null;
  return Math.round((sum / count) * 10) / 10;
}

/* ────────────────────────────────────────────── reading */

export interface ReviewView {
  id: string;
  rating: number;
  title?: string;
  body: string;
  versionAtReview?: string;
  authorName: string;
  createdAt: Date;
  editedAt?: Date;
  vendorResponse?: { body: string; at: Date; editedAt?: Date };
  /** Only for the author's own view of it. */
  isMine?: boolean;
}

/**
 * Published reviews for a product page.
 *
 * `status: "published"` is in the query, so a hidden review cannot reach a public page even
 * if a caller forgets to filter — the same reasoning as §37's internal notes: the loader is
 * the guarantee, not the component.
 *
 * The author's **name**, never their email. A review is public and a first name plus surname
 * initial is the most a buyer needs; an email address on a public page is a spam list.
 */
export async function listForProduct(
  productId: string,
  options: { limit?: number; viewerUserId?: string } = {},
): Promise<ReviewView[]> {
  await connectToDatabase();

  const rows = await Review.find({ productId: toObjectId(productId), status: "published" })
    .sort({ createdAt: -1 })
    .limit(Math.min(options.limit ?? 20, 100))
    .populate<{ authorUserId: { name?: string } }>("authorUserId", "name")
    .lean();

  return rows.map((row) =>
    toView(
      row as unknown as ReviewDoc & { authorUserId: { name?: string } },
      options.viewerUserId,
    ),
  );
}

/** Every review of a vendor's products, for their own workspace — including hidden ones. */
export async function listForVendor(
  vendorId: string,
  options: { limit?: number; unanswered?: boolean } = {},
): Promise<
  Array<ReviewView & { status: ReviewStatus; productId: string; reportCount: number }>
> {
  await connectToDatabase();

  const rows = await Review.find({
    vendorId: toObjectId(vendorId),
    // `removed` is excluded: a removed review is a policy breach, and showing a vendor the
    // text of something we removed invites them to argue about it rather than move on.
    status: { $in: ["published", "hidden"] },
    ...(options.unanswered ? { vendorResponse: { $exists: false } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(options.limit ?? 50, 200))
    .populate<{ authorUserId: { name?: string } }>("authorUserId", "name")
    .lean();

  return rows.map((row) => {
    const doc = row as unknown as ReviewDoc & { authorUserId: { name?: string } };
    return {
      ...toView(doc),
      status: doc.status,
      productId: String(doc.productId),
      reportCount: doc.reportCount,
    };
  });
}

/** The moderation queue: most-reported first, then newest. */
export async function listReported(limit = 50) {
  await connectToDatabase();

  const rows = await Review.find({ reportCount: { $gt: 0 }, status: { $ne: "removed" } })
    .sort({ reportCount: -1, createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean<ReviewDoc[]>();

  return rows;
}

export async function reportsFor(reviewId: string): Promise<ReviewReportDoc[]> {
  await connectToDatabase();
  return ReviewReport.find({ reviewId: toObjectId(reviewId) })
    .sort({ createdAt: -1 })
    .lean<ReviewReportDoc[]>();
}

export async function findMine(
  entitlementId: string,
  userId: string,
): Promise<ReviewDoc | null> {
  await connectToDatabase();
  return Review.findOne({
    entitlementId: toObjectId(entitlementId),
    authorUserId: toObjectId(userId),
  }).lean<ReviewDoc>();
}

/* ────────────────────────────────────────────── the prompt */

/** How long after purchase a review is worth asking for, absent a download. */
export const PROMPT_AFTER_DAYS = 3;

/**
 * Should we ask this customer for a review?
 *
 * **Never before use.** A review written before the software has run is a review of the
 * buying experience, which is not what a buyer reading it wants to know. So the prompt waits
 * for evidence of use — a recorded download — and falls back to a few days for a product
 * whose delivery is not a download at all.
 *
 * Dismissal is recorded on the entitlement and is permanent. "Ask me later" is a mechanism
 * for asking somebody four times, and the fourth time is the one they remember.
 */
export async function shouldPrompt(
  entitlement: Pick<EntitlementDoc, "_id" | "status"> & {
    createdAt?: Date;
    reviewPromptDismissedAt?: Date;
  },
  userId: string,
): Promise<boolean> {
  if (entitlement.status !== "active") return false;
  if (entitlement.reviewPromptDismissedAt) return false;

  await connectToDatabase();

  const existing = await Review.findOne({ entitlementId: entitlement._id })
    .select({ _id: 1 })
    .lean();
  if (existing) return false;

  const downloaded = await Download.findOne({ entitlementId: entitlement._id })
    .select({ _id: 1 })
    .lean();
  if (downloaded) return true;

  const purchased = entitlement.createdAt?.getTime() ?? Date.now();
  return Date.now() - purchased >= PROMPT_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** Dismiss the prompt for good. Scoped, so it can only ever be your own entitlement. */
export async function dismissPrompt(entitlementId: string, scope: OrgScope): Promise<void> {
  await connectToDatabase();

  const updated = await Entitlement.updateOne(
    { _id: toObjectId(entitlementId), ...orgFilter(scope) },
    { $set: { reviewPromptDismissedAt: new Date() } },
  );

  if (updated.matchedCount === 0) {
    throw new NotFoundError("entitlement", { id: entitlementId });
  }
}

/* ────────────────────────────────────────────── internals */

function toView(
  row: ReviewDoc & { authorUserId: { name?: string } | unknown },
  viewerUserId?: string,
): ReviewView {
  const author = row.authorUserId as { _id?: unknown; name?: string };

  return {
    id: String(row._id),
    rating: row.rating,
    ...(row.title ? { title: row.title } : {}),
    body: row.body,
    ...(row.versionAtReview ? { versionAtReview: row.versionAtReview } : {}),
    authorName: displayName(author?.name),
    createdAt: row.createdAt,
    ...(row.editedAt ? { editedAt: row.editedAt } : {}),
    ...(row.vendorResponse
      ? {
          vendorResponse: {
            body: row.vendorResponse.body,
            at: row.vendorResponse.at,
            ...(row.vendorResponse.editedAt ? { editedAt: row.vendorResponse.editedAt } : {}),
          },
        }
      : {}),
    ...(viewerUserId && String(author?._id ?? "") === viewerUserId ? { isMine: true } : {}),
  };
}

/**
 * "Ada Lovelace" → "Ada L."
 *
 * A public page carrying somebody's full name because they bought software is a privacy
 * decision nobody took. The initial is enough for a reader to see that reviews come from
 * different people, which is the only job the name does here.
 */
function displayName(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return "A customer";

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

async function versionLabel(entitlement: EntitlementDoc): Promise<string | undefined> {
  if (!entitlement.purchasedVersionId) return undefined;

  const { ProductVersion } = await import("@/lib/db/models/catalog");
  const version = await ProductVersion.findById(entitlement.purchasedVersionId)
    .select({ version: 1 })
    .lean<{ version: string }>();

  return version?.version;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/** Exported for the tests that assert a vendor cannot reach a moderation path. */
export function assertNotVendorModeration(actor: AuditActor): void {
  if (actor.type === "vendor") {
    throw new ForbiddenError(
      "A vendor cannot hide or remove a review of their own product. Report it instead.",
    );
  }
}
