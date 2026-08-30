"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { TAXONOMY_CATALOGUES, TAXONOMY_KINDS } from "@/lib/db/enums";
import { objectIdSchema, optionalText, slugSchema } from "@/validators/common";
import { staffActor } from "@/services/audit";
import { taxonomyChanged } from "@/services/catalog/cache";
import * as taxonomyService from "@/services/catalog/taxonomy-service";

/**
 * Taxonomy admin — §7.
 *
 * Every one of these invalidates the **catalogue** as well as the taxonomy
 * list, because `products.facets` stores taxonomy slugs. A rename that
 * refreshed only the taxonomy cache would leave the marketplace filtering on
 * the old vocabulary until its own window expired.
 */

const taxonomyFormSchema = z.object({
  kind: z.enum(TAXONOMY_KINDS),
  /**
   * Which catalogue's vocabulary this belongs to. `both` by default, which is
   * right for a term somebody adds here without thinking about it — usable in
   * either shop rather than in neither.
   */
  catalogue: z.enum(TAXONOMY_CATALOGUES).default("both"),
  name: z.string().trim().min(2, "Give it a name").max(80),
  /** Derived from the name when blank — an admin should not have to think about it. */
  slug: z.union([slugSchema, z.literal("")]).optional(),
  description: optionalText(500),
  icon: optionalText(40),
  /** The browse-card image. `""` clears it — see `TaxonomyImageUpload`. */
  imageUrl: optionalText(600),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === "true" || v === true),
  /**
   * The parent category. Empty string ⇒ a root.
   *
   * `""` rather than absent because a `<select>` with a "— none —" option
   * submits the empty string, and "make this a root" has to be distinguishable
   * from "this form did not include the field" — which is what `null` carries
   * into `updateTaxonomy`.
   */
  parentId: z
    .union([objectIdSchema, z.literal("")])
    .optional()
    .transform((value) => (value === "" ? null : value)),
});

/**
 * Create and update share a result shape.
 *
 * The inline editor picks between them with one `useActionState`, and a hook
 * cannot hold two different success types. `productsReindexed` is present only
 * where it means something — a rename that moved facets — so the form can say
 * "and 14 products re-indexed" without create having to pretend it did any.
 */
export interface TaxonomySaved {
  id: string;
  productsReindexed?: number;
}

export async function createTaxonomyAction(
  _previous: ActionResult<TaxonomySaved> | null,
  formData: FormData,
): Promise<ActionResult<TaxonomySaved>> {
  return withAction(async () => {
    const staff = await requirePermission("taxonomy.manage");
    const input = parseInput(taxonomyFormSchema, parseNestedFormData(formData));

    const created = await taxonomyService.createTaxonomy(
      {
        kind: input.kind,
        /*
         * Passed through, which it was not.
         *
         * The schema has parsed `catalogue` since the catalogue split and this
         * call dropped it, so every term created here silently took the `both`
         * default and no admin could ever change it — a `script` category
         * offered in the template rail, and the other way round.
         */
        catalogue: input.catalogue,
        name: input.name,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
      staffActor(staff.user),
    );

    taxonomyChanged();
    revalidatePath("/admin/taxonomies");

    return ok({ id: String(created._id) });
  });
}

/**
 * The update half — and `.partial()` alone would be wrong.
 *
 * `.partial()` makes a field optional; it does **not** strip a `.default()`.
 * `taxonomyFormSchema.partial().parse({})` still yields
 * `{ catalogue: "both", sortOrder: 0 }`, so a caller that omits `catalogue`
 * would have it silently reset — a `script` category quietly becoming available
 * in the template rail, with no error and nothing in the diff.
 *
 * So `catalogue` is re-declared here without its default: absent now genuinely
 * means "leave it alone", which is what `updateTaxonomy` reads it as.
 *
 * `sortOrder` and `isActive` have the same shape and are left as they are:
 * the manager form submits both on every save, so the default is never reached.
 * Worth knowing before a second caller appears.
 */
const updateSchema = taxonomyFormSchema
  .partial()
  .extend({ id: objectIdSchema, catalogue: z.enum(TAXONOMY_CATALOGUES).optional() });

export async function updateTaxonomyAction(
  _previous: ActionResult<TaxonomySaved> | null,
  formData: FormData,
): Promise<ActionResult<TaxonomySaved>> {
  return withAction(async () => {
    const staff = await requirePermission("taxonomy.manage");
    const input = parseInput(updateSchema, parseNestedFormData(formData));

    const { productsReindexed } = await taxonomyService.updateTaxonomy(
      input.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.catalogue !== undefined ? { catalogue: input.catalogue } : {}),
        // `null` is meaningful here — it promotes a child to a root — so this
        // tests against `undefined` rather than truthiness.
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        // `undefined` means the field was absent; `""` means somebody removed the
        // image, and `updateTaxonomy` turns that into an `$unset`.
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      staffActor(staff.user),
    );

    taxonomyChanged();
    revalidatePath("/admin/taxonomies");

    return ok({ id: input.id, productsReindexed });
  });
}

/**
 * Delete — refused while any product references it.
 *
 * Takes the id directly rather than a `FormData` because it is called from
 * `ConfirmDialog`, whose `action` prop is a zero-argument thunk.
 */
export async function deleteTaxonomyAction(id: string): Promise<ActionResult<void>> {
  return withAction(async () => {
    const staff = await requirePermission("taxonomy.manage");
    parseInput(objectIdSchema, id);

    await taxonomyService.deleteTaxonomy(id, staffActor(staff.user));

    taxonomyChanged();
    revalidatePath("/admin/taxonomies");

    return ok(undefined);
  });
}

const imageUploadSchema = z.object({
  id: objectIdSchema,
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
});

/**
 * A presigned `PUT` for a category's browse-card image.
 *
 * ## Nothing about the destination comes from the client
 *
 * The key is `taxonomy/{id}/image`, built here from an id this action has just
 * validated. There is no `replaceKey` to check against anything, because there is
 * no claim being made: the same term always writes to the same object.
 *
 * That stability is also why a second upload replaces the first instead of adding
 * to the bucket, which matters while `s3:DeleteObject` is denied and nothing
 * cleans up after us. `publicObjectUrl`'s `?v=` stamp is what stops caches along
 * the way serving the previous bytes from an unchanged URL.
 *
 * Bytes never pass through this server — the browser `PUT`s them itself. That is
 * the architectural rule in AGENTS.md, not a preference.
 *
 * `taxonomy.manage`, matching every other action in this file: whoever may rename
 * a category may picture it.
 */
export async function createTaxonomyImageUploadAction(input: unknown): Promise<
  ActionResult<{
    uploadUrl: string;
    key: string;
    headers: Record<string, string>;
    publicUrl: string;
  }>
> {
  return withAction(async () => {
    await requirePermission("taxonomy.manage");
    const parsed = parseInput(imageUploadSchema, input);

    const storage = await import("@/services/storage");
    const key = storage.taxonomyImagePath(parsed.id);

    const ticket = await storage.createUploadUrl({
      scope: "taxonomy-image",
      key,
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
    });

    return ok({
      uploadUrl: ticket.url,
      key: ticket.key,
      publicUrl: storage.publicObjectUrl(ticket.key, { version: Date.now() }),
      headers: ticket.headers,
    });
  });
}
