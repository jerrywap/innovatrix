import { Schema, type Types } from "mongoose";
import { defineModel } from "../client";
import { ORG_SCOPE_FIELD, schemaOptions } from "../base";
import {
  MEMBER_STATUSES,
  ORGANIZATION_ROLES,
  STAFF_ROLES,
  type MemberStatus,
  type OrganizationRole,
  type StaffRole,
} from "../enums";

/**
 * Identity & tenancy — §76 (organizations), §77 (staff roles).
 *
 * ## Better Auth shares these collections
 *
 * Better Auth writes `users`, `organizations`, `organizationMembers`,
 * `organizationInvitations`, `sessions`, `accounts` and `verifications` through
 * the **raw MongoDB driver**, not through Mongoose. Three consequences that the
 * schemas below are shaped around:
 *
 * 1. **Mongoose defaults never fire on documents Better Auth creates.** A field
 *    with `default: false` is simply *absent*, and MongoDB does not match a
 *    missing field against `false` — `{ isStaff: false }` would silently skip
 *    every user that signed up. Any field we filter on must therefore also be
 *    declared in Better Auth's `additionalFields` with the same default, so the
 *    value is written explicitly. See `src/lib/auth/auth.ts`.
 *
 * 2. **`required: true` is a trap** on anything Better Auth inserts, because a
 *    later `doc.save()` from our own code would throw on a document that was
 *    perfectly valid when written.
 *
 * 3. **Credentials live on `accounts.password`**, never on `users`. There is no
 *    password field in this file and there must not be one.
 *
 * Better Auth's adapter stores `_id` and every declared reference field as a
 * real `ObjectId`, so the two layers agree on identity. The one exception is
 * `sessions.activeOrganizationId`, which the organization plugin declares as a
 * plain string — hence `String` in the session schema below.
 */

/* ────────────────────────────────────────────── User */

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name?: string;
  image?: string;
  emailVerified: boolean;
  isStaff: boolean;
  locale: string;
  lastActiveAt?: Date;
  deletedAt: Date | null;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    image: String,
    emailVerified: { type: Boolean, default: false },
    // Cheap gate for "should this session even look at /staff". The real
    // authority is staffProfiles + the permission matrix (§77).
    isStaff: { type: Boolean, default: false, index: true },
    locale: { type: String, default: "en-GB" },
    lastActiveAt: Date,
    deletedAt: { type: Date, default: null },
  },
  schemaOptions({ collection: "users" }),
);

userSchema.index({ email: 1 }, { unique: true });

export const User = defineModel<UserDoc>("User", userSchema);

/* ────────────────────────────────────────────── Organization */

export interface OrganizationDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  billingEmail?: string;
  billingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postcode?: string;
    country?: string;
  };
  taxId?: string;
  defaultCurrency: string;
  /** True for the org auto-created at signup, so the UI can hide org chrome. */
  isPersonal: boolean;
  customerSince: Date;
  /** Better Auth stores organization metadata as a JSON *string*. */
  metadata?: string;
  logo?: string;
  deletedAt: Date | null;
}

const organizationSchema = new Schema<OrganizationDoc>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    billingEmail: { type: String, lowercase: true, trim: true },
    billingAddress: {
      line1: String,
      line2: String,
      city: String,
      region: String,
      postcode: String,
      country: { type: String, uppercase: true, trim: true },
    },
    taxId: String,
    defaultCurrency: { type: String, default: "GBP", uppercase: true },
    isPersonal: { type: Boolean, default: false },
    customerSince: { type: Date, default: () => new Date() },
    metadata: String,
    logo: String,
    deletedAt: { type: Date, default: null },
  },
  schemaOptions({ collection: "organizations" }),
);

organizationSchema.index({ slug: 1 }, { unique: true });

export const Organization = defineModel<OrganizationDoc>("Organization", organizationSchema);

/* ────────────────────────────────────────────── OrganizationMember */

/**
 * A membership is the only thing that grants access to an organization's data.
 * The invite flow itself lives in `organizationInvitations`, owned by Better
 * Auth — keeping invite columns here too would be two sources of truth for one
 * question ("has this person accepted?").
 */
export interface OrganizationMemberDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrganizationRole;
  status: MemberStatus;
}

const organizationMemberSchema = new Schema<OrganizationMemberDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ORGANIZATION_ROLES, required: true, default: "member" },
    // Not `required` — Better Auth's `addMember` inserts without it, and a
    // later save() of such a document would throw. The default is mirrored in
    // Better Auth's `additionalFields` so the value is written explicitly.
    status: { type: String, enum: MEMBER_STATUSES, default: "active" },
  },
  schemaOptions({ collection: "organizationMembers" }),
);

