import { z } from "zod";
import {
  AI_CONTEXT_TYPES,
  DEMO_EXPOSURES,
  INVOICE_STATUSES,
  LICENCE_TYPES,
  ORDER_STATUSES,
  ORGANIZATION_ROLES,
  PRODUCT_STATUSES,
  QUOTE_STATUSES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  REQUIREMENT_ORIGINS,
  STAFF_ROLES,
  TAXONOMY_KINDS,
} from "@/lib/db/enums";
import {
  moneySchema,
  objectIdSchema,
  optionalText,
  optionalUrl,
  paginationSchema,
  positiveMoneySchema,
  slugSchema,
} from "./common";

/**
 * Domain validators.
 *
 * Every enum here is `z.enum(THE_SAME_ARRAY)` the Mongoose schema uses. That is
 * the whole point of `lib/db/enums.ts`: the API surface and the database cannot
 * disagree about what a valid status is, because there is one array.
 */

/* ────────────────────────────────────────────── enum mirrors */

export const taxonomyKindSchema = z.enum(TAXONOMY_KINDS);
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const requestKindSchema = z.enum(REQUEST_KINDS);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);
export const staffRoleSchema = z.enum(STAFF_ROLES);
export const licenceTypeSchema = z.enum(LICENCE_TYPES);
export const requirementOriginSchema = z.enum(REQUIREMENT_ORIGINS);
export const aiContextTypeSchema = z.enum(AI_CONTEXT_TYPES);

/* ────────────────────────────────────────────── catalog */

export const taxonomyInputSchema = z.object({
  kind: taxonomyKindSchema,
  slug: slugSchema,
  name: z.string().trim().min(2).max(80),
  description: optionalText(500),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const priceInputSchema = z.object({
  currency: moneySchema.shape.currency,
  amount: z.number().int().nonnegative(),
  compareAtAmount: z.number().int().nonnegative().optional(),
});

export const licencePackageInputSchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalText(500),
  licenceType: licenceTypeSchema,
  activationLimit: z.number().int().min(1).default(1),
  supportMonths: z.number().int().min(0).default(12),
  updateMonths: z.number().int().min(0).default(12),
  prices: z.array(priceInputSchema).min(1, "A licence package needs at least one price"),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  summary: z.string().trim().min(10).max(300),
  description: optionalText(20_000),
  categoryIds: z.array(objectIdSchema).default([]),
  industryIds: z.array(objectIdSchema).default([]),
  technologyIds: z.array(objectIdSchema).default([]),
  features: z
    .array(z.object({ title: z.string().trim().min(1), detail: optionalText(500) }))
    .default([]),
  requirements: optionalText(4000),
  prices: z.array(priceInputSchema).default([]),
  licencePackages: z.array(licencePackageInputSchema).default([]),
  customization: z
    .object({
      available: z.boolean().default(true),
      aiWorkflowEnabled: z.boolean().default(true),
      technicalReviewRequired: z.boolean().default(true),
      startingPrice: positiveMoneySchema.optional(),
      typicalTurnaround: optionalText(120),
      suggestedAreas: z.array(z.string().trim().min(1)).default([]),
    })
    // Zod 4 distinction: `.default()` takes the *output* type, so `{}` is
    // rejected here because the parsed object has required fields. `.prefault()`
    // takes the *input* type — "omitted means run every inner default".
    .prefault({}),
  seo: z
    .object({
      title: optionalText(70),
      description: optionalText(160),
      ogImageUrl: optionalUrl(),
    })
    .prefault({}),
});

/**
 * §46 — publish is refused unless the product is actually complete. This runs
 * before the state machine, so the customer-facing error names what is missing
 * rather than saying "invalid transition".
 */
export const publishReadinessSchema = z.object({
  hasPrice: z.literal(true, { error: "Add at least one price before publishing" }),
  hasScreenshot: z.literal(true, { error: "Add at least one screenshot before publishing" }),
  hasReleasedVersion: z.literal(true, {
    error: "Release a version with a package file before publishing",
  }),
  testingComplete: z.literal(true, {
    error: "Complete the internal testing checklist before publishing",
  }),
});

export const demoConfigSchema = z.object({
  exposure: z.enum(DEMO_EXPOSURES),
  publicUrl: optionalUrl(),
  customerUrl: optionalUrl(),
  adminUrl: optionalUrl(),
  instructions: optionalText(2000),
  credentials: z
    .array(
      z.object({
        role: z.string().trim().min(1),
        label: optionalText(80),
        url: optionalUrl(),
        username: z.string().trim().min(1),
        // Plaintext only ever crosses the boundary inbound; it is encrypted
        // before it reaches the database (§89, ticket 07).
        password: z.string().min(1),
      }),
    )
    .default([]),
});

/* ────────────────────────────────────────────── commerce */

export const addToCartSchema = z.object({
  productId: objectIdSchema,
  licencePackageKey: z.string().trim().min(1),
  addonKeys: z.array(z.string().trim().min(1)).default([]),
  quantity: z.number().int().min(1).max(999).default(1),
});

/**
 * Note what is absent: no price, no total. The client states *what* it wants;
 * the server decides what it costs (§13, ticket 10). A price field here would
 * be a hole straight through the pricing rules.
 */
