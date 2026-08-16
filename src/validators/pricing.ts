import { z } from "zod";
import { DISCOUNT_KINDS, TAX_RULE_KINDS } from "@/lib/db/enums";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { objectIdSchema, optionalText } from "./common";

/**
 * Discount and tax admin input — ticket 10.
 *
 * ## Amounts come in as major units and are converted once
 *
 * An administrator types `50` meaning £50, not 5000p. The transform to minor
 * units happens **here**, through `fromDecimal` at the service boundary, so
 * there is one conversion rather than one per form. A `× 100` in a component
 * is how a promotion goes out at a hundredth of its intended value.
 */

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), {
    message: "That is not a date.",
  });

const optionalPositiveInt = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? Number.parseInt(value, 10) : undefined))
  .refine((value) => value === undefined || (Number.isInteger(value) && value > 0), {
    message: "Enter a whole number greater than zero.",
  });

export const discountFormSchema = z
  .object({
    id: objectIdSchema.optional(),
    code: z
      .string()
      .trim()
      .min(3, "A code needs at least three characters")
      .max(40)
      .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and hyphens only.")
      .transform((value) => value.toUpperCase()),
    description: optionalText(300),
    kind: z.enum(DISCOUNT_KINDS),
    /**
     * Major units for `fixed` (`50` = £50), whole percent for `percentage`
     * (`15` = 15%). The service converts both to the stored representation.
     */
    value: z
      .string()
      .trim()
      .min(1, "How much comes off?")
      .refine((value) => !Number.isNaN(Number(value.replace(/,/g, ""))), {
        message: "That is not a number.",
      }),
    currency: z.enum(STOREFRONT_CURRENCIES).optional(),
    minSpend: optionalText(20),
    usageLimit: optionalPositiveInt,
    perCustomerLimit: optionalPositiveInt,
    startsAt: optionalDate,
    expiresAt: optionalDate,
    categorySlugs: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        (value === undefined ? [] : Array.isArray(value) ? value : [value])
          .flatMap((entry) => entry.split(","))
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .refine((input) => input.kind !== "fixed" || Boolean(input.currency), {
    // A fixed discount without a currency is £50 or ₦50 depending on who is
    // looking, which is not a discount, it is a lottery.
    message: "A fixed discount needs a currency.",
    path: ["currency"],
  })
  .refine(
    (input) => input.kind !== "percentage" || Number(input.value.replace(/,/g, "")) <= 100,
    { message: "A percentage cannot exceed 100.", path: ["value"] },
  )
  .refine(
    (input) =>
      !input.startsAt ||
      !input.expiresAt ||
      Date.parse(input.startsAt) < Date.parse(input.expiresAt),
    { message: "The end date must be after the start date.", path: ["expiresAt"] },
  );

export const taxRuleFormSchema = z.object({
  id: objectIdSchema.optional(),
  ruleId: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens — it goes on every order.")
    .transform((value) => value.toLowerCase()),
  label: z.string().trim().min(1, "Name it for whoever reconciles it").max(120),
  country: z
    .string()
    .trim()
    .min(1)
    .max(2)
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "*" || value.length === 2, {
      message: "A two-letter country code, or * for the catch-all.",
    }),
  kind: z.enum(TAX_RULE_KINDS),
  /** Whole percent — `20` means 20%. Stored as 2000 basis points. */
  percent: z
    .string()
    .trim()
    .min(1, "What rate?")
    .refine(
      (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
      },
      { message: "A rate between 0 and 100." },
    ),
  priority: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number.parseInt(value, 10) : 0))
    .refine((value) => Number.isInteger(value), { message: "A whole number." }),
});

export type DiscountFormInput = z.infer<typeof discountFormSchema>;
export type TaxRuleFormInput = z.infer<typeof taxRuleFormSchema>;
