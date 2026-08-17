import { z } from "zod";
import {
  VENDOR_DOCUMENT_KINDS,
  VENDOR_ROLES,
  VENDOR_VERIFICATION_LEVELS,
} from "@/lib/db/enums";
import { CURRENCY_CODES } from "@/lib/money";
import { emailSchema, objectIdSchema, optionalText } from "@/validators/common";

/**
 * Vendor form schemas — vendor tickets 01–03.
 *
 * Neither `"use server"` nor `"server-only"`, so a client component imports the
 * same module the action validates with and the two cannot disagree about what a
 * valid application is.
 *
 * Note what is **not** here: no `vendorId` on anything a vendor submits. Scope
 * comes from `requireVendor()`, from the session; a `vendorId` in a form body is
 * a claim, and `action-guards.test.ts` exists partly to keep that true.
 */

/** ISO 3166-1 alpha-2. A select, not free text, so the value is filterable. */
const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Choose a country");

export const vendorApplicationSchema = z.object({
  displayName: z.string().trim().min(2, "At least two characters").max(80),
  contactEmail: emailSchema,
  country: countrySchema,
  pitch: z
    .string()
    .trim()
    .min(40, "Tell us a little more — at least a couple of sentences")
    .max(2000),
  supportEmail: z.union([emailSchema, z.literal("")]).optional(),
  websiteUrl: z.union([z.url("Include https://"), z.literal("")]).optional(),
  /**
   * Acceptance is a checkbox and it is required. The version accepted is decided
   * server-side — a client that could name the version could accept an old one.
   */
  acceptAgreement: z.literal("on", {
    error: "You have to accept the vendor agreement to apply.",
  }),
});

export const vendorProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  contactEmail: emailSchema,
  summary: optionalText(600),
  supportEmail: z.union([emailSchema, z.literal("")]).optional(),
  websiteUrl: z.union([z.url("Include https://"), z.literal("")]).optional(),
});

/* ────────────────────────────────────────────── team */

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(VENDOR_ROLES),
});

export const memberIdSchema = z.object({ memberId: objectIdSchema });
export const invitationIdSchema = z.object({ invitationId: objectIdSchema });

/* ────────────────────────────────────────────── verification */

export const documentUploadRequestSchema = z.object({
  level: z.enum(VENDOR_VERIFICATION_LEVELS),
  kind: z.enum(VENDOR_DOCUMENT_KINDS),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
});

export const documentConfirmSchema = documentUploadRequestSchema.extend({
  storageKey: z.string().trim().min(1).max(1024),
  checksumSha256: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "Not a base64 SHA-256")
    .optional(),
});

/* ────────────────────────────────────────────── staff review */

export const reviewApplicationSchema = z.object({
  vendorId: objectIdSchema,
  decision: z.enum(["start_review", "verify", "reject"]),
  reason: optionalText(1000),
});

export const verificationDecisionSchema = z.object({
  vendorId: objectIdSchema,
  level: z.enum(VENDOR_VERIFICATION_LEVELS),
  outcome: z.enum(["approved", "rejected"]),
  note: optionalText(1000),
});

/* ────────────────────────────────────────────── money (tickets 07–08) */

/**
 * A percentage on screen, basis points in the database.
 *
 * Nobody types "3000" to mean 30%, and asking them to is how a rate ends up a hundred
 * times wrong. So the form takes a percentage with up to two decimals and this converts
 * — `Math.round` on a value already bounded to two places, which is exact for every
 * input the field accepts.
 */
export const commissionRateSchema = z.object({
  percent: z.coerce
    .number()
    .min(0, "A rate cannot be negative.")
    .max(100, "A rate cannot exceed 100%.")
    .refine((value) => Number.isFinite(value), "Not a number."),
});

export const platformCommissionSchema = commissionRateSchema;

/**
 * A vendor override, where **empty means "follow the platform"**.
 *
 * That is a different state from "set to the current default": cleared means a later
 * platform change carries this vendor with it, and the two must not be collapsed into one
 * field that cannot express the difference.
 */
export const vendorCommissionSchema = z.object({
  vendorId: objectIdSchema,
  percent: z
    .union([z.literal(""), z.coerce.number().min(0).max(100)])
    .transform((value) => (value === "" ? null : value)),
});

export const ledgerAdjustmentSchema = z.object({
  vendorId: objectIdSchema,
  currency: z.enum(CURRENCY_CODES),
  /**
   * A decimal amount, signed. Negative is a deduction — a chargeback fee, a correction
   * against the vendor — and the form says so, because a finance user who has to enter a
   * deduction as a positive number in a field labelled "credit" will eventually enter the
   * wrong sign.
   */
  amount: z.coerce
    .number()
    .refine((value) => value !== 0, "An adjustment of zero changes nothing."),
  note: z.string().trim().min(1, "Say why. Somebody will read this a year from now.").max(500),
});

/* ────────────────────────────────────────────── payout account (ticket 09) */

/**
 * Where money goes.
 *
 * `accountIdentifier` is deliberately loose — an IBAN, a sort code and account number, and a
 * Nigerian NUBAN have nothing in common but being a string, and a regex that fits three
 * countries rejects the fourth. The real check is business verification, which a person
 * performs against a bank document; a format assertion here would only tell a vendor with an
 * unusual bank that their own account number is invalid.
 *
 * Length bounds and a character class, though: an account field is not free text, and this
 * one is rendered on a statement.
 */
export const payoutAccountSchema = z.object({
  accountName: z.string().trim().min(2, "The name on the account.").max(120),
  accountIdentifier: z
    .string()
    .trim()
    .min(4, "Too short to be an account number.")
    .max(64)
    .regex(/^[A-Za-z0-9 -]+$/, "Letters, numbers, spaces and hyphens only."),
  bankName: z.string().trim().min(2, "Which bank?").max(120),
  country: z
    .string()
    .trim()
    .length(2, "A two-letter country code.")
    .regex(/^[A-Za-z]{2}$/, "A two-letter country code."),
});

export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
