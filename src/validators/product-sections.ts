import { z } from "zod";
import {
  ADDON_PRICING_TYPES,
  CUSTOMIZATION_AREAS,
  DEMO_EXPOSURES,
  LICENCE_TYPES,
  PRODUCT_CATALOGUES,
  PRODUCT_MEDIA_KINDS,
  TESTING_CHECKLIST_STATUSES,
} from "@/lib/db/enums";
import { richTextDocumentSchema } from "@/lib/rich-text/schema";
import {
  checkboxSchema,
  objectIdSchema,
  optionalText,
  priceMapSchema,
  slugSchema,
} from "./common";

/**
 * The product form, one section at a time.
 *
 * The wizard saves per step, so each step needs a schema of exactly its own
 * fields — a whole-product schema would either reject a half-filled draft or
 * demand the client round-trip fields it never showed. Both are how a
 * "save and continue" flow loses data.
 *
 * Every schema here is **form-facing**: values arrive as strings from
 * `FormData`, so amounts are decimals, booleans are `"on"`, and ids are hex
 * strings. `src/validators/domain.ts` keeps the API-facing shapes where money
 * is already minor units.
 *
 * A section is only allowed to write its own paths. That is what makes step 6
 * unable to clobber step 5 (see `ProductService.saveSection`).
 */

/* ────────────────────────────────────────────── shared */

/** An HTML checkbox submits `"on"` when ticked and nothing at all when not. */
/** A `<select>` of ids, or a checkbox group — both arrive as an array of strings. */
const idListSchema = z
  .union([objectIdSchema, z.array(objectIdSchema)])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .pipe(z.array(objectIdSchema).max(20));

/* ────────────────────────────────────────────── 1. basics */

export const productBasicsSchema = z.object({
  name: z.string().trim().min(2, "Give the product a name").max(120),
  summary: z
    .string()
    .trim()
    .min(10, "Write a one-line summary — it appears on every marketplace card")
    .max(300),
  /**
   * Optional at creation. A draft is allowed to be incomplete; publish is what
   * demands completeness, and it says so specifically (see `readiness.ts`).
   */
  description: richTextDocumentSchema.optional(),
});

/**
 * Renaming a product does not rename its URL.
 *
 * The slug is deliberately its own action rather than a field on the basics
 * form: changing it retires the old one into `slugHistory`, which is a
 * different kind of event from fixing a typo in a name, and it should feel
 * like one.
 */
export const productSlugSchema = z.object({ slug: slugSchema });

/* ────────────────────────────────────────────── 2. classification */

export const productClassificationSchema = z.object({
  /**
   * Which catalogue this belongs to. Defaults to `script`, matching the schema,
   * so a form rendered before this field existed still saves.
   */
  catalogue: z.enum(PRODUCT_CATALOGUES).default("script"),
  categoryIds: idListSchema,
  industryIds: idListSchema,
  technologyIds: idListSchema,
  productTypeId: objectIdSchema.optional(),
});

/* ────────────────────────────────────────────── 3. content */

export const productContentSchema = z.object({
  features: z
    .array(
      z.object({
        title: z.string().trim().min(1, "A feature needs a title").max(120),
        detail: optionalText(500),
      }),
    )
    .max(60)
    .default([]),
  requirements: optionalText(4000),
});

/* ────────────────────────────────────────────── 4. media */

export const productMediaSchema = z.object({
  media: z
    .array(
      z.object({
        kind: z.enum(PRODUCT_MEDIA_KINDS),
        storageKey: optionalText(400),
        url: z.url().optional(),
        /** Required for a screenshot: an unlabelled image fails AA. */
        alt: optionalText(200),
        sortOrder: z.coerce.number().int().min(0).default(0),
        isPrimary: checkboxSchema,
      }),
    )
    .max(24)
    .default([])
    .refine((items) => items.filter((m) => m.isPrimary).length <= 1, {
      message: "Only one image can be the primary one.",
    })
    .refine((items) => items.every((m) => m.storageKey ?? m.url), {
      message: "Every image needs either an uploaded file or a URL.",
    }),
});

/* ────────────────────────────────────────────── 5. pricing */

export const licencePackageFormSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: optionalText(400),
  licenceType: z.enum(LICENCE_TYPES),
  activationLimit: z.coerce.number().int().min(1).max(10_000).default(1),
  supportMonths: z.coerce.number().int().min(0).max(120).default(12),
  updateMonths: z.coerce.number().int().min(0).max(120).default(12),
  prices: priceMapSchema,
});

