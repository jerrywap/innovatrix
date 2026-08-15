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
 * Better Auth (ticket 03) owns the credential columns on `users`; this schema
 * carries the application-level profile only. The two coexist in the same
 * collection, which is why nothing here is `required` that Better Auth also
 * writes.
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
    deletedAt: { type: Date, default: null },
  },
  schemaOptions({ collection: "organizations" }),
);

organizationSchema.index({ slug: 1 }, { unique: true });

export const Organization = defineModel<OrganizationDoc>("Organization", organizationSchema);

/* ────────────────────────────────────────────── OrganizationMember */

export interface OrganizationMemberDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrganizationRole;
  status: MemberStatus;
  invitedEmail?: string;
  invitedByUserId?: Types.ObjectId;
  invitedAt?: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
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
    status: { type: String, enum: MEMBER_STATUSES, required: true, default: "invited" },
    invitedEmail: { type: String, lowercase: true, trim: true },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    invitedAt: Date,
    acceptedAt: Date,
    revokedAt: Date,
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
