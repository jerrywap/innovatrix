import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Product, type ProductDoc, type ProductReviewNote } from "@/lib/db/models/catalog";
import type { ReviewReasonCode } from "@/lib/db/enums";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { auditLogs } from "@/repositories/audit-log.repository";
import { products } from "@/repositories/product.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { emit } from "@/lib/events";
import { Vendor } from "@/lib/db/models/vendors";
import { VENDOR_AGREEMENT_VERSION } from "@/services/vendors/vendor-service";
import * as productService from "./product-service";

/**
 * Submission and review — vendor ticket 05.
 *
 * `PRODUCT_TRANSITIONS` had no submission edge and nowhere to put a reason, because
 * until now the person who wrote a product and the person who approved it worked for
 * the same company. A vendor marketplace without a review gate is a distribution
 * channel for whatever anybody uploads.
 *
 * The state moves go through `productService.transition`, which owns the graph, the
 * authorisation rules and the readiness gate. This module owns what a transition
 * *means*: the note that goes with it, the attestation, and telling the other side.
 */

/**
 * The wording a vendor accepts when they submit.
 *
 * Versioned as a string rather than a boolean because the record is a **defence** in
 * a takedown (vendor ticket 13), and "they ticked a box" is worth much less than
 * "they accepted this text, on this date". Changing the wording bumps the version so
 * a later dispute can tell which one was agreed.
 */
export const ATTESTATION_VERSION = "2026-08-01";

export const ATTESTATION_TEXT =
  "I own or am licensed to distribute everything in this package. It contains no " +
  "third-party code I cannot relicense, and no malware.";

/* ────────────────────────────────────────────── the vendor's side */

export interface SubmitInput {
  productId: string;
  scope: VendorScope;
  /** Must be true. Recorded with the user and the timestamp, never as a bare flag. */
  attested: boolean;
}

/**
 * Hand a product over for review.
 *
 * Three things have to hold, and none of them is checked in the form:
 *
 * 1. The transition is legal and this actor may take it — `transition` reads
 *    `PRODUCT_TRANSITION_RULES`, where `draft → submitted` has `permission: null`
 *    because nobody submits on a vendor's behalf.
 * 2. `computeReadiness()` reports no gaps — the same gate as publication.
 * 3. The attestation is given, and is stored against the version and the user.
 *
 * A vendor cannot submit again while a submission is open: `submitted` has no edge
 * to itself, so `assertTransition` refuses it. That is the guarantee rather than a
 * disabled button.
 */
export async function submit(
  input: SubmitInput,
  actor: AuditActor & { userId?: string },
): Promise<ProductDoc> {
  await connectToDatabase();

  if (!input.attested) {
    throw new ValidationError("You have to confirm the declaration before submitting.", {
      attested: ["Confirm that you may distribute everything in this package."],
    });
  }
  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("A submission must name who made it.");
  }

  const product = await products.findScoped(input.productId, input.scope);
  if (!product) throw new NotFoundError("product", { id: input.productId });

  // After the ownership read, deliberately. A caller asking about a product that is not
  // theirs must get the same 404 whatever the state of their own paperwork — otherwise the
  // order of the two checks decides what a probe learns.
  await assertAgreementCurrent(input.scope);

  const changedSections = await sectionsChangedSinceApproval(input.productId);
  const currentVersion = await currentVersionLabel(product);

  // The transition validates and moves; everything below records what it meant.
  const updated = await productService.transition(input.productId, "submitted", actor, {
    scope: input.scope,
  });

  const note: ProductReviewNote = {
    at: new Date(),
    byUserId: toObjectId(actor.userId),
    outcome: "submitted",
    reasons: [],
    detail: "Submitted for review.",
    ...(changedSections.length > 0 ? { changedSections } : {}),
  };

  await Product.updateOne(
    { _id: toObjectId(input.productId) },
    {
      $push: { reviewNotes: note },
      $set: {
        attestation: {
          at: note.at,
          byUserId: note.byUserId,
          ...(currentVersion ? { versionAtSubmission: currentVersion } : {}),
          statementVersion: ATTESTATION_VERSION,
        },
      },
    },
  );

  await writeAuditLog({
    action: "product.submitted",
    actor,
    subject: { type: "product", id: input.productId },
    // The attestation *version*, not the text: an audit row records that a
    // declaration was made and which one, not a copy of the paragraph.
    after: { attestationVersion: ATTESTATION_VERSION, changedSections },
    source: "vendor",
  });

  // After the write, never inside it.
  await emit("ProductSubmitted", {
    productId: input.productId,
    productName: updated.name,
    vendorName: updated.vendorName ?? "Innovatrix",
    isResubmission: product.reviewNotes.length > 0,
  });

  return updated;
}

