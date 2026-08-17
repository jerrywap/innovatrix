import { z } from "zod";
import { objectIdSchema, optionalText } from "@/validators/common";

/**
 * Payout form schemas — vendor ticket 09.
 *
 * Neither `"use server"` nor `"server-only"`, so a client component validates against the
 * same module the action does and the two cannot disagree.
 *
 * Note what is **not** here: no amount, no vendor, no entry ids. A payout's figures come from
 * the ledger entries it claimed at draft time, and a form field for the amount would be a
 * request asking us how much to pay somebody.
 */

export const payoutIdSchema = z.object({ payoutId: objectIdSchema });

export const payoutCancelSchema = z.object({
  payoutId: objectIdSchema,
  reason: z.string().trim().min(1, "Say why — the vendor may ask.").max(500),
});

export const payoutFailSchema = z.object({
  payoutId: objectIdSchema,
  reason: z.string().trim().min(1, "What did the bank say?").max(500),
});

/**
 * Confirming a transfer.
 *
 * The bank reference is optional but strongly wanted: it is what makes a payout reconcilable
 * against a bank statement months later. The remittance advice is the second half of a
 * two-step upload — the key comes back from the browser and is checked against *this* payout
 * before anything is stored.
 */
export const payoutConfirmSchema = z.object({
  payoutId: objectIdSchema,
  externalReference: optionalText(120),
  storageKey: z.string().trim().max(1024).optional(),
  filename: z.string().trim().max(255).optional(),
  contentType: z.string().trim().max(120).optional(),
  sizeBytes: z.coerce.number().int().positive().optional(),
});

export const evidenceUploadRequestSchema = z.object({
  payoutId: objectIdSchema,
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
});
