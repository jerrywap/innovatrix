import "server-only";
import type { Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { TakedownClaim, type TakedownClaimDoc } from "@/lib/db/models/takedowns";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import * as lifecycle from "./lifecycle-service";

/**
 * Takedown claims — vendor ticket 13.
 *
 * A defined path, because the alternative is an ad-hoc decision under time pressure — and a
 * takedown is the thing most likely to be litigated. Five steps, each recorded:
 *
 * 1. **Received** — the claimant and the specific allegation.
 * 2. **Delisted** where the claim is credible, using vendor ticket 12's emergency delisting, which
 *    suspends entitlements rather than revoking them.
 * 3. **Vendor notified**, with the claim and a window to respond. Their submission attestation
 *    (vendor ticket 05) is the record this is weighed against.
 * 4. **Resolution** — reinstate, remove permanently, or offboard.
 * 5. **Affected customers told** what happened and what they are owed.
 *
 * ## Delisting is a separate step from receiving
 *
 * Deliberately. A claim is not a finding, and a system that delisted on receipt would be a system
 * where a competitor can take a product down by emailing us. Step 2 is a judgement somebody makes,
 * with a permission behind it, and step 1 records the claim whether or not step 2 follows.
 */

/** How long a vendor is given to answer a claim before the resolution proceeds without them. */
export const VENDOR_RESPONSE_DAYS = 7;

export interface RecordClaimInput {
  productId: string;
  claimant: { name: string; email: string; organisation?: string };
  allegation: string;
  referenceUrl?: string;
}

/**
 * Step 1 — record it.
 *
 * Nothing happens to the product here. The value of this call is the record: who claimed, what
 * exactly they alleged, and when we heard it. A claim that turns out to be baseless still needs to
 * exist, because "we received no such notice" is a much weaker position than "we received it,
 * assessed it, and rejected it for these reasons".
 */
export async function recordClaim(
  input: RecordClaimInput,
  actor: AuditActor & { userId?: string },
): Promise<TakedownClaimDoc> {
  await connectToDatabase();

  if (!input.allegation.trim()) {
    throw new ValidationError("Record what is actually alleged.", {
      allegation: ["The specificity is the whole value of the record."],
    });
  }

  const product = await Product.findById(toObjectId(input.productId))
    .select({ vendorId: 1, name: 1 })
    .lean<{ vendorId?: Types.ObjectId; name: string }>();
  if (!product) throw new NotFoundError("product", { id: input.productId });

  const [claim] = await TakedownClaim.create([
    {
      productId: toObjectId(input.productId),
      ...(product.vendorId ? { vendorId: product.vendorId } : {}),
      status: "received" as const,
      claimant: input.claimant,
      allegation: input.allegation.trim(),
      ...(input.referenceUrl ? { referenceUrl: input.referenceUrl } : {}),
      ...(actor.userId ? { receivedByUserId: toObjectId(actor.userId) } : {}),
    },
  ]);

  if (!claim) throw new Error("TakedownClaim.create returned nothing.");

  await writeAuditLog({
    action: "takedown.received",
    actor,
    subject: { type: "product", id: input.productId },
    after: {
      claimId: String(claim._id),
      claimant: input.claimant.name,
      claimantEmail: input.claimant.email,
      // The allegation in the audit row as well as on the claim: the claim document is mutable
      // by design (its status moves), and §90's append-only copy is what proves what was said
      // when.
      allegation: input.allegation.trim(),
    },
  });

  return claim.toObject() as TakedownClaimDoc;
}

/**
 * Step 2 — take it down, and start the vendor's clock.
 *
 * Uses vendor ticket 12's `emergencyDelist`, so the entitlement handling is the same one decision:
 * **suspended, not revoked**. A customer who paid for something later found to be stolen is owed a
 * refund conversation, and revoking would remove both the software and the record that they had it.
 *
 * Returns the slugs the caller must invalidate, for the same reason the lifecycle service does —
 * `revalidateTag` needs a request context.
 */
export async function delistForClaim(
  claimId: string,
  actor: AuditActor & { userId?: string },
): Promise<{
  claim: TakedownClaimDoc;
  entitlementsSuspended: number;
  productSlug: string;
  vendorSlug?: string;
}> {
  await connectToDatabase();

  const claim = await TakedownClaim.findById(toObjectId(claimId)).lean<TakedownClaimDoc>();
  if (!claim) throw new NotFoundError("takedown", { id: claimId });

  const delisted = await lifecycle.emergencyDelist(
    String(claim.productId),
    `Takedown claim from ${claim.claimant.name}: ${claim.allegation}`,
    actor,
  );

  const updated = await TakedownClaim.findByIdAndUpdate(
    toObjectId(claimId),
    {
      $set: {
        status: "awaiting_vendor",
        delistedAt: new Date(),
        vendorNotifiedAt: new Date(),
        vendorResponseDueAt: new Date(Date.now() + VENDOR_RESPONSE_DAYS * 24 * 60 * 60 * 1000),
      },
    },
    { returnDocument: "after" },
  ).lean<TakedownClaimDoc>();

  if (!updated) throw new NotFoundError("takedown", { id: claimId });

  await writeAuditLog({
    action: "takedown.delisted",
    actor,
    subject: { type: "product", id: String(claim.productId) },
    after: {
      claimId,
      entitlementsSuspended: delisted.entitlementsSuspended,
      vendorResponseDueAt: updated.vendorResponseDueAt,
    },
  });

  return {
    claim: updated,
    entitlementsSuspended: delisted.entitlementsSuspended,
    productSlug: delisted.productSlug,
    ...(delisted.vendorSlug ? { vendorSlug: delisted.vendorSlug } : {}),
  };
}

/**
 * Step 3 — the vendor answers.
 *
 * Recorded verbatim on the claim. Their submission attestation is what this is weighed against:
 * they declared, with a timestamp and a statement version, that they were licensed to distribute
 * everything in the package (vendor ticket 05), and that declaration is either true or it is the
 * thing that ends the relationship.
 */
export async function recordVendorResponse(
  claimId: string,
  body: string,
  actor: AuditActor & { userId: string },
): Promise<TakedownClaimDoc> {
  await connectToDatabase();

  if (!body.trim()) {
    throw new ValidationError(
      "Say something — this is the record we weigh the claim against.",
      {
        body: ["An empty response is read as no response."],
      },
    );
  }

  const updated = await TakedownClaim.findOneAndUpdate(
    {
      _id: toObjectId(claimId),
      status: { $in: ["received", "product_delisted", "awaiting_vendor"] },
    },
    {
      $set: {
        vendorResponse: {
          body: body.trim(),
          at: new Date(),
          byUserId: toObjectId(actor.userId),
        },
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean<TakedownClaimDoc>();

  if (!updated) throw new NotFoundError("takedown", { id: claimId });

  await writeAuditLog({
    action: "takedown.vendor_responded",
    actor,
    subject: { type: "product", id: String(updated.productId) },
    // The response is on the claim; the audit row records that it happened and when. Copying
    // 8,000 characters into an append-only collection twice is not a record, it is a duplicate.
    after: { claimId, responded: true },
    source: "vendor",
  });

  return updated;
}

/**
 * Steps 4 and 5 — decide, and say so.
 *
 * A reason is required whatever the outcome, including `claim_rejected`: the claimant is told, and
 * "your claim was rejected" with no reasoning is what produces the second claim.
 *
 * Reinstating is deliberately **not** automatic here. `emergencyDelist` archives the product, and
 * bringing it back is a re-publication somebody performs through the normal path — a resolution
 * that silently republished would be a takedown reversal with no review of what changed.
 */
export async function resolveClaim(
  claimId: string,
  outcome: NonNullable<TakedownClaimDoc["resolution"]>["outcome"],
  reason: string,
  actor: AuditActor & { userId: string },
): Promise<TakedownClaimDoc> {
  await connectToDatabase();

  if (!reason.trim()) {
    throw new ValidationError("A resolution needs a reason on the record.", {
      reason: ["The claimant and the vendor are both told what was decided."],
    });
  }

  const updated = await TakedownClaim.findOneAndUpdate(
    { _id: toObjectId(claimId), status: { $ne: "resolved" } },
    {
      $set: {
        status: outcome === "claim_rejected" ? "rejected" : "resolved",
        resolution: {
          outcome,
          reason: reason.trim(),
          at: new Date(),
          byUserId: toObjectId(actor.userId),
        },
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean<TakedownClaimDoc>();

  if (!updated) throw new NotFoundError("takedown", { id: claimId });

  await writeAuditLog({
    action: "takedown.resolved",
    actor,
    subject: { type: "product", id: String(updated.productId) },
    after: { claimId, outcome, reason: reason.trim() },
  });

  return updated;
}

/** The queue: unresolved first, oldest first. */
export async function listClaims(
  options: { openOnly?: boolean; limit?: number } = {},
): Promise<TakedownClaimDoc[]> {
  await connectToDatabase();

  return TakedownClaim.find(
    options.openOnly ? { status: { $nin: ["resolved", "rejected"] } } : {},
  )
    .sort({ createdAt: 1 })
    .limit(Math.min(options.limit ?? 100, 500))
    .lean<TakedownClaimDoc[]>();
}

/** One vendor's claims, for their own screen — they are entitled to see what was alleged. */
export async function listForVendor(vendorId: string): Promise<TakedownClaimDoc[]> {
  await connectToDatabase();

  return TakedownClaim.find({ vendorId: toObjectId(vendorId) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<TakedownClaimDoc[]>();
}
