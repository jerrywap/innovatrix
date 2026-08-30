import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { TAXONOMY_KINDS, type TaxonomyKind } from "@/lib/db/enums";
import { products } from "@/repositories/product.repository";
import { taxonomies } from "@/repositories/taxonomy.repository";
import {
  TaxonomyManager,
  type TaxonomyRow,
} from "@/features/taxonomies/components/taxonomy-manager";

export const metadata: Metadata = { title: "Taxonomies" };

const KIND_LABELS: Record<TaxonomyKind, string> = {
  category: "Categories",
  industry: "Industries",
  technology: "Technologies",
  product_type: "Product types",
};

/**
 * Taxonomy admin — §7.
 *
 * Four kinds in one collection, so four tabs over one editor. Slugs are unique
 * *per kind*, which is why `finance` can be both a category and an industry and
 * why every lookup is scoped.
 *
 * ## Why the usage counts are computed here
 *
 * Each row shows how many products reference it, which drives whether delete is
 * offered at all. **One aggregation for all of them**, not a count per term.
 *
 * It used to be the latter, run concurrently, and the note here argued that "at
 * this cardinality that is the right trade, and the bound is the size of the
 * vocabulary". Both halves were true; the second is what changed. A two-tier
 * vocabulary is a few hundred terms, and a few hundred simultaneous
 * `countDocuments` on every load of an uncached page is not a trade any more.
 * `countsByTaxonomy` is bounded by the number of products instead.
 *
 * Not cached: this is an admin screen behind a permission, and an editor
 * showing a stale count would offer a delete that then fails.
 */
export default async function TaxonomiesPage() {
  const staff = await requirePermissionOrForbid("taxonomy.manage");
  await connectToDatabase();

  const all = await taxonomies.listAll();

  const usageById = await products.countsByTaxonomy();

  const rowsByKind = new Map<TaxonomyKind, TaxonomyRow[]>(
    TAXONOMY_KINDS.map((kind) => [kind, []]),
  );

  for (const taxonomy of all) {
    rowsByKind.get(taxonomy.kind)?.push({
      id: String(taxonomy._id),
      kind: taxonomy.kind,
      name: taxonomy.name,
      slug: taxonomy.slug,
      ...(taxonomy.description ? { description: taxonomy.description } : {}),
      ...(taxonomy.icon ? { icon: taxonomy.icon } : {}),
      sortOrder: taxonomy.sortOrder,
      isActive: taxonomy.isActive,
      ...(taxonomy.parentId ? { parentId: String(taxonomy.parentId) } : {}),
      ...(taxonomy.imageUrl ? { imageUrl: taxonomy.imageUrl } : {}),
      catalogue: taxonomy.catalogue ?? "both",
      usageCount: usageById.get(String(taxonomy._id)) ?? 0,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Taxonomies"
        description="The vocabulary the marketplace filters by. Renaming an address re-indexes every product that uses it."
      />

      <Tabs defaultValue="category">
        <TabsList>
          {TAXONOMY_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {KIND_LABELS[kind]}
              <span className="text-subtle ml-1.5 tabular-nums">
                {rowsByKind.get(kind)?.length ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {TAXONOMY_KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="mt-4">
            <TaxonomyManager
              kind={kind}
              rows={rowsByKind.get(kind) ?? []}
              canManage={staff.permissions.has("taxonomy.manage")}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
