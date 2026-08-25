import { Schema, type Types } from "mongoose";
import { schemaOptions } from "@/lib/db/base";
import { defineModel } from "@/lib/db/client";
import {
  MEMBER_STATUSES,
  VENDOR_DOCUMENT_KINDS,
  VENDOR_INVITATION_STATUSES,
  VENDOR_ROLES,
  VENDOR_STATUSES,
  VENDOR_ACCOUNT_TYPES,
  VENDOR_VERIFICATION_LEVELS,
  VENDOR_VERIFICATION_STATUSES,
  type MemberStatus,
  type VendorDocumentKind,
  type VendorInvitationStatus,
  type VendorRole,
  type VendorStatus,
  type VendorAccountType,
  type VendorVerificationLevel,
  type VendorVerificationStatus,
} from "@/lib/db/enums";

/**
 * Third-party vendors — vendor tickets 01–03.
 *
 * ## Why a `Vendor` and not an `Organization`
 *
 * `Organization` is the obvious reuse and the wrong one. It is buyer-shaped —
 * `billingAddress`, `taxId`, `customerSince`, `isPersonal` — and it is **half
 * owned by Better Auth's raw MongoDB driver**, so Mongoose defaults never fire
 * on it, `required: true` is a trap, and any field that will be filtered on must
 * also be declared in Better Auth's `additionalFields`. Putting a receivable
 * identity inside a document that is otherwise purely a payer buys nothing and
 * costs the ability to trust the schema.
 *
 * These collections are ours outright: Mongoose is the only writer, defaults
 * fire, and `npm run db:indexes` builds every index declared below.
 *
 * ## One vendor per user
 *
 * A deliberate constraint rather than a technical limit, enforced by the partial
 * unique index on `VendorMember.userId`. The alternative needs a vendor switcher
 * in the chrome, and the customer shell already carries an `OrgSwitcher`; a
 * second switcher means every screen answers "as whom am I acting" before it
 * answers anything else. Revisitable later without a data migration — dropping
 * the index is the whole change.
 */

/* ────────────────────────────────────────────── Vendor */

/** What was decided about one verification level, kept after the documents go. */
export interface VendorVerificationDecision {
  level: VendorVerificationLevel;
  outcome: "approved" | "rejected";
  byUserId: Types.ObjectId;
  at: Date;
  /**
   * SHA-256 of each document that was read, so the decision stays checkable
   * after the objects are purged. Never the documents themselves.
   */
  documentHashes: string[];
  note?: string;
}

export interface VendorDoc {
  _id: Types.ObjectId;
  /** The storefront URL. Immutable once verified — vendor ticket 11 indexes it. */
  slug: string;
  displayName: string;
  legalName?: string;
  /**
   * Sole trader or company — vendor ticket 02, revisited.
   *
   * Optional because every vendor who applied before this existed has none, and
   * the verification screen asks for it rather than guessing. Absent means "not
   * chosen yet", which is a state the screen renders rather than a default it
   * invents: defaulting to `individual` would quietly stop asking a company for
   * its registration.
   */
  accountType?: VendorAccountType;
  contactEmail: string;
  country: string;
  status: VendorStatus;
  appliedAt: Date;
  verifiedAt?: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
  /** Why an application was refused, shown to the applicant verbatim. */
  rejectionReason?: string;
  /** What they say they build — the substance of the application. */
  pitch: string;
  /** Which version of the vendor agreement was accepted, and by whom. */
  agreement?: { version: string; acceptedAt: Date; acceptedByUserId: Types.ObjectId };
  profile: { summary?: string; websiteUrl?: string; supportEmail?: string; logoUrl?: string };
  /**
   * Identity unlocks listing (vendor ticket 04); business unlocks a payout
   * (vendor ticket 09). Ordered deliberately: it removes the slowest step from
   * the path to a first listing without ever letting money leave to an
   * unverified account.
   */
  verification: Record<
    VendorVerificationLevel,
    { status: VendorVerificationStatus; decidedAt?: Date }
  >;
  /** Appended, never replaced. The record of what was decided outlives what was seen. */
  verificationDecisions: VendorVerificationDecision[];
  /**
   * Requirements the vendor has declared do not apply to them, as
   * `${level}.${kind}` — vendor ticket 02, revisited.
   *
   * A sole trader in a country where they are below the registration threshold
   * has no tax reference, and a screen that waits for one waits for ever. The
   * declaration is theirs and it is recorded, so a reviewer sees "they said this
   * does not apply" rather than an empty slot that could equally mean they gave
   * up half way.
   *
   * A flat string array rather than a nested object: it is read as a set, it is
   * written by toggling one member, and the two things a nested shape would buy
   * — per-entry timestamps and typed keys — are already in the audit log and the
   * compiler respectively.
   */
  verificationWaivers?: string[];
  /**
   * This vendor's commission, overriding the platform default — vendor ticket 07.
   *
   * Set by **staff**, never by the vendor: every other field on their product is theirs
   * and this one is not, which is worth stating because it is the exception. Absent ⇒
   * the platform default.
   *
   * Changing it is a change of terms — notified, effective from a date, and never
   * retroactive. The snapshot on the order line is what makes "never retroactive" true
   * rather than promised.
   */
  commissionBasisPoints?: number;
  /**
   * What their customers rated them — vendor ticket 10.
   *
   * The weighted average across every published review of every product they sell, which is
   * what "weighted" means here: it is the mean of the *reviews*, not the mean of the
   * products' means, so a product with two hundred reviews counts two hundred times.
   *
   * Sum and count, never a stored average, for the same reason as on `Product` — and
   * **derived, never editable by anyone**, including staff. A vendor rating somebody can
   * adjust is a vendor rating nobody should believe.
   */
  ratingSum?: number;
  ratingCount?: number;
  /**
   * Where money goes — vendor ticket 09.
   *
   * The one thing only an `owner` may read or write, and the reason the two-role model
   * exists at all: a wrong price is reversible and audited; a wrong account number is
   * money in a stranger's hands.
   */
  payout?: {
    accountName?: string;
    /** Deliberately loose — IBANs, sort codes and NUBANs have nothing in common. */
    accountIdentifier?: string;
    bankName?: string;
    country?: string;
    updatedAt?: Date;
  };
  /**
   * When the relationship ended — vendor ticket 12.
   *
   * Distinct from `deletedAt`: the vendor row survives offboarding entirely, because customers
   * still hold entitlements to their products and a support conversation a year later has to
   * resolve who sold what. The ledger is closed, never deleted.
   */
  closedAt?: Date;
  deletedAt: Date | null;
}