// One membership per person per org — a second row would silently double their
// permissions and make "remove access" only half work.
organizationMemberSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const OrganizationMember = defineModel<OrganizationMemberDoc>(
  "OrganizationMember",
  organizationMemberSchema,
);

/* ────────────────────────────────────────────── StaffProfile */

export interface StaffProfileDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  roles: StaffRole[];
  teams: string[];
  jobTitle?: string;
  isActive: boolean;
  deletedAt: Date | null;
}

const staffProfileSchema = new Schema<StaffProfileDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // §77: "Use permissions rather than one universal admin flag." Roles are a
    // set; effective permissions are their union (resolved in ticket 03).
    roles: { type: [String], enum: STAFF_ROLES, default: [] },
    teams: { type: [String], default: [] },
    jobTitle: String,
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null },
  },
  schemaOptions({ collection: "staffProfiles" }),
);

staffProfileSchema.index({ userId: 1 }, { unique: true });

export const StaffProfile = defineModel<StaffProfileDoc>("StaffProfile", staffProfileSchema);

/* ══════════════════════════════════════════════════════════════════════════
   Better Auth-owned collections

   Better Auth's MongoDB adapter **creates no indexes at all** — `unique: true`
   in its own schema is metadata used for validation, not a database
   constraint. Without the declarations below, `sessions.token` (looked up on
   every authenticated request) is a collection scan, and nothing stops two
   sessions sharing a token.

   These models exist for two reasons: to carry those index definitions into
   `npm run db:indexes`, and to let our repositories read the collections with
   the same types as everything else. Better Auth remains the only writer.
   ══════════════════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────── Session */

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * The organization this session is currently acting as (§76). Declared by
   * the organization plugin as a plain string, **not** a reference, so it is
   * stored as a hex string rather than an ObjectId. Typing it as ObjectId here
   * would make Mongoose throw a CastError on hydration.
   */
  activeOrganizationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    ipAddress: String,
    userAgent: String,
    activeOrganizationId: String,
  },
  schemaOptions({ collection: "sessions" }),
);

// The hot path: every authenticated request resolves a cookie to this row.
sessionSchema.index({ token: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
// Expired sessions are dead weight; Better Auth checks `expiresAt` itself, so
// this is housekeeping rather than a security control. `expireAfterSeconds: 0`
// means "delete when the date in the field passes".
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = defineModel<SessionDoc>("Session", sessionSchema);

/* ────────────────────────────────────────────── Account */

/**
 * Credentials and linked OAuth identities. `password` holds the scrypt hash for
 * `providerId: "credential"` — this is the only place a password hash exists.
 */
export interface AccountDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: string;
  accountId: string;
  password?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scope?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<AccountDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    providerId: { type: String, required: true },
    accountId: { type: String, required: true },
    // `select: false` so a stray `.find()` in application code cannot
    // accidentally carry a password hash into a response payload (§88).
    password: { type: String, select: false },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    idToken: { type: String, select: false },
    accessTokenExpiresAt: Date,
    refreshTokenExpiresAt: Date,
    scope: String,
  },
  schemaOptions({ collection: "accounts" }),
);

accountSchema.index({ userId: 1 });
// One row per (provider, external account) — a duplicate would let the same
// Google identity resolve to two users.
accountSchema.index({ providerId: 1, accountId: 1 }, { unique: true });

export const Account = defineModel<AccountDoc>("Account", accountSchema);

/* ────────────────────────────────────────────── Verification */

/**
 * Single-use tokens: email verification, password reset, invitation lookups.
 * Better Auth deletes a row when it is consumed, which is what makes reset
 * tokens single-use; the TTL index is the backstop for tokens never used.
 */
export interface VerificationDoc {
  _id: Types.ObjectId;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const verificationSchema = new Schema<VerificationDoc>(
  {
    identifier: { type: String, required: true },
    value: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
  },
  schemaOptions({ collection: "verifications" }),
);

verificationSchema.index({ identifier: 1 });
verificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Verification = defineModel<VerificationDoc>("Verification", verificationSchema);

/* ────────────────────────────────────────────── OrganizationInvitation */

export interface OrganizationInvitationDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "rejected" | "canceled";
  inviterId: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const organizationInvitationSchema = new Schema<OrganizationInvitationDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ORGANIZATION_ROLES, default: "member" },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "canceled"],
      default: "pending",
    },
    inviterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
  },
  schemaOptions({ collection: "organizationInvitations" }),
);

organizationInvitationSchema.index({ organizationId: 1, status: 1 });
// "What am I invited to?" — the accept-invite page's only query.
organizationInvitationSchema.index({ email: 1, status: 1 });

export const OrganizationInvitation = defineModel<OrganizationInvitationDoc>(
  "OrganizationInvitation",
  organizationInvitationSchema,
);