export const addonFormSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: optionalText(400),
  pricingType: z.enum(ADDON_PRICING_TYPES).default("fixed"),
  prices: priceMapSchema,
});

export const productPricingSchema = z
  .object({
    prices: priceMapSchema,
    licencePackages: z.array(licencePackageFormSchema).max(12).default([]),
    addons: z.array(addonFormSchema).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    // A duplicate key silently overwrites the earlier package when the cart
    // looks one up by key (§13's `addToCartSchema` keys on exactly this).
    for (const [field, rows] of [
      ["licencePackages", value.licencePackages],
      ["addons", value.addons],
    ] as const) {
      const keys = rows.map((row) => row.key);
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Two entries share the same key. Keys must be unique.",
        });
      }
    }

    // `quote_required` means there is no number to show; a price alongside it
    // would be displayed and then contradicted by the quote.
    for (const [index, addon] of value.addons.entries()) {
      if (addon.pricingType === "quote_required" && addon.prices.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["addons", index, "prices"],
          message: "A quote-required add-on cannot carry a price.",
        });
      }
    }
  });

/* ────────────────────────────────────────────── 6. options */

export const productOptionsSchema = z.object({
  installation: z
    .object({
      selfInstall: checkboxSchema,
      innovatrixInstall: checkboxSchema,
      managedHosting: checkboxSchema,
    })
    .prefault({}),
  customization: z
    .object({
      available: checkboxSchema,
      aiWorkflowEnabled: checkboxSchema,
      technicalReviewRequired: checkboxSchema,
      /** Optional: "from £X" is a hint, and not every product has one. */
      startingPriceAmount: optionalText(20),
      startingPriceCurrency: optionalText(3),
      typicalTurnaround: optionalText(120),
      /**
       * §50 — an enum, not free text. Ticket 17's assistant reads these to open
       * the conversation, so prose would make that a parsing problem.
       */
      suggestedAreas: z
        .union([z.enum(CUSTOMIZATION_AREAS), z.array(z.enum(CUSTOMIZATION_AREAS))])
        .optional()
        .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
    })
    .prefault({}),
});

/* ────────────────────────────────────────────── 7. SEO */

export const productSeoSchema = z.object({
  seo: z
    .object({
      title: optionalText(70),
      description: optionalText(160),
      ogImageUrl: z.url().optional(),
    })
    .prefault({}),
});

/* ────────────────────────────────────────────── 8. demo (ticket 07) */

export const demoCredentialFormSchema = z.object({
  role: z.string().trim().min(1, "Name the role, e.g. Administrator").max(60),
  label: optionalText(80),
  url: z.url().optional(),
  username: optionalText(160),
  /**
   * Plaintext inbound, sealed before it reaches Mongo.
   *
   * **Optional on purpose.** The edit form never pre-fills a password, so an
   * empty field means "keep the one already stored" rather than "clear it".
   * Requiring it would silently wipe every other credential each time one row
   * was edited.
   */
  password: optionalText(200),
});

export const productDemoSchema = z.object({
  demo: z.object({
    exposure: z.enum(DEMO_EXPOSURES).default("authenticated"),
    publicUrl: z.url().optional(),
    customerUrl: z.url().optional(),
    adminUrl: z.url().optional(),
    instructions: optionalText(2000),
    resetSchedule: optionalText(200),
    credentials: z
      .array(demoCredentialFormSchema)
      .max(10)
      .default([])
      .refine((rows) => new Set(rows.map((r) => r.role.toLowerCase())).size === rows.length, {
        message: "Each role can only appear once — it is how a row is matched on save.",
      }),
  }),
});

/* ────────────────────────────────────────────── 9. testing (ticket 07) */

export const productTestingSchema = z.object({
  testingChecklist: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(120),
        status: z.enum(TESTING_CHECKLIST_STATUSES).default("pending"),
        notes: optionalText(500),
      }),
    )
    .max(40)
    .default([]),
});

/* ────────────────────────────────────────────── types */

export type ProductBasicsInput = z.infer<typeof productBasicsSchema>;
export type ProductClassificationInput = z.infer<typeof productClassificationSchema>;
export type ProductContentInput = z.infer<typeof productContentSchema>;
export type ProductMediaInput = z.infer<typeof productMediaSchema>;
export type ProductPricingInput = z.infer<typeof productPricingSchema>;
export type ProductOptionsInput = z.infer<typeof productOptionsSchema>;
export type ProductSeoInput = z.infer<typeof productSeoSchema>;
export type ProductDemoInput = z.infer<typeof productDemoSchema>;
export type ProductTestingInput = z.infer<typeof productTestingSchema>;
