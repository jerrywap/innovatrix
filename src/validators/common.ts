import { z } from "zod";
import { CURRENCIES } from "@/lib/money";
import { REFERENCE_PREFIXES } from "@/lib/references";

/**
 * Shared Zod primitives.
 *
 * These import the *same* constants the Mongoose schemas use, so a currency or
 * a reference prefix added in one place is immediately valid in the other.
 * There is no second list to keep in sync.
 */

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

export const currencySchema = z.enum(
  Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...(keyof typeof CURRENCIES)[]],
);

/** Money on the wire is always minor units — never a decimal (§84). */
export const moneySchema = z.object({
  amount: z.number().int("Money must be an integer in minor units"),
  currency: currencySchema,
});

export const positiveMoneySchema = moneySchema.extend({
  amount: z.number().int().positive(),
});

export const referenceSchema = z
  .string()
  .regex(
    new RegExp(`^(${Object.keys(REFERENCE_PREFIXES).join("|")})-\\d{4}-\\d{4,}$`),
    "Not a valid business reference",
  );

export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

/**
 * Pagination. Mirrors the repository's clamp (ticket 01) so an over-large
 * `limit` is rejected at the boundary rather than silently reduced later —
 * the caller finds out they asked for too much.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

/** Trims, and turns "" into undefined so empty form fields don't become empty strings. */
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const emailSchema = z.email().toLowerCase().trim();