const verificationDecisionSchema = new Schema<VendorVerificationDecision>(
  {
    level: { type: String, enum: VENDOR_VERIFICATION_LEVELS, required: true },
    outcome: { type: String, enum: ["approved", "rejected"], required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
    documentHashes: { type: [String], default: [] },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const vendorSchema = new Schema<VendorDoc>(
  {
    slug: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    accountType: { type: String, enum: VENDOR_ACCOUNT_TYPES },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    country: { type: String, required: true, uppercase: true, trim: true },
    status: {
      type: String,
      enum: VENDOR_STATUSES,
      required: true,
      default: "applied",
      index: true,
    },
    appliedAt: { type: Date, required: true },
    verifiedAt: { type: Date },
    suspendedAt: { type: Date },
    suspensionReason: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    pitch: { type: String, required: true, trim: true },
    agreement: {
      type: new Schema(
        {
          version: { type: String, required: true },
          acceptedAt: { type: Date, required: true },
          acceptedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        },
        { _id: false },
      ),
    },
    profile: {
      summary: { type: String, trim: true },
      websiteUrl: { type: String, trim: true },
      supportEmail: { type: String, lowercase: true, trim: true },
      logoUrl: { type: String, trim: true },
    },
    verification: {
      identity: {
        status: { type: String, enum: VENDOR_VERIFICATION_STATUSES, default: "unstarted" },
        decidedAt: { type: Date },
      },
      business: {
        status: { type: String, enum: VENDOR_VERIFICATION_STATUSES, default: "unstarted" },
        decidedAt: { type: Date },
      },
    },
    verificationWaivers: { type: [String], default: undefined },
    verificationDecisions: { type: [verificationDecisionSchema], default: [] },
    commissionBasisPoints: {
      type: Number,
      min: 0,
      max: 10_000,
      validate: (v: unknown) => v == null || Number.isInteger(v),
    },
    closedAt: Date,
    // Vendor ticket 10. Integers, recomputed from the reviews — see `recomputeVendorRating`.
    ratingSum: { type: Number, min: 0 },
    ratingCount: { type: Number, min: 0 },
    payout: {
      accountName: { type: String, trim: true },
      accountIdentifier: { type: String, trim: true },
      bankName: { type: String, trim: true },
      country: { type: String, uppercase: true, trim: true },
      updatedAt: Date,
    },
    // Inline rather than via `softDeletable()`: that helper returns
    // `T & SchemaDefinition`, and the intersection widens every enum literal in
    // the definition to `string`, which breaks `new Schema<VendorDoc>`. `Product`
    // declares its own for the same reason.
    deletedAt: { type: Date, default: null, index: true },
  },
  schemaOptions({ collection: "vendors" }),
);

vendorSchema.index({ slug: 1 }, { unique: true });
// The applications queue: oldest first, because a vendor waiting on a review has
// a product earning nothing.
vendorSchema.index({ status: 1, appliedAt: 1 });

export const Vendor = defineModel<VendorDoc>("Vendor", vendorSchema);

/* ────────────────────────────────────────────── VendorMember */

export interface VendorMemberDoc {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  userId: Types.ObjectId;
  role: VendorRole;
  status: MemberStatus;
  invitedByUserId?: Types.ObjectId;
  acceptedAt?: Date;
}

const vendorMemberSchema = new Schema<VendorMemberDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: VENDOR_ROLES, required: true, default: "member" },
    status: { type: String, enum: MEMBER_STATUSES, required: true, default: "active" },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    acceptedAt: { type: Date },
  },
  schemaOptions({ collection: "vendorMembers" }),
);

