import { facetMatch, FACET_PREFIX } from "@/lib/db/models/catalog";
import type { StorefrontCurrency } from "@/config/storefront";

/**
 * The marketplace query, as one aggregation pipeline.
 *
 * Pure — no database, no `await`, no imports that touch Mongo. That is what
 * makes the index-shape decisions below testable, and they are exactly the
 * decisions that silently stop being true.
 *
 * ## One round trip, not four
 *
 * §94 forbids loading the catalogue into the browser to filter it, and the
 * obvious server-side reading — one query for rows, one for the total, one per
 * facet dimension — is the same mistake moved. `$facet` runs all three branches
 * over one filtered set:
 *
 * ```
 * $match      status + facets + $text + customisable   ← indexed
 * $addFields  the price in the active currency, hasPrice, textScore
 * $match      price range, only when one is set
 * $facet      rows │ facetCounts │ total
 * ```
 *
 * ## Why the price filter is a *second* `$match`
 *
 * The price lives in an array of per-currency rows, so "under £500" is a
 * question about a computed field. Putting it in stage one would need
 * `$elemMatch` against a field that is not in any index, destroying the bounds
 * the facet index provides. Filtering after `$addFields` costs a pass over an
 * already-narrow set and keeps the IXSCAN.
 *
 * ## Why `$text` has to be first
 *
 * MongoDB only allows `$text` in the **first** `$match` of a pipeline. Not a
 * style preference: a `$text` in a later stage is a hard error.
 */

export interface MarketplaceQueryInput {
  q?: string;
  category?: readonly string[];
  industry?: readonly string[];
  technology?: readonly string[];
  productType?: string;
  minPrice?: number;
  maxPrice?: number;
  customisable?: boolean;
  sort: MarketplaceSort;
  page: number;
  limit: number;
  currency: StorefrontCurrency;
}

export type MarketplaceSort = "relevance" | "latest" | "popular" | "price_asc" | "price_desc";

/** §94: an unbounded page space is a scan and a crawl trap. */
export const MAX_PAGE = 100;
export const MAX_LIMIT = 48;

/** Only what a card draws. Never the whole document — §94. */
const CARD_PROJECTION = {
  _id: 1,
  slug: 1,
  name: 1,
  summary: 1,
  facets: 1,
  media: { $slice: ["$media", 1] },
  prices: 1,
  "customization.available": 1,
  installation: 1,
  isFeatured: 1,
  orderCount: 1,
  publishedAt: 1,
  activePrice: 1,
  hasPrice: 1,
} as const;

export function buildMarketplacePipeline(
  input: MarketplaceQueryInput,
): Record<string, unknown>[] {
  const page = Math.min(Math.max(1, input.page), MAX_PAGE);
  const limit = Math.min(Math.max(1, input.limit), MAX_LIMIT);
  const skip = (page - 1) * limit;

  return [
    { $match: primaryMatch(input) },
    { $addFields: computedFields(input) },
    ...priceRangeStage(input),
    {
      $facet: {
        rows: [
          { $sort: sortStage(input) },
          { $skip: skip },
          { $limit: limit },
          { $project: CARD_PROJECTION },
        ],
        // Unwinding `facets` and grouping gives every dimension's counts in one
        // pass. `$unwind` on an indexed array is cheap here because the set is
        // already filtered.
        facetCounts: [
          { $unwind: "$facets" },
          { $group: { _id: "$facets", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 200 },
        ],
        total: [{ $count: "value" }],
      },
    },
  ];
}

/**
 * Stage one. Everything here can use an index, and nothing here is computed.
 */
function primaryMatch(input: MarketplaceQueryInput): Record<string, unknown> {
  const match: Record<string, unknown> = {
    // The single most important line in this file. Every public read filters on
    // it, and `deletedAt` alongside — a soft-deleted published product is still
    // `status: "published"`.
    status: "published",
    deletedAt: null,
  };

  const facets = facetMatch({
    ...(input.category ? { category: [...input.category] } : {}),
    ...(input.industry ? { industry: [...input.industry] } : {}),
    ...(input.technology ? { technology: [...input.technology] } : {}),
    ...(input.productType ? { productType: input.productType } : {}),
  });
  if (facets) Object.assign(match, facets);

  if (input.q) {
    // Must be in the first `$match` — MongoDB rejects `$text` anywhere else.
    match.$text = { $search: input.q };
  }

  if (input.customisable === true) match["customization.available"] = true;
  if (input.customisable === false) match["customization.available"] = { $ne: true };

  return match;
}

/**
 * The price in the viewer's currency, and whether there is one at all.
 *
 * ## The `$ifNull` is load-bearing
 *
 * `$first` of an **empty** `$filter` yields *missing*, not `null`. So the
 * obvious `{ $ne: [..., null] }` is **true** for a product with no price in the
 * active currency, and the card renders `£0.00` or `NaN` — precisely what this
 * ticket forbids. Verified against EUR, which nothing is priced in: the naive
 * check said `true`, the `$ifNull`-wrapped one said `false`.
 */
function computedFields(input: MarketplaceQueryInput): Record<string, unknown> {
  return {
    activePrice: {
      $ifNull: [
        {
          $first: {
            $filter: {
              input: { $ifNull: ["$prices", []] },
              as: "price",
              cond: { $eq: ["$$price.currency", input.currency] },
            },
          },
        },
        null,
      ],
    },
    hasPrice: {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ["$prices", []] },
              as: "price",
              cond: { $eq: ["$$price.currency", input.currency] },
            },
          },
        },
        0,
      ],
    },
    ...(input.q ? { textScore: { $meta: "textScore" } } : {}),
  };
}

