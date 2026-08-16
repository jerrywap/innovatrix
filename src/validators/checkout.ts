import { z } from "zod";
import { optionalText } from "./common";

/**
 * Billing details — §13's step three.
 *
 * ## Why the country is required and almost nothing else is
 *
 * The country decides the tax rule, and a tax rule applied to the wrong country
 * is a compliance problem rather than a cosmetic one. Everything else on an
 * invoice can be corrected afterwards; the rate charged cannot.
 *
 * The rest is deliberately permissive. §13 says "resist adding steps", and a
 * checkout that rejects an address because a postcode does not match a regex is
 * a checkout that loses a sale to a format it had never seen. Addresses are
 * free text everywhere except the country.
 */
export const billingSchema = z.object({
  organizationName: z.string().trim().min(1, "Who is this for?").max(200),
  contactName: optionalText(120),
  email: z.email("That doesn't look like an email address."),
  line1: z.string().trim().min(1, "A street address is needed").max(200),
  line2: optionalText(200),
  city: z.string().trim().min(1, "A town or city is needed").max(120),
  region: optionalText(120),
  postcode: optionalText(40),
  country: z
    .string()
    .trim()
    .length(2, "Pick a country.")
    .transform((value) => value.toUpperCase()),
  taxId: optionalText(60),
});

export const placeOrderSchema = billingSchema.extend({
  /**
   * Sent by the form so a double submit is recognisable before the database is
   * touched. Optional: the service derives one from the cart's contents when
   * it is absent, so a client that omits it is still protected.
   */
  idempotencyKey: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{16,64}$/, "Malformed idempotency key.")
    .optional(),

  /**
   * `offline` means "I'll pay by transfer" — the order is created and nothing
   * is delivered until staff record the payment.
   *
   * Defaulted rather than required so an older client, or a form submitted
   * before this field existed, still checks out the way it always did.
   */
  paymentMethod: z.enum(["online", "offline"]).default("online"),
});

export type BillingInput = z.infer<typeof billingSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
