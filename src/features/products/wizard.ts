import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db/client";
import { products } from "@/repositories/product.repository";
import { taxonomies } from "@/repositories/taxonomy.repository";
import { readinessFor } from "@/services/catalog/product-service";
import { toAdminProductView, type AdminProductView } from "@/services/catalog/product-view";
import type { Readiness } from "@/services/catalog/readiness";
import type { TaxonomyCatalogue, TaxonomyKind } from "@/lib/db/enums";

/**
 * What every wizard step needs, loaded once.
 *
 * Wrapped in React `cache`, which is doing real work here: the wizard layout
 * reads the product to draw the Stepper and the readiness rail, and the step
 * page reads it again to fill the form. Without memoisation that is two
 * identical queries per navigation, and the same again for readiness — which
 * is itself two more queries.
 *
 * Same reasoning as the DAL's guards, and it composes with them: a step page
 * calling `requirePermissionOrForbid` and then `loadWizardProduct` issues one
 * session read and one product read for the whole render.
 */

export interface WizardContext {
  product: AdminProductView;
  readiness: Readiness;
}

export const loadWizardProduct = cache(async (productId: string): Promise<WizardContext> => {
  await connectToDatabase();

  const product = await products.findById(productId);
  // `notFound()` rather than a thrown error: a stale bookmark to a deleted
  // draft is a missing page, not a fault.
  if (!product) notFound();

  return {
    product: toAdminProductView(product),
    readiness: await readinessFor(product),
  };
});

/**
 * The same, scoped to one vendor — vendor ticket 04.
 *
 * `notFound()` for a product belonging to another vendor, **not** `forbidden()`.
 * The two must be indistinguishable: a 403 confirms the id is real, which turns
 * this workspace into an oracle somebody can walk. The platform already takes that
 * position on downloads and on AI conversations.
 *
 * `cache`d on both arguments, so the layout and the step page underneath share one
 * query — and keyed by vendor as well as product, so two vendors in one process
 * cannot read each other's memoised result.
 *
 * This is the *read* half. The write half re-checks ownership in the service
 * (`saveSection`'s scope), because removing this call must not open anything.
 */
export const loadVendorWizardProduct = cache(
  async (productId: string, vendorId: string): Promise<WizardContext> => {
    await connectToDatabase();

    const product = await products.findScoped(productId, { vendorId });
    if (!product) notFound();

    return {
      product: toAdminProductView(product),
      readiness: await readinessFor(product),
    };
  },
);

/** The taxonomy pickers on the classification step. */
/**
 * Every option, each carrying its catalogue.
 *
 * Deliberately **not** scoped server-side, and the zero-argument signature is
 * load-bearing: one cache entry, and the two classification pages do not have to
 * await the product before they can start loading options. The form filters by
 * the catalogue the editor currently has selected, which is what makes switching
 * to Template swap the vocabulary in front of them rather than after a save.
 *
 * The authority is `saveClassification`, which refuses a term from the other
 * catalogue. This list is a convenience for the person editing.
 */
export const loadTaxonomyOptions = cache(
  async (): Promise<
    Record<
      TaxonomyKind,
      Array<{ id: string; name: string; catalogue: TaxonomyCatalogue; parentId?: string }>
    >
  > => {
    await connectToDatabase();

    const all = await taxonomies.listAll({ activeOnly: true });
    const grouped: Record<
      TaxonomyKind,
      Array<{ id: string; name: string; catalogue: TaxonomyCatalogue; parentId?: string }>
    > = {
      category: [],
      industry: [],
      technology: [],
      product_type: [],
    };

    for (const taxonomy of all) {
      grouped[taxonomy.kind].push({
        id: String(taxonomy._id),
        name: taxonomy.name,
        catalogue: taxonomy.catalogue ?? "both",
        // Categories only. The form turns this into the tree order and the group
        // label; nothing else reads it.
        ...(taxonomy.parentId ? { parentId: String(taxonomy.parentId) } : {}),
      });
    }

    return grouped;
  },
);