/* ────────────────────────────────────────────── the reviewer's side */

export interface DecisionInput {
  productId: string;
  reasons: ReviewReasonCode[];
  /** Shown to the vendor verbatim. */
  detail: string;
  /** §37 — staff only, and never selected by a vendor-facing loader. */
  internalNote?: string;
}

/**
 * Claim a submission. No note: starting to read something is not feedback.
 *
 * The state move is real — `submitted → internal_review` takes it out of the waiting
 * count — so claiming a submission somebody else already claimed would otherwise fail
 * with the state machine's own wording, which names two identical states and reads like
 * a bug in us. See `alreadyApproved` for the other half of that problem.
 */
export async function claim(productId: string, actor: AuditActor): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  if (product.status === "internal_review") {
    throw new ValidationError(
      "Somebody is already reviewing this one. Reload to see where it got to.",
    );
  }

  return productService.transition(productId, "internal_review", actor);
}

/**
 * Send a submission back.
 *
 * The reason is required — `PRODUCT_TRANSITION_RULES` marks both
 * `→ changes_requested` edges `requiresReason`, and `transition` enforces it — and it
 * is **appended**, never overwritten. The third submission of a product is only
 * comprehensible next to what was said about the first two, and a "latest feedback"
 * field turns a conversation into a rumour.
 */
export async function requestChanges(
  input: DecisionInput,
  actor: AuditActor & { userId?: string },
): Promise<ProductDoc> {
  await connectToDatabase();

  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("A review decision must name who made it.");
  }
  if (!input.detail.trim()) {
    throw new ValidationError("Say what needs changing — the vendor reads this.", {
      detail: ["Required."],
    });
  }

  const product = await products.findById(input.productId);
  if (!product) throw new NotFoundError("product", { id: input.productId });

  const updated = await productService.transition(input.productId, "changes_requested", actor, {
    reason: input.detail,
  });

  await appendNote(input.productId, {
    at: new Date(),
    byUserId: toObjectId(actor.userId),
    outcome: "changes_requested",
    reasons: input.reasons,
    detail: input.detail,
    ...(input.internalNote ? { internalNote: input.internalNote } : {}),
  });

  await writeAuditLog({
    action: "product.changes_requested",
    actor,
    subject: { type: "product", id: input.productId },
    // The categories, not the prose. The prose is on the product where the vendor
    // can read it; duplicating it here would put a reviewer's wording in an
    // append-only collection for no reader.
    after: { reasons: input.reasons, hasInternalNote: Boolean(input.internalNote) },
    source: "staff",
  });

  if (updated.vendorId) {
    await emit("ProductChangesRequested", {
      productId: input.productId,
      productName: updated.name,
      vendorId: String(updated.vendorId),
      detail: input.detail,
    });
  }

  return updated;
}