export const checkoutSchema = z.object({
  billing: z.object({
    organizationName: z.string().trim().min(1),
    contactName: z.string().trim().min(1),
    line1: z.string().trim().min(1),
    line2: optionalText(120),
    city: z.string().trim().min(1),
    region: optionalText(80),
    postcode: z.string().trim().min(1),
    country: z.string().trim().length(2).toUpperCase(),
    taxId: optionalText(40),
  }),
  /** Guards against a double-submit creating two orders (ticket 11). */
  idempotencyKey: z.uuid(),
});

/* ────────────────────────────────────────────── requirements & requests */

export const requirementSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1).max(200),
  detail: optionalText(2000),
  origin: requirementOriginSchema,
  acceptedByCustomer: z.boolean().default(false),
});

/**
 * The shape the AI must return (ticket 16). `confirmed` and `assumed` are
 * separate arrays at the schema level, so a model that blurs them fails
 * validation rather than quietly promoting a guess into a commitment (§17).
 */
export const extractedRequirementsSchema = z.object({
  businessType: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  confirmed: z.array(requirementSchema),
  assumed: z.array(requirementSchema),
  unresolved: z.array(z.string().trim().min(1)).default([]),
  suggestedIntegrations: z.array(z.string().trim().min(1)).default([]),
  deploymentNeeds: optionalText(500),
  timeline: optionalText(200),
});

export const submitRequestSchema = z.object({
  conversationId: objectIdSchema,
  title: z.string().trim().min(3).max(200),
  requirements: z.array(requirementSchema).min(1, "A request needs at least one requirement"),
  desiredTimeline: optionalText(200),
  budgetRange: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
      currency: moneySchema.shape.currency.optional(),
    })
    .optional(),
});

/* ────────────────────────────────────────────── quotes & invoices */

export const quoteItemInputSchema = z.object({
  kind: z.enum(["development", "service", "licence", "third_party"]),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).default(1),
  unitPrice: positiveMoneySchema,
});

export const quoteInputSchema = z
  .object({
    requestId: objectIdSchema,
    title: z.string().trim().min(3).max(200),
    scope: optionalText(5000),
    deliverables: z.array(z.string().trim().min(1)).default([]),
    exclusions: z.array(z.string().trim().min(1)).default([]),
    notes: optionalText(5000),
    items: z.array(quoteItemInputSchema).min(1, "A quote needs at least one line item"),
    currency: moneySchema.shape.currency,
    paymentTerms: z
      .enum(["full_upfront", "deposit_balance", "milestones"])
      .default("full_upfront"),
    depositBasisPoints: z.number().int().min(0).max(10_000).optional(),
    estimatedDurationDays: z.number().int().min(1).optional(),
    expiresAt: z.coerce.date(),
  })
  .refine((q) => q.paymentTerms !== "deposit_balance" || q.depositBasisPoints != null, {
    message: "Deposit terms need a deposit percentage",
    path: ["depositBasisPoints"],
  })
  .refine((q) => q.expiresAt.getTime() > Date.now(), {
    message: "Expiry must be in the future",
    path: ["expiresAt"],
  });

export const quoteDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("accept"), quoteId: objectIdSchema }),
  z.object({
    decision: z.literal("reject"),
    quoteId: objectIdSchema,
    reason: optionalText(1000),
  }),
]);

/* ────────────────────────────────────────────── communication */

export const postMessageSchema = z.object({
  conversationId: objectIdSchema,
  body: z.string().trim().min(1).max(10_000),
  // Staff-only. The customer-facing action never accepts this field at all,
  // so a customer cannot post an internal note by crafting a request (§37).
  visibility: z.enum(["customer", "internal"]).default("customer"),
});

/* ────────────────────────────────────────────── listing */

/**
 * A query-string boolean.
 *
 * **Not `z.coerce.boolean()`** — that is `Boolean(input)`, so every non-empty
 * string is `true` and `?customisable=false` means the opposite of what it
 * says:
 *
 * | input     | `z.coerce.boolean()` | `z.stringbool()` |
 * |-----------|----------------------|------------------|
 * | `"false"` | `true`               | `false`          |
 * | `"0"`     | `true`               | `false`          |
 *
 * `z.stringbool()` understands the strings a URL actually carries. Use it
 * anywhere a boolean arrives as text.
 */
export const queryBooleanSchema = z.stringbool();

export const marketplaceQuerySchema = paginationSchema.extend({
  q: optionalText(120),
  category: z.array(slugSchema).default([]),
  industry: z.array(slugSchema).default([]),
  technology: z.array(slugSchema).default([]),
  /** Single-valued: a product has one type, so "either type" is not a question. */
  productType: slugSchema.optional(),
  /** Integer minor units in the active currency — never a major-unit decimal. */
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  /** Free only — a bound on the active price, not a stored flag. */
  free: queryBooleanSchema.optional(),
  customisable: queryBooleanSchema.optional(),
  sort: z.enum(["relevance", "latest", "popular", "price_asc", "price_desc"]).default("latest"),
});

export const staffQueueQuerySchema = paginationSchema.extend({
  queue: z.enum([
    "new-custom-build",
    "new-customization",
    "waiting-for-us",
    "waiting-for-customer",
    "quotes-awaiting-response",
    "overdue-followups",
    "unassigned",
    "mine",
  ]),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type ExtractedRequirements = z.infer<typeof extractedRequirementsSchema>;
export type MarketplaceQuery = z.infer<typeof marketplaceQuerySchema>;
