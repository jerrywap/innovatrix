import { z } from "zod";
import {
  ADDON_PRICING_TYPES,
  CUSTOMIZATION_AREAS,
  DEMO_EXPOSURES,
  LICENCE_TYPES,
  PRODUCT_CATALOGUES,
  PRODUCT_MEDIA_KINDS,
} from "@/lib/db/enums";
import { richTextFromForm } from "@/lib/rich-text/schema";
import {
  checkboxSchema,
  countFromForm,
  objectIdSchema,
  optionalId,
  optionalText,
  optionalUrl,
  priceMapSchema,
  slugSchema,
  youTubeId,
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

/**
 * Just the description — `saveDescriptionOnlyAction`'s input.
 *
 * A separate schema rather than `productBasicsSchema.pick(...)` because that
 * action posts no `name` or `summary`, and a picked schema would still demand
 * them.
 */
export const descriptionOnlySchema = z.object({ description: richTextFromForm });

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
   *
   * `richTextFromForm`, **not** `richTextDocumentSchema.optional()`. The editor
   * posts the tree as JSON text, so the bare object schema rejected every save
   * from this step with "expected object, received string". The decode belongs
   * here rather than in each action — see the docblock on the schema for the four
   * private copies this replaced and the silent-wipe hazard in all of them.
   */
  description: richTextFromForm,
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
  /**
   * Blank is a legitimate answer, and it is also how a type already set gets
   * cleared — `saveClassification` routes an absent value to `$unset`. It was
   * `objectIdSchema.optional()`, which refused the `""` a `<select>` submits with
   * "Not a valid id", making an "(optional)" field mandatory once rendered.
   */
  productTypeId: optionalId(),
  /**
   * Which of `categoryIds` is the primary. `optionalId()` because the form omits
   * the field entirely when there is nothing to choose.
   */
  primaryCategoryId: optionalId(),
});

/**
 * The primary is always a member of `categoryIds`, and this is where that is made
 * true rather than hoped for.
 *
 * Three cases, and each has a real caller. **Nothing chosen** clears it — the
 * server `$unset`s it, so a product stripped of its categories does not keep a
 * dangling pointer. **A primary that is not among the categories** falls back
 * rather than being rejected: it is what a stale form or a hand-posted body
 * produces, and the first category is a correct answer, where a validation error
 * would be a dead end the person cannot act on. **Nothing submitted** takes the
 * same fallback, which is the ordinary path — the form deliberately omits the
 * field when only one category is selected.
 *
 * Applied here rather than in the form because this is what the server trusts. A
 * client can post anything, and two places deciding is how they come to disagree.
 */
export const classificationWithPrimary = productClassificationSchema.transform((value) => ({
  ...value,
  primaryCategoryId:
    value.categoryIds.length === 0
      ? undefined
      : value.primaryCategoryId && value.categoryIds.includes(value.primaryCategoryId)
        ? value.primaryCategoryId
        : value.categoryIds[0],
}));

/**
 * Also listing the front-end as a website template.
 *
 * `confirm` is a real field rather than inferred from the price map, so an empty
 * form submitted by accident is a validation error rather than a product. The
 * refinement is what turns the checkbox from decoration into a gate.
 */
export const templateSiblingSchema = z
  .object({
    confirm: checkboxSchema,
    prices: priceMapSchema,
  })
  .refine((value) => value.confirm, {
    path: ["confirm"],
    error: "Tick the box to create the website template listing.",
  })
  .refine((value) => value.prices.length > 0, {
    path: ["prices"],
    error: "Give the template listing a price in at least one currency.",
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
        url: optionalUrl(),
        /** Required for a screenshot: an unlabelled image fails AA. */
        alt: optionalText(200),
        sortOrder: countFromForm(0, { max: 999 }),
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
    })
    /*
     * A video row with no `storageKey` is a link, and the only link we can play is
     * YouTube.
     *
     * Checked here rather than by making `url` a YouTube schema, because the same
     * field carries three different things: an uploaded screenshot's public URL, an
     * uploaded video's public URL, and a watch link. Only the third is constrained,
     * and which one it is depends on the sibling fields — which is exactly what a
     * refine can see and a field-level schema cannot.
     *
     * This is what decides an `<iframe src>`, so it is not cosmetic. `youTubeId`
     * refuses a lookalike host and anything that is not eleven base64url
     * characters.
     */
    .refine(
      (items) =>
        items.every(
          (m) => m.kind !== "video" || m.storageKey || (m.url && youTubeId(m.url) !== null),
        ),
      {
        message:
          "A video is either an uploaded file or a YouTube link — paste the address bar's URL, or the one the Share button gives you.",
      },
    ),
});

/* ────────────────────────────────────────────── 5. pricing */

export const licencePackageFormSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: optionalText(400),
  licenceType: z.enum(LICENCE_TYPES),
  /*
   * `countFromForm`, not `z.coerce.number()`: a blank Activations field reported
   * "Too small: expected >=1" because `Number("")` is 0, and blank support and
   * update periods silently became **zero months** rather than the 12 the
   * placeholder shows. Each keeps the default it always advertised.
   */
  activationLimit: countFromForm(1, { min: 1, max: 10_000 }),
  supportMonths: countFromForm(12, { max: 120 }),
  updateMonths: countFromForm(12, { max: 120 }),
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
    /*
     * No `prices` here. The advertised price is derived from the packages by
     * `advertisedPrices` in `section-config.ts`, so there is nothing for the form
     * to post and nothing for this schema to accept — which is what stops the two
     * stores drifting apart again.
     */
    licencePackages: z
      .array(licencePackageFormSchema)
      .min(1, "A product needs at least one licence package — it is what a customer buys.")
      .max(12),
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
      ogImageUrl: optionalUrl(),
    })
    .prefault({}),
});

/* ────────────────────────────────────────────── 8. demo (ticket 07) */

export const demoCredentialFormSchema = z.object({
  role: z.string().trim().min(1, "Name the role, e.g. Administrator").max(60),
  label: optionalText(80),
  url: optionalUrl(),
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
    /*
     * "Anyone", which is what `public` is labelled in the form.
     *
     * A demo exists to be tried. Defaulting it to `authenticated` meant the
     * common case — a public showcase — required the vendor to notice a radio
     * group and change it, and the visitor it was built for hit a sign-in wall.
     */
    exposure: z.enum(DEMO_EXPOSURES).default("public"),
    publicUrl: optionalUrl(),
    customerUrl: optionalUrl(),
    adminUrl: optionalUrl(),
    instructions: optionalText(2000),
    credentials: z
      .array(demoCredentialFormSchema)
      .max(10)
      .default([])
      .refine((rows) => new Set(rows.map((r) => r.role.toLowerCase())).size === rows.length, {
        message: "Each role can only appear once — it is how a row is matched on save.",
      }),
  }),
});
