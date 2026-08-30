import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { productCatalogueFilter, type CatalogueScope } from "@/config/catalogue";
import { CACHE_PROFILE, CATALOG_TAG } from "@/services/catalog/cache";
import { toFacetCounts, type FacetCount } from "./pipeline";

/**
 * How many published products carry each taxonomy term — for the **whole**
 * catalogue, never relative to a filter.
 *
 * ## Why this is not `searchMarketplace().facetCounts`
 *
 * That is the obvious source and it is wrong here twice over, and both faults are
 * silent.
 *
 * **It is capped.** `buildMarketplacePipeline` takes the top 200 facet strings by
 * count (`pipeline.ts`, `$limit: 200`). There are 46 distinct facets today so
 * nothing is lost — but the vocabulary is 353 terms plus one per vendor, and a
 * term past the cap comes back as *absent*, which a caller reads as zero. While
 * zero only meant "render this greyed" that was survivable. It now means
 * **"do not render this at all"**, so a truncated list would delete real
 * categories from the rail with nothing in a log.
 *
 * **It is relative to the query.** A landing page pins its own term through
 * `forced`, so the counts under it are the *intersection* with that term. On a
 * child page a sibling would count the products in both — which is nearly always
 * zero, and is not what clicking the sibling gives you.
 *
 * So: one aggregation, unbounded, scoped only by catalogue. Bounded by the number
 * of products rather than by the size of the vocabulary, which is the direction
 * that matters — the vocabulary is what grows.
 *
 * ## Counts include a parent's children
 *
 * A product carries its category's parent in `facets` too (see `withAncestors`),
 * so a parent's number is the real total underneath it rather than the handful
 * filed directly against it. That is what makes "hide a category with nothing in
 * it" mean what a person expects.
 */
export interface TermCounts {
  category: Map<string, number>;
  industry: Map<string, number>;
  technology: Map<string, number>;
  productType: Map<string, number>;
}

export async function termCounts(catalogue: CatalogueScope = "script"): Promise<TermCounts> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife(CACHE_PROFILE.listing);

  await connectToDatabase();

  const rows = await Product.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        status: "published",
        deletedAt: null,
        ...productCatalogueFilter(catalogue),
      },
    },
    { $unwind: "$facets" },
    { $group: { _id: "$facets", count: { $sum: 1 } } },
    // Deliberately no `$limit`. See the note above — a cap here deletes terms
    // from the storefront rather than merely truncating a list.
  ]);

  // `toFacetCounts` already owns the prefix→dimension table, so the two cannot
  // disagree about what `cat:` means.
  const counts = toFacetCounts(rows);
  const of = (dimension: FacetCount["dimension"]) =>
    new Map(counts.filter((c) => c.dimension === dimension).map((c) => [c.slug, c.count]));

  return {
    category: of("category"),
    industry: of("industry"),
    technology: of("technology"),
    productType: of("productType"),
  };
}

/**
 * One representative screenshot per category, for the browse cards.
 *
 * ## Why the best-selling product
 *
 * A category card wants a picture of what is *in* the category, and the honest
 * answer to "what is in it" is the thing people buy most. Sorting by `orderCount`
 * also makes the choice stable: the same category shows the same image until the
 * ranking actually changes, rather than flickering between products on every
 * revalidate the way `$first` over an unsorted group would.
 *
 * ## One aggregation, not one per category
 *
 * `$unwind` the `cat:` facets, sort, then `$group` taking the first row per
 * facet. The obvious shape — a query per category — is 30 round trips today and
 * 230 once products are spread across the tree, on a path that renders above the
 * fold.
 *
 * Because a product carries its category's **parent** in `facets`, a parent gets
 * a preview from its best-selling descendant without any extra work. That is the
 * ancestor facet paying for itself a third time.
 *
 * Matches `card-mapper.ts`'s rule for what counts as an image: the first
 * `screenshot`-kind media entry with a URL. A video reaching `next/image` is a
 * broken tile, and `kind` is optional on older rows, so absent is treated as a
 * screenshot exactly as it is there.
 */
export interface CategoryPreview {
  url: string;
  alt: string;
}

export async function categoryPreviews(
  catalogue: CatalogueScope = "script",
): Promise<Map<string, CategoryPreview>> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife(CACHE_PROFILE.listing);

  await connectToDatabase();

  const rows = await Product.aggregate<{
    _id: string;
    url: string;
    alt?: string;
    name: string;
  }>([
    {
      $match: {
        status: "published",
        deletedAt: null,
        "media.0": { $exists: true },
        ...productCatalogueFilter(catalogue),
      },
    },
    {
      $project: {
        name: 1,
        orderCount: 1,
        facets: 1,
        shot: {
          $first: {
            $filter: {
              input: { $ifNull: ["$media", []] },
              as: "item",
              cond: {
                $and: [
                  { $ne: [{ $ifNull: ["$$item.url", null] }, null] },
                  { $in: [{ $ifNull: ["$$item.kind", "screenshot"] }, ["screenshot"]] },
                ],
              },
            },
          },
        },
      },
    },
    { $match: { shot: { $ne: null } } },
    { $unwind: "$facets" },
    { $match: { facets: { $regex: "^cat:" } } },
    // Sorted before the group, so `$first` means "best selling" rather than
    // "whatever the storage engine returned first".
    { $sort: { orderCount: -1, _id: 1 } },
    {
      $group: {
        _id: "$facets",
        url: { $first: "$shot.url" },
        alt: { $first: "$shot.alt" },
        name: { $first: "$name" },
      },
    },
  ]);

  return new Map(
    rows
      .filter((row) => row.url)
      .map((row) => [row._id.slice("cat:".length), { url: row.url, alt: row.alt ?? row.name }]),
  );
}