function priceRangeStage(input: MarketplaceQueryInput): Record<string, unknown>[] {
  const bounds: Record<string, number> = {};
  if (typeof input.minPrice === "number") bounds.$gte = input.minPrice;
  if (typeof input.maxPrice === "number") bounds.$lte = input.maxPrice;
  if (Object.keys(bounds).length === 0) return [];

  // A product with no price in this currency is excluded by a price filter —
  // "under £500" cannot include "price unknown". That is different from the
  // unfiltered view, where it appears as "Price on request".
  return [{ $match: { "activePrice.amount": bounds } }];
}

/**
 * ## Every sort ends with `_id`
 *
 * Skip/limit over a non-unique key has no defined order between equal rows, so
 * MongoDB is free to return the same document on page 1 and page 2 and to drop
 * another entirely. Page 1 looks perfect, which is why this is worth stating.
 *
 * ## `hasPrice` leads both price sorts
 *
 * A product with no price in the active currency has no position on a price
 * axis. Sorting it as if it were free puts "price on request" first on
 * ascending and — with `-1` on a missing field — first on descending too.
 * Leading with `hasPrice: -1` parks them at the end of both.
 */
function sortStage(input: MarketplaceQueryInput): Record<string, unknown> {
  switch (input.sort) {
    case "relevance":
      // Only meaningful with a query; the caller falls back to `latest`
      // otherwise, because `$meta` on a pipeline with no `$text` is an error.
      return input.q
        ? { textScore: { $meta: "textScore" }, publishedAt: -1, _id: -1 }
        : { publishedAt: -1, _id: -1 };
    case "popular":
      return { orderCount: -1, publishedAt: -1, _id: -1 };
    case "price_asc":
      return { hasPrice: -1, "activePrice.amount": 1, _id: 1 };
    case "price_desc":
      return { hasPrice: -1, "activePrice.amount": -1, _id: -1 };
    case "latest":
    default:
      return { publishedAt: -1, _id: -1 };
  }
}

/* ────────────────────────────────────────────── facet counts */

export interface FacetCount {
  dimension: "category" | "industry" | "technology" | "productType";
  slug: string;
  count: number;
}

const PREFIX_TO_DIMENSION: Record<string, FacetCount["dimension"]> = {
  [FACET_PREFIX.category]: "category",
  [FACET_PREFIX.industry]: "industry",
  [FACET_PREFIX.technology]: "technology",
  [FACET_PREFIX.productType]: "productType",
};

/** Turn the raw `{_id: "cat:crm", count: 3}` rows into something renderable. */
export function toFacetCounts(
  rows: ReadonlyArray<{ _id: string; count: number }>,
): FacetCount[] {
  const counts: FacetCount[] = [];

  for (const row of rows) {
    const separator = row._id.indexOf(":");
    if (separator <= 0) continue;

    const dimension = PREFIX_TO_DIMENSION[row._id.slice(0, separator)];
    if (!dimension) continue;

    counts.push({ dimension, slug: row._id.slice(separator + 1), count: row.count });
  }

  return counts;
}

/**
 * Which dimensions may show counts — the rule that keeps them honest.
 *
 * Counts come from the **already-filtered** set, because computing true
 * drill-down counts would mean moving each dimension's filter out of stage one
 * and destroying the index bounds. That makes them correct for a dimension with
 * nothing selected, and misleading for one that is already filtering: within a
 * dimension the terms are OR'd, so ticking a second category *widens* the set,
 * and any number shown next to it would be smaller than what clicking it gives.
 *
 * So: show counts where nothing is selected, show none where something is. The
 * terms themselves always render, from the cached taxonomy, so the rail never
 * loses options as it narrows.
 */
export function dimensionsWithHonestCounts(
  input: MarketplaceQueryInput,
): Set<FacetCount["dimension"]> {
  const honest = new Set<FacetCount["dimension"]>([
    "category",
    "industry",
    "technology",
    "productType",
  ]);

  if (input.category?.length) honest.delete("category");
  if (input.industry?.length) honest.delete("industry");
  if (input.technology?.length) honest.delete("technology");
  if (input.productType) honest.delete("productType");

  return honest;
}
