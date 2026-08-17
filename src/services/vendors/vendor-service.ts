import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { Vendor, VendorMember, type VendorDoc } from "@/lib/db/models/vendors";
import type { VendorStatus, VendorVerificationLevel } from "@/lib/db/enums";
import { VENDOR_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { statusChange, writeAuditLog, type AuditActor } from "@/services/audit";
import { emit } from "@/lib/events";

/**
 * Vendor identity — vendor tickets 01 and 02.
 *
 * Rules live here rather than in the actions, which stay thin: `src/features/**`
 * is outside vitest's coverage floor and this is not.
 */

/** The agreement version an application accepts. Bumping it forces re-acceptance. */
export const VENDOR_AGREEMENT_VERSION = "2026-08-01";

export interface ApplyInput {
  displayName: string;
  contactEmail: string;
  country: string;
  pitch: string;
  supportEmail?: string;
  websiteUrl?: string;
}

/**
 * Apply to become a vendor.
 *
 * The `Vendor` and its owner `VendorMember` are written in **one transaction**,
 * so a vendor never exists without an owner. That is not tidiness: an ownerless
 * vendor has payout details nobody may change and nobody who can accept a new
 * agreement version, and no sweep can reliably repair one later. It also means a
 * solo vendor is a vendor with one member rather than a vendor with none, so no
 * code downstream branches on "has a team".
 */
export async function apply(
  input: ApplyInput,
  user: { id: string; name?: string },
): Promise<VendorDoc> {
  await connectToDatabase();

  // One vendor per user. The partial unique index on `VendorMember.userId` is the
  // real guarantee; this exists so the applicant gets a sentence rather than a
  // duplicate-key error.
  const existing = await VendorMember.findOne({ userId: user.id, status: "active" }).lean();
  if (existing) {
    throw new ConflictError(
      "You already belong to a vendor account. One account per person, for now.",
    );
  }

  const slug = await reserveSlug(input.displayName);

  const write = async (session?: ClientSession) => {
    const now = new Date();
    const [vendor] = await Vendor.create(
      [
        {
          slug,
          displayName: input.displayName,
          contactEmail: input.contactEmail,
          country: input.country,
          pitch: input.pitch,
          status: "applied" as const,
          appliedAt: now,
          agreement: {
            version: VENDOR_AGREEMENT_VERSION,
            acceptedAt: now,
            acceptedByUserId: toObjectId(user.id),
          },
          profile: {
            ...(input.supportEmail ? { supportEmail: input.supportEmail } : {}),
            ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
          },
          verification: {
            identity: { status: "unstarted" as const },
            business: { status: "unstarted" as const },
          },
          verificationDecisions: [],
          deletedAt: null,
        },
      ],
      session ? { session } : {},
    );

    if (!vendor) throw new Error("Vendor.create returned nothing.");

    await VendorMember.create(
      [
        {
          vendorId: vendor._id,
          userId: toObjectId(user.id),
          role: "owner" as const,
          status: "active" as const,
          acceptedAt: now,
        },
      ],
      session ? { session } : {},
    );

    await writeAuditLog(
      {
        action: "vendor.applied",
        actor: { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
        subject: { type: "vendor", id: String(vendor._id) },
        after: { status: "applied", slug, agreementVersion: VENDOR_AGREEMENT_VERSION },
        source: "vendor",
      },
      session,
    );

    return vendor.toObject() as VendorDoc;
  };

  const vendor = supportsTransactions() ? await withTransaction(write) : await write();

  // After the transaction, never inside it — a handler that throws must not
  // un-apply an application, and `withTransaction`'s callback may run twice.
  await emit("VendorApplied", {
    vendorId: String(vendor._id),
    displayName: vendor.displayName,
    country: vendor.country,
  });

  return vendor;
}

/**
 * A unique storefront slug derived from the display name.
 *
 * Suffixed rather than refused, because a vendor whose chosen name collides has
 * done nothing wrong and the slug is not the thing they came to choose. The
 * uniqueness index is still the guarantee — this only makes the common case not
 * need one.
 */
async function reserveSlug(displayName: string): Promise<string> {
  const base = slugify(displayName);
  if (!base) {
    throw new ValidationError("That name cannot be turned into a web address.", {
      displayName: ["Use at least one letter or number."],
    });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await Vendor.exists({ slug: candidate });
    if (!taken) return candidate;
  }

  throw new ConflictError("That name is too similar to existing vendors. Try another.");
}

/**
 * Move a vendor through `VENDOR_TRANSITIONS`.
 *
 * `assertTransition` runs first, then the guarded update. The guard is the same
 * `findOneAndUpdate({ _id, status: from })` shape `productService.transition`
 * uses: two reviewers deciding the same application simultaneously produce one
 * success, one clean `ConflictError`, and **one** audit row.
 */
export async function transition(
  vendorId: string,
  to: VendorStatus,
  actor: AuditActor,
  options: { reason?: string; ip?: string; userAgent?: string } = {},
): Promise<VendorDoc> {
  await connectToDatabase();

  const vendor = await Vendor.findOne({
    _id: toObjectId(vendorId),
    deletedAt: null,
  }).lean<VendorDoc>();
  if (!vendor) throw new NotFoundError("vendor", { id: vendorId });

  const from = vendor.status;
  assertTransition("vendor", VENDOR_TRANSITIONS, from, to);

  if (to === "rejected" && !options.reason?.trim()) {
    throw new ValidationError("A rejection needs a reason the applicant can read.", {
      reason: ["Say why, in a sentence they will see."],
    });
  }

  if (to === "verified" && vendor.verification.identity.status !== "approved") {
    throw new ValidationError(
      "Identity verification must be approved before a vendor is verified.",
      { verification: ["Approve the identity level first."] },
    );
  }

  const stamp: Record<string, unknown> = {};
  if (to === "verified") stamp.verifiedAt = new Date();
  if (to === "suspended") {
    stamp.suspendedAt = new Date();
    if (options.reason) stamp.suspensionReason = options.reason;
  }
  if (to === "rejected" && options.reason) stamp.rejectionReason = options.reason;

  const write = async (session?: ClientSession) => {
    const updated = await Vendor.findOneAndUpdate(
      { _id: toObjectId(vendorId), status: from },
      { $set: { status: to, ...stamp } },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<VendorDoc>();

    if (!updated) {
      throw new ConflictError(
        "Someone else changed this vendor's status while you were deciding. Reload and look again.",
      );
    }

    await writeAuditLog(
      {
        action: "vendor.status_changed",
        actor,
        subject: { type: "vendor", id: vendorId },
        ...statusChange(from, to, options.reason ? { reason: options.reason } : {}),
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        source: "staff",
      },
      session,
    );

    return updated;
  };

  const updated = supportsTransactions() ? await withTransaction(write) : await write();

  // Vendor ticket 01's events, emitted after the commit. `rejected` and `suspended`
  // carry the reason because the vendor reads it verbatim — which is also why
  // `transition` refuses those edges without one.
  if (to === "verified") {
    await emit("VendorVerified", { vendorId, displayName: updated.displayName });
  }
  if (to === "rejected") {
    await emit("VendorRejected", {
      vendorId,
      displayName: updated.displayName,
      reason: options.reason ?? "",
    });
  }
  if (to === "suspended") {
    await emit("VendorSuspended", {
      vendorId,
      displayName: updated.displayName,
      reason: options.reason ?? "",
    });
  }

  return updated;
}

/**
 * Approve or reject one verification level.
 *
 * The decision is appended to `verificationDecisions` and the level's summary
 * status is set from it. Both happen in one update so the summary can never
 * disagree with the history behind it.
 *
 * `documentHashes` is what makes the outcome survive the documents: once the
 * objects are purged, the hashes are the only remaining evidence of *what* was
 * read, and a decision nobody can tie to a document is not a decision anybody
 * can defend.
 */
export async function decideVerification(
  vendorId: string,
  input: {
    level: VendorVerificationLevel;
    outcome: "approved" | "rejected";
    documentHashes: string[];
    note?: string;
  },
  actor: AuditActor & { userId?: string },
): Promise<VendorDoc> {
  await connectToDatabase();

  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("A verification decision must name the person who made it.");
  }

  const vendor = await Vendor.findOne({
    _id: toObjectId(vendorId),
    deletedAt: null,
  }).lean<VendorDoc>();
  if (!vendor) throw new NotFoundError("vendor", { id: vendorId });

  if (input.outcome === "rejected" && !input.note?.trim()) {
    throw new ValidationError("A rejected level needs a note saying what was wrong.", {
      note: ["The vendor is told this, so it has to be usable."],
    });
  }

  const at = new Date();
  const decision = {
    level: input.level,
    outcome: input.outcome,
    byUserId: toObjectId(actor.userId),
    at,
    documentHashes: input.documentHashes,
    ...(input.note ? { note: input.note } : {}),
  };

  const updated = await Vendor.findOneAndUpdate(
    { _id: toObjectId(vendorId) },
    {
      $set: {
        [`verification.${input.level}.status`]: input.outcome,
        [`verification.${input.level}.decidedAt`]: at,
      },
      $push: { verificationDecisions: decision },
    },
    { returnDocument: "after" },
  ).lean<VendorDoc>();

  if (!updated) throw new NotFoundError("vendor", { id: vendorId });

  await writeAuditLog({
    action: "vendor.verification_decided",
    actor,
    subject: { type: "vendor", id: vendorId },
    before: { [`verification.${input.level}`]: vendor.verification[input.level].status },
    after: {
      [`verification.${input.level}`]: input.outcome,
      documentCount: input.documentHashes.length,
    },
    source: "staff",
  });

  return updated;
}

export interface SaveProfileInput {
  displayName: string;
  contactEmail: string;
  summary?: string;
  supportEmail?: string;
  websiteUrl?: string;
}

/**
 * Edit the vendor's own profile.
 *
 * The **slug is not here** and cannot be changed once verified: it is the
 * storefront address, vendor ticket 11 puts it in the sitemap, and vendor
 * ticket 04 denormalises it onto every product for the `vend:` facet. A rename
 * would mean a bulk re-derive and a pile of dead URLs, for a field nobody came
 * here to change.
 *
 * `displayName` *is* editable, which is why it is denormalised separately from
 * the slug — see `renameProducts` in vendor ticket 04.
 *
 * `$unset` for cleared optionals rather than `$set: undefined`, which Mongo drops
 * silently: without it, deleting a website URL saves successfully, shows an empty
 * form, and leaves the old value on the storefront.
 */
export async function saveProfile(
  vendorId: string,
  input: SaveProfileInput,
  actor: AuditActor,
): Promise<VendorDoc> {
  await connectToDatabase();

  const set: Record<string, unknown> = {
    displayName: input.displayName,
    contactEmail: input.contactEmail,
  };
  const unset: Record<string, ""> = {};

  for (const [field, value] of [
    ["profile.summary", input.summary],
    ["profile.supportEmail", input.supportEmail],
    ["profile.websiteUrl", input.websiteUrl],
  ] as const) {
    if (value === undefined || value === "") unset[field] = "";
    else set[field] = value;
  }

  const updated = await Vendor.findOneAndUpdate(
    { _id: toObjectId(vendorId), deletedAt: null },
    { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
    { returnDocument: "after" },
  ).lean<VendorDoc>();

  if (!updated) throw new NotFoundError("vendor", { id: vendorId });

  await writeAuditLog({
    action: "vendor.profile_updated",
    actor,
    subject: { type: "vendor", id: vendorId },
    // Field names, never values — the same rule the product wizard follows.
    after: { fields: [...Object.keys(set), ...Object.keys(unset)].sort() },
    source: "vendor",
  });

  return updated;
}

/**
 * Accept the current agreement version — vendor ticket 07.
 *
 * Owner-only at the guard, because it is the owner who is bound by it. The record replaces
 * the previous acceptance rather than appending: the audit log holds the history, and it is
 * the collection designed for "what was true and when", so a second copy on the vendor
 * would be a second answer to the same question.
 *
 * Idempotent — accepting the version already accepted is a no-op that still returns the
 * vendor, so a double-submitted form does not need a guard of its own.
 */
export async function acceptAgreement(
  vendorId: string,
  userId: string,
  actor: AuditActor,
): Promise<VendorDoc> {
  await connectToDatabase();

  const before = await Vendor.findOne({ _id: toObjectId(vendorId), deletedAt: null })
    .select({ agreement: 1 })
    .lean<{ agreement?: { version: string } }>();
  if (!before) throw new NotFoundError("vendor", { id: vendorId });

  if (before.agreement?.version === VENDOR_AGREEMENT_VERSION) {
    const current = await findById(vendorId);
    if (!current) throw new NotFoundError("vendor", { id: vendorId });
    return current;
  }

  const updated = await Vendor.findOneAndUpdate(
    { _id: toObjectId(vendorId), deletedAt: null },
    {
      $set: {
        agreement: {
          version: VENDOR_AGREEMENT_VERSION,
          acceptedAt: new Date(),
          acceptedByUserId: toObjectId(userId),
        },
      },
    },
    { returnDocument: "after" },
  ).lean<VendorDoc>();

  if (!updated) throw new NotFoundError("vendor", { id: vendorId });

  await writeAuditLog({
    action: "vendor.agreement_accepted",
    actor,
    subject: { type: "vendor", id: vendorId },
    // The versions themselves, not field names: which text was agreed is the whole value of
    // the row, and it is the thing a takedown or a dispute turns on.
    before: { version: before.agreement?.version ?? null },
    after: { version: VENDOR_AGREEMENT_VERSION },
    source: "vendor",
  });

  return updated;
}

/** Whether this vendor has accepted the version currently in force. */
export function agreementIsCurrent(vendor: Pick<VendorDoc, "agreement">): boolean {
  return vendor.agreement?.version === VENDOR_AGREEMENT_VERSION;
}

/** A vendor by id, or null. Staff-facing — no scope, by design. */
export async function findById(vendorId: string): Promise<VendorDoc | null> {
  await connectToDatabase();
  return Vendor.findOne({ _id: toObjectId(vendorId), deletedAt: null }).lean<VendorDoc>();
}

export interface VendorListRow {
  id: string;
  slug: string;
  displayName: string;
  country: string;
  status: VendorStatus;
  appliedAt: Date;
  identityStatus: string;
  businessStatus: string;
}

/**
 * Applications awaiting a decision, oldest first.
 *
 * §94: bounded, always. `limit` is a cap rather than a suggestion — a queue that
 * grows without one is the query that takes the marketplace down on the day it
 * matters.
 */
export async function listByStatus(
  statuses: readonly VendorStatus[],
  limit = 100,
): Promise<VendorListRow[]> {
  await connectToDatabase();

  const rows = await Vendor.find({ status: { $in: statuses }, deletedAt: null })
    .sort({ appliedAt: 1 })
    .limit(Math.min(limit, 200))
    .lean<VendorDoc[]>();

  return rows.map((row) => ({
    id: String(row._id),
    slug: row.slug,
    displayName: row.displayName,
    country: row.country,
    status: row.status,
    appliedAt: row.appliedAt,
    identityStatus: row.verification.identity.status,
    businessStatus: row.verification.business.status,
  }));
}

/** How many applications are waiting — for the staff dashboard counter. */
export async function countAwaitingReview(): Promise<number> {
  await connectToDatabase();
  return Vendor.countDocuments({ status: { $in: ["applied", "in_review"] }, deletedAt: null });
}