/**
 * Approve a submission into the platform's own pipeline.
 *
 * `submitted → internal_review` is the edge, and approving a *submission* is not
 * approving a *product*: from here it takes exactly the path a first-party product
 * takes — the same testing checklist, the same readiness gate, the same
 * `product.publish` at the end.
 *
 * ## Claiming first used to make approval impossible
 *
 * `claim` takes the **same** edge, so a reviewer who pressed "Start review" — which the
 * screen offers first and describes as the polite thing to do — moved the product to
 * `internal_review`, and approving then asked for `internal_review → internal_review`.
 * `assertTransition` refused it, correctly, with "A product cannot move from
 * internal_review to internal_review". Approval worked only for a reviewer who skipped
 * the claim. It was reported by the first person to use the screen in the intended
 * order.
 *
 * So approval accepts a product already in `internal_review` and moves no state, because
 * the state is already where approval puts it. The decision was never the transition: it
 * is the note the vendor reads, the audit row, and `ProductApproved`.
 *
 * ## Which means the transition is no longer what stops a double approval
 *
 * A guarded state move used to make a second approval impossible for free. With the
 * `internal_review` case allowed, two reviewers could both approve, appending two notes
 * and telling the vendor twice. `alreadyApproved` restores that: an approval after the
 * newest submission means this submission is decided, and only a fresh `submitted` note
 * opens it again.
 */
export async function approve(
  input: Omit<DecisionInput, "reasons"> & { reasons?: ReviewReasonCode[] },
  actor: AuditActor & { userId?: string },
): Promise<ProductDoc> {
  await connectToDatabase();

  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("A review decision must name who made it.");
  }

  const product = await products.findById(input.productId);
  if (!product) throw new NotFoundError("product", { id: input.productId });

  if (alreadyApproved(product)) {
    throw new ValidationError(
      "This submission has already been approved. It is in our own pipeline now — " +
        "publishing happens from the product's admin screen.",
    );
  }

  const updated =
    product.status === "internal_review"
      ? product
      : await productService.transition(input.productId, "internal_review", actor);

  await appendNote(input.productId, {
    at: new Date(),
    byUserId: toObjectId(actor.userId),
    outcome: "approved",
    reasons: input.reasons ?? [],
    detail: input.detail.trim() || "Approved into internal review.",
    ...(input.internalNote ? { internalNote: input.internalNote } : {}),
  });

  await writeAuditLog({
    action: "product.submission_approved",
    actor,
    subject: { type: "product", id: input.productId },
    after: { outcome: "approved" },
    source: "staff",
  });

  if (updated.vendorId) {
    await emit("ProductApproved", {
      productId: input.productId,
      productName: updated.name,
      vendorId: String(updated.vendorId),
    });
  }

  return updated;
}

/**
 * Has the newest submission already been decided in the vendor's favour?
 *
 * Read off `reviewNotes`, which is append-only and already holds exactly this: find the
 * last `submitted` note and ask whether an `approved` one follows it. A resubmission
 * pushes a new `submitted` note, which reopens the question by construction — no flag to
 * clear, and nothing to get out of step with the notes a reviewer reads.
 *
 * A product with an `approved` note and no submission at all is treated as decided too,
 * which is the honest answer for the staff-driven path where nobody submitted anything.
 */
export function alreadyApproved(product: ProductDoc): boolean {
  let lastSubmitted = -1;
  for (const [index, note] of product.reviewNotes.entries()) {
    if (note.outcome === "submitted") lastSubmitted = index;
  }
  return product.reviewNotes.some(
    (note, index) => note.outcome === "approved" && index > lastSubmitted,
  );
}

async function appendNote(productId: string, note: ProductReviewNote): Promise<void> {
  const result = await Product.updateOne(
    { _id: toObjectId(productId) },
    { $push: { reviewNotes: note } },
  );
  if (result.matchedCount === 0) throw new NotFoundError("product", { id: productId });
}

/* ────────────────────────────────────────────── the resubmission diff */

/**
 * Which sections changed since the last approval.
 *
 * Vendor ticket 05 asks the reviewer to see "what changed since the last approved
 * version", because a resubmission is usually a small change and re-reviewing the
 * whole product is how a queue falls behind.
 *
 * ## Why this is section-level and derived, not a stored diff
 *
 * A field-level diff of a product document would need a snapshot per submission, and
 * a snapshot of a product carries every price **and every `passwordCipher`** — the
 * exact thing the audit log refuses to store for that reason. So this reads rows that
 * already exist: `product.section_updated` records the changed field *names* per
 * section save, never values. The answer is a list of section names, which is what a
 * reviewer actually needs to decide where to look.
 *
 * Bounded (§94): 200 rows, which spans far more saves than any real review cycle.
 */
