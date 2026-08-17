import "server-only";
import type { Types } from "mongoose";
import { buildProductFacets } from "@/lib/db/models/catalog";
import { taxonomies } from "@/repositories/taxonomy.repository";

/**
 * Derive `products.facets` from a product's taxonomy ids.
 *
 * **This is the only place `buildProductFacets` is called in application
 * code.** `ERD.md` is explicit about why: `facets` is derived, and a second
 * writer means drift, and drift means the marketplace silently stops matching a
 * filter that used to work. Nothing errors — results just quietly go missing.
 *
 * The array stores **slugs**, not ids, so that `?category=crm` can filter
 * without resolving ids first. The cost of that choice is this module: a rename
 * invalidates every referencing product, so `TaxonomyService.update` re-derives
 * in bulk.
 */

export interface TaxonomyIds {
  categoryIds?: readonly (string | Types.ObjectId)[];
  industryIds?: readonly (string | Types.ObjectId)[];
  technologyIds?: readonly (string | Types.ObjectId)[];
  productTypeId?: string | Types.ObjectId | undefined;
  /**
   * The owning vendor's slug — vendor ticket 04. Absent ⇒ first-party.
   *
   * A **pass-through**, not an id to resolve: a vendor is not a taxonomy, so there
   * is nothing for `slugsByIds` to look up. It sits in this interface anyway
   * because of the trap below — the caller has to hand it over on *every* facet
   * write, and a parameter it must pass is much harder to forget than a step it
   * must remember.
   */
  vendorSlug?: string | undefined;
}

/**
 * ⚠️ **The trap.** Facets are derived and **rewritten wholesale** on every
 * classification save. A vendor term added anywhere except here is silently wiped
 * the next time somebody edits a product's categories — and nothing fails. The
 * product just quietly stops appearing under its vendor, which is the same
 * failure mode the header describes for taxonomy slugs, discovered weeks later by
 * a vendor asking why their storefront is empty.
 *
 * So every caller passes `vendorSlug`, and the callers are countable: `createDraft`
 * and `saveClassification` in `product-service.ts`, plus the bulk re-derive after a
 * taxonomy or vendor rename.
 */

/**
 * Resolve ids to slugs, then build the facet array.
 *
 * One database read for all four dimensions — the id sets overlap in practice
 * and `slugsByIds` deduplicates, so asking per dimension would be three extra
 * round trips for the same keys.
 *
 * An id that no longer resolves is **dropped silently**. That is deliberate: a
 * taxonomy deleted out from under a product should cost that product one facet,
 * not make it unsaveable. `TaxonomyService.remove` is what stops it happening
 * in the first place.
 */
export async function deriveFacets(ids: TaxonomyIds): Promise<string[]> {
  const all = [
    ...(ids.categoryIds ?? []),
    ...(ids.industryIds ?? []),
    ...(ids.technologyIds ?? []),
    ...(ids.productTypeId ? [ids.productTypeId] : []),
  ];

  // Not `all.length === 0` any more: a vendor's product with no taxonomy at all
  // still needs its `vend:` term, and returning early would drop it.
  if (all.length === 0 && !ids.vendorSlug) return [];

  const slugs = all.length > 0 ? await taxonomies.slugsByIds(all) : new Map<string, string>();
  const resolve = (list: readonly (string | Types.ObjectId)[] | undefined) =>
    (list ?? []).map((id) => slugs.get(String(id))).filter((slug): slug is string => !!slug);

  const productTypeSlug = ids.productTypeId ? slugs.get(String(ids.productTypeId)) : undefined;

  return buildProductFacets({
    categorySlugs: resolve(ids.categoryIds),
    industrySlugs: resolve(ids.industryIds),
    technologySlugs: resolve(ids.technologyIds),
    ...(productTypeSlug ? { productTypeSlug } : {}),
    ...(ids.vendorSlug ? { vendorSlug: ids.vendorSlug } : {}),
  });
}

/**
 * Re-derive facets for many products at once, using one slug lookup.
 *
 * Called after a taxonomy slug rename. Batched rather than looping
 * `deriveFacets` because a popular category has hundreds of products and each
 * call would repeat the same taxonomy read.
 */
export async function deriveFacetsForMany(
  products: ReadonlyArray<{ id: string } & TaxonomyIds>,
): Promise<Array<{ id: string; facets: string[] }>> {
  if (products.length === 0) return [];

  const everyId = products.flatMap((product) => [
    ...(product.categoryIds ?? []),
    ...(product.industryIds ?? []),
    ...(product.technologyIds ?? []),
    ...(product.productTypeId ? [product.productTypeId] : []),
  ]);

  const slugs = await taxonomies.slugsByIds(everyId);

  return products.map((product) => {
    const resolve = (list: readonly (string | Types.ObjectId)[] | undefined) =>
      (list ?? []).map((id) => slugs.get(String(id))).filter((slug): slug is string => !!slug);

    const productTypeSlug = product.productTypeId
      ? slugs.get(String(product.productTypeId))
      : undefined;

    return {
      id: product.id,
      facets: buildProductFacets({
        categorySlugs: resolve(product.categoryIds),
        industrySlugs: resolve(product.industryIds),
        technologySlugs: resolve(product.technologyIds),
        ...(productTypeSlug ? { productTypeSlug } : {}),
        ...(product.vendorSlug ? { vendorSlug: product.vendorSlug } : {}),
      }),
    };
  });
}
