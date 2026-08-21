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
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === "true" || v === true),
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
        name: input.name,
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.icon ? { icon: input.icon } : {}),
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

const updateSchema = taxonomyFormSchema.partial().extend({ id: objectIdSchema });

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
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
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
