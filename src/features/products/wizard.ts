import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db/client";
import { products } from "@/repositories/product.repository";
import { taxonomies } from "@/repositories/taxonomy.repository";
import { readinessFor } from "@/services/catalog/product-service";
import { toAdminProductView, type AdminProductView } from "@/services/catalog/product-view";
import type { Readiness } from "@/services/catalog/readiness";
import type { TaxonomyKind } from "@/lib/db/enums";

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

/** The taxonomy pickers on the classification step. */
export const loadTaxonomyOptions = cache(
  async (): Promise<Record<TaxonomyKind, Array<{ id: string; name: string }>>> => {
    await connectToDatabase();

    const all = await taxonomies.listAll({ activeOnly: true });
    const grouped: Record<TaxonomyKind, Array<{ id: string; name: string }>> = {
      category: [],
      industry: [],
      technology: [],
      product_type: [],
    };

    for (const taxonomy of all) {
      grouped[taxonomy.kind].push({ id: String(taxonomy._id), name: taxonomy.name });
    }

    return grouped;
  },
);
