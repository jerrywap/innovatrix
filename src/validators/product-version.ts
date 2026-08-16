import { z } from "zod";
import { PRODUCT_FILE_KINDS } from "@/lib/db/enums";
import { isSemver } from "@/lib/semver";
import { checkboxSchema, objectIdSchema, optionalText } from "./common";

/**
 * Versions and their files — ticket 07, §44–45.
 *
 * The version string is the interesting one. It is the identity of a release
 * and it is what `compareSemver` orders `currentVersionId` by, so anything that
 * does not parse is rejected here rather than being stored and silently sorting
 * to the bottom of the list forever.
 */

export const versionStringSchema = z
  .string()
  .trim()
  .min(1, "A version number is required")
  .max(40)
  .refine(isSemver, {
    message: "Use major.minor.patch — for example 2.4.0, or 2.4.0-rc.1 for a prerelease.",
  });

export const updateEligibilitySchema = z.object({
  /** A 2.x owner gets 3.0 without paying again. */
  includesPriorMajor: checkboxSchema,
  freeFromVersion: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || isSemver(value), {
      message: "That has to be a version number, or empty.",
    }),
  note: optionalText(300),
});

export const versionFormSchema = z.object({
  productId: objectIdSchema,
  version: versionStringSchema,
  changelog: optionalText(300),
  minimumRequirements: optionalText(2000),
  /**
   * A date, not a datetime. Release dates are announced, and a timezone-bearing
   * instant renders as the previous day for half the world.
   */
  releaseDate: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), {
      message: "That is not a date.",
    }),
  updateEligibility: updateEligibilitySchema.optional(),
});

/**
 * Editing a released version.
 *
 * §45: "version history is immutable once released — edit release notes, never
 * the artefacts." So this schema does not *have* the fields that would change
 * what a customer downloads. The restriction is the shape of the input, not a
 * conditional inside the service, which means there is no branch to forget.
 */
export const releasedVersionEditSchema = z.object({
  productId: objectIdSchema,
  versionId: objectIdSchema,
  changelog: optionalText(300),
  updateEligibility: updateEligibilitySchema.optional(),
});

/* ────────────────────────────────────────────── files */

/**
 * Step one of the upload: the browser says what it is about to send, and gets
 * a presigned URL back. Everything here is **untrusted** — the size and type
 * are what the client *claims*. They end up inside the signature, which is what
 * turns a claim into a constraint S3 enforces, and `verifyUpload` re-checks the
 * object afterwards.
 */
export const uploadTicketRequestSchema = z.object({
  productId: objectIdSchema,
  versionId: objectIdSchema,
  kind: z.enum(PRODUCT_FILE_KINDS),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().positive(),
  /** base64(sha256). Absent for a large file hashed later — see §44. */
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "That is not a base64 SHA-256 digest.")
    .optional(),
});

/** Step two: the bytes are up, record the file. */
export const confirmUploadSchema = z.object({
  productId: objectIdSchema,
  versionId: objectIdSchema,
  kind: z.enum(PRODUCT_FILE_KINDS),
  storageKey: z.string().trim().min(1).max(1024),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().positive(),
  checksumSha256: optionalText(120),
});

export type VersionFormInput = z.infer<typeof versionFormSchema>;
export type ReleasedVersionEditInput = z.infer<typeof releasedVersionEditSchema>;
export type UploadTicketRequest = z.infer<typeof uploadTicketRequestSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
