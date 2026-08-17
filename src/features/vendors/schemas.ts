import { z } from "zod";
import {
  VENDOR_DOCUMENT_KINDS,
  VENDOR_ROLES,
  VENDOR_VERIFICATION_LEVELS,
} from "@/lib/db/enums";
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

export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