// One membership per person per vendor, mirroring `OrganizationMember`.
vendorMemberSchema.index({ vendorId: 1, userId: 1 }, { unique: true });

/**
 * One *active* vendor per user — the constraint that removes the switcher.
 *
 * Partial rather than plain, and the filter is what makes it survivable: a
 * `revoked` member may later join a different vendor, which a plain unique index
 * would refuse forever. Rows only exist once an invitation is accepted, so
 * `invited` never appears here (the pending state lives on `VendorInvitation`,
 * keyed by email, because an invitee may not have an account yet).
 */
vendorMemberSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

export const VendorMember = defineModel<VendorMemberDoc>("VendorMember", vendorMemberSchema);

/* ────────────────────────────────────────────── VendorInvitation */

/**
 * Ours, not Better Auth's.
 *
 * Better Auth owns `organizationInvitations` and its `acceptInvitation` API, and
 * both are org-scoped — a vendor is deliberately not an `Organization`, so that
 * flow cannot be reused as it stands. This mirrors its shape instead.
 *
 * The `_id` is the token, exactly as the org invitation's is: the accept link is
 * `/accept-invite?vendorInvite=<id>`, and the real check is that the invitation's
 * email matches the **verified** email on the session. An unguessable id plus an
 * identity check is what the existing flow relies on too; no HMAC is involved,
 * here or there.
 */
export interface VendorInvitationDoc {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  email: string;
  role: VendorRole;
  status: VendorInvitationStatus;
  invitedByUserId: Types.ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
}

const vendorInvitationSchema = new Schema<VendorInvitationDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: VENDOR_ROLES, required: true, default: "member" },
    status: {
      type: String,
      enum: VENDOR_INVITATION_STATUSES,
      required: true,
      default: "pending",
    },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  schemaOptions({ collection: "vendorInvitations" }),
);

vendorInvitationSchema.index({ vendorId: 1, status: 1 });
vendorInvitationSchema.index({ email: 1, status: 1 });

export const VendorInvitation = defineModel<VendorInvitationDoc>(
  "VendorInvitation",
  vendorInvitationSchema,
);

/* ────────────────────────────────────────────── VendorDocument */

/**
 * A verification document. The bytes live in the bucket; this is the handle.
 *
 * `purgedAt` records that the object *should* be gone. It is set when a
 * verification level is decided — but `s3:DeleteObject` is denied for the app's
 * credential today (ticket 05), so the delete is attempted, its failure is
 * tolerated, and this field marks the intent. It does not claim the object has
 * gone, because it may not have.
 */
export interface VendorDocumentDoc {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  level: VendorVerificationLevel;
  kind: VendorDocumentKind;
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  uploadedByUserId: Types.ObjectId;
  uploadedAt: Date;
  purgedAt?: Date;
}

const vendorDocumentSchema = new Schema<VendorDocumentDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    level: { type: String, enum: VENDOR_VERIFICATION_LEVELS, required: true },
    kind: { type: String, enum: VENDOR_DOCUMENT_KINDS, required: true },
    storageKey: { type: String, required: true },
    filename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, trim: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, required: true },
    purgedAt: { type: Date },
  },
  schemaOptions({ collection: "vendorDocuments" }),
);

// One document per object. A second row for the same key would let one upload be
// attached to two vendors.
vendorDocumentSchema.index({ storageKey: 1 }, { unique: true });

export const VendorDocument = defineModel<VendorDocumentDoc>(
  "VendorDocument",
  vendorDocumentSchema,
);
