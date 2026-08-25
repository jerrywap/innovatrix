import type { z } from "zod";
import type { Permission } from "@/lib/auth/permissions";
import { descriptionFields } from "@/lib/db/models/catalog";
import { advertisedPrices } from "@/services/catalog/advertised-price";
import {
  productBasicsSchema,
  productContentSchema,
  productMediaSchema,
  productOptionsSchema,
  productPricingSchema,
  productSeoSchema,
} from "@/validators/product-sections";

/**
 * What each wizard section validates and what it writes.
 *
 * Extracted from `actions.ts` when vendor ticket 04 gave the wizard a **second
 * surface**: staff at `/admin/products/[id]` and a vendor at
 * `/dashboard/selling/products/[id]`. Both save the same fields of the same
 * document, so the mapping has to be one thing.
 *
 * The alternative — a copy of each `toUpdate` in the vendor action file — is the
 * kind of duplication that goes wrong silently: a field added to a section would be
 * saved on one surface and dropped on the other, and the form would look correct
 * on both. Nothing would error; a vendor's price would just not be there.
 *
 * Pure data and pure functions, no `"use server"`, so both action files can import
 * it and so it is testable without a request.
 *
 * Sections **not** here are the ones that are not a plain field write:
 * `classification` re-derives facets, `demo` seals credentials, `testing` runs the
 * checklist service, and `review` transitions. Each is written out at its call site
 * in the surface that owns it.
 */

export interface SectionConfig<S extends z.ZodType = z.ZodType> {
  section: string;
  /**
   * The permission a **staff** save needs. A vendor save is authorised by
   * ownership instead — `requireVendorOrForbid()` plus a scoped write — so this is
   * unused on that surface, which is why it stays a plain field rather than
   * becoming part of a guard the factory calls.
   */
  permission: Permission;
  schema: S;
  toUpdate: (input: z.infer<S>) => Record<string, unknown>;
}

export const BASICS_SECTION: SectionConfig<typeof productBasicsSchema> = {
  section: "basics",
  permission: "product.update",
  schema: productBasicsSchema,
  toUpdate: (input) => ({
    name: input.name,
    summary: input.summary,
    // Both description fields, or neither — see `descriptionFields`.
    ...descriptionFields(input.description),
    /*
     * Saving Basics is the act of having read it.
     *
     * A template sibling arrives with the script's description copied and
     * `descriptionInherited: true`, which keeps `no_description`'s cousin firing so
     * the prose cannot be published unread. This is the only place that clears it,
     * and it clears on *any* Basics save — including one that changed nothing,
     * which is the correct reading of "I have looked at this and it is fine".
     *
     * `undefined`, so `setAndUnset` turns it into an `$unset` rather than storing
     * `false`. A product that never inherited anything should not carry the field
     * at all.
     */
    descriptionInherited: undefined,
  }),
};

export const CONTENT_SECTION: SectionConfig<typeof productContentSchema> = {
  section: "content",
  permission: "product.update",
  schema: productContentSchema,
  toUpdate: (input) => ({
    features: input.features,
    requirements: input.requirements,
  }),
};

export const MEDIA_SECTION: SectionConfig<typeof productMediaSchema> = {
  section: "media",
  permission: "product.update",
  schema: productMediaSchema,
  toUpdate: (input) => ({ media: input.media }),
};

export const PRICING_SECTION: SectionConfig<typeof productPricingSchema> = {
  section: "pricing",
  // §77 gives this to `sales` and `finance` and withholds it from
  // `content_manager`, who can edit copy but not what anything costs.
  //
  // A **vendor** sets their own price (decision V9) — the review gate covers it —
  // so on that surface there is no equivalent split. Splitting it there was
  // considered and dropped with the four-role model: the two capabilities worth
  // separating for a vendor are the price and the payout account, and only the
  // second can lose somebody money.
  permission: "product.manage_pricing",
  schema: productPricingSchema,
  toUpdate: (input) => ({
    /*
     * `prices` is **derived**, never posted.
     *
     * There were two independent price stores and nothing reconciled them:
     * `readiness.ts` says it outright — "the marketplace advertises from
     * `product.prices`; the cart charges from `licencePackages[].prices`" — and the
     * package always won, because `product.prices` never became money. No cart
     * line, no order line, no payment read it.
     *
     * Asking a vendor for the same number twice is how a listing comes to
     * advertise £299 while the basket refuses. Deriving one from the other removes
     * the disagreement instead of policing it, which is what retired the
     * `unbuyable_currency` publish gate.
     */
    prices: advertisedPrices(input.licencePackages),
    licencePackages: input.licencePackages,
    addons: input.addons,
  }),
};

export const OPTIONS_SECTION: SectionConfig<typeof productOptionsSchema> = {
  section: "options",
  permission: "product.update",
  schema: productOptionsSchema,
  toUpdate: (input) => ({
    installation: input.installation,
    "customization.available": input.customization.available,
    "customization.aiWorkflowEnabled": input.customization.aiWorkflowEnabled,
    "customization.technicalReviewRequired": input.customization.technicalReviewRequired,
    "customization.typicalTurnaround": input.customization.typicalTurnaround,
    "customization.suggestedAreas": input.customization.suggestedAreas,
  }),
};

export const SEO_SECTION: SectionConfig<typeof productSeoSchema> = {
  section: "seo",
  permission: "product.update",
  schema: productSeoSchema,
  toUpdate: (input) => ({ seo: input.seo }),
};