export async function sectionsChangedSinceApproval(productId: string): Promise<string[]> {
  await connectToDatabase();

  const page = await auditLogs.listForSubject("product", productId, { limit: 200 });

  const sections = new Set<string>();
  // Newest first, so walk until the previous approval and stop.
  for (const row of page.items) {
    if (row.action === "product.submission_approved") break;
    if (row.action !== "product.section_updated") continue;

    const section = (row.after as { section?: unknown } | undefined)?.section;
    if (typeof section === "string") sections.add(section);
  }

  return [...sections].sort();
}

/** The released version's label, for the attestation. */
async function currentVersionLabel(product: ProductDoc): Promise<string | undefined> {
  if (!product.currentVersionId) return undefined;

  const { productVersions } = await import("@/repositories/product-version.repository");
  const version = await productVersions.findById(String(product.currentVersionId));
  return version?.version;
}

/* ────────────────────────────────────────────── reading the queue */

export interface SubmissionRow {
  id: string;
  name: string;
  slug: string;
  vendorName: string;
  status: string;
  submittedAt?: Date;
  resubmission: boolean;
  changedSections: string[];
}

/**
 * Submissions waiting on a reviewer, **oldest first**.
 *
 * A vendor waiting on a review has a product earning nothing, and the fairest order
 * is the obvious one. Bounded, like every list here.
 */
export async function listSubmissions(limit = 100): Promise<SubmissionRow[]> {
  await connectToDatabase();

  const page = await products.list({
    filter: { status: { $in: ["submitted", "internal_review"] } },
    sort: { updatedAt: 1 },
    limit: Math.min(limit, 200),
  });

  return page.items.map((product) => {
    const submissions = product.reviewNotes.filter((note) => note.outcome === "submitted");
    const latest = submissions.at(-1);

    return {
      id: String(product._id),
      name: product.name,
      slug: product.slug,
      // First-party products go through this queue too when staff use the submission
      // path; naming the platform is more honest than an empty cell.
      vendorName: product.vendorName ?? "Innovatrix",
      status: product.status,
      ...(latest ? { submittedAt: latest.at } : {}),
      resubmission: submissions.length > 1,
      changedSections: latest?.changedSections ?? [],
    };
  });
}

/** How many submissions are waiting — for the staff dashboard counter. */
export async function countAwaitingReview(): Promise<number> {
  await connectToDatabase();
  return Product.countDocuments({ status: "submitted", deletedAt: null });
}

/**
 * The agreement gate — vendor ticket 07.
 *
 * A new agreement version requires re-acceptance, and **submission** is where that bites:
 * the vendor can go on servicing every customer they already have, their published products
 * stay published, and the only thing they cannot do is put something *new* in front of our
 * customers under terms they have not agreed. That is the softest gate that still means
 * something, which is what the ticket asked for.
 *
 * Here rather than in the action, and before the ownership read, because it is a fact about
 * the vendor rather than about the product — an action-layer check would have to be repeated
 * on every future submission path, and the one that gets forgotten is the one that matters.
 *
 * A `ValidationError` rather than a `ForbiddenError`: nothing is being refused on
 * authority, there is a specific thing to do about it, and `ActionResult` carries the
 * message to the form.
 */
async function assertAgreementCurrent(scope: VendorScope): Promise<void> {
  const vendorId = scope.vendorId?.trim();
  // No vendor scope means a first-party product, submitted by staff. There is no agreement
  // between Innovatrix and itself.
  if (!vendorId) return;

  const vendor = await Vendor.findById(vendorId)
    .select({ agreement: 1 })
    .lean<{ agreement?: { version: string } }>();

  if (vendor?.agreement?.version === VENDOR_AGREEMENT_VERSION) return;

  throw new ValidationError(
    "Our vendor agreement has been updated. Accept the new version before submitting " +
      "anything new — everything already on sale is unaffected.",
    { agreement: ["Accept the current agreement in your selling settings."] },
  );
}
