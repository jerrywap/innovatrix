import { facetMatch, FACET_PREFIX } from "@/lib/db/models/catalog";
import type { StorefrontCurrency } from "@/config/storefront";
import { productCatalogueFilter, type CatalogueScope } from "@/config/catalogue";

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
  /** Vendor ticket 04 — who made it. Several mean "any of these". */
  vendor?: readonly string[];
  minPrice?: number;
  maxPrice?: number;
  /**
   * Free only. Derived from `activePrice`, not from a stored flag, so it is
   * **per-currency correct**: a product priced at zero in USD and 5,000 in NGN
   * is free to one viewer and not to another, which a boolean on the document
   * could not express.
   */
  free?: boolean;
  customisable?: boolean;
  /**
   * Which catalogue's grid this is — **required**, with an explicit `"all"`.
   *
   * Not optional. Two callers legitimately want both (a vendor storefront, a
   * saved list), and with an optional field "meant both" is indistinguishable
   * from "forgot to pass it" — which on a public listing fails open. Required
   * makes the choice a visible word at every call site and lets `tsc` find the
   * next one.
   *
   * Comes from `options`, never from the query string: a catalogue is a surface,
   * not a filter a visitor may flip.
   */
  catalogue: CatalogueScope;
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
  /*
   * Which catalogue it is in, so the card can say "Website Template" or "Full
   * Script" rather than leaving a visitor to infer it from the URL they arrived
   * by.
   *
   * It matters most where the two catalogues meet: search results, a saved list
   * and a vendor storefront all mix them, and on those screens the type is the
   * difference between a front-end you style and an application you run.
   */
  catalogue: 1,
  facets: 1,
  /*
   * The first **screenshot**, not the first media entry.
   *
   * This was `$slice: ["$media", 1]` — document order, one element, and `kind` not
   * even projected. A product whose video happened to sit first got its `.mp4`
   * handed to `next/image` on the card. `scripts/seed.ts` parks its video last
   * specifically to dodge this and calls it out as "a real bug, in a different
   * file, waiting for its own diff"; a vendor who can now add a video is what
   * makes it due.
   *
   * `$filter` before `$slice`, so a product with only a video projects an empty
   * array and the card falls back to its placeholder — which is right, because
   * there is no still frame to show. `kind` rides along so `card-mapper` can be
   * explicit rather than trusting the filter to have happened.
   */
  media: {
    $slice: [
      {
        $filter: {
          input: { $ifNull: ["$media", []] },
          as: "item",
          cond: { $eq: ["$$item.kind", "screenshot"] },
        },
      },
      1,
    ],
  },
  prices: 1,
  "customization.available": 1,
  installation: 1,
  isFeatured: 1,
  orderCount: 1,
  publishedAt: 1,
  activePrice: 1,
  hasPrice: 1,
  /**
   * Vendor ticket 04 — who made it, so a card can say so.
   *
   * Denormalised onto `Product` precisely so it can be projected here. A `$lookup`
   * against `vendors` would run per row on the marketplace's hottest query, and
   * resolving the name in the mapper would be a query per card — §94's
   * "no unbounded reads" applies to `n` small reads as much as to one large one.
   *
   * Absent on a first-party product, which is how the card knows to render no
   * attribution at all: "by CoSetup" on a platform called CoSetup is noise.
   */
  vendorSlug: 1,
  vendorName: 1,
  /*
   * Vendor ticket 10 — the reason the aggregate is cached on the product at all.
   *
   * A listing cannot aggregate per card: forty-eight `$lookup`s into `reviews` on the
   * marketplace's hottest query is exactly what §94 forbids. So the sum and the count ride
   * along in the projection and the average is derived in the mapper.
   */
  ratingSum: 1,
  ratingCount: 1,
} as const;

/**
 * The subset of a query that decides the results — nothing else.
 *
 * ## Why this exists
 *
 * `parseMarketplaceQuery` returns a `ParsedMarketplaceQuery`, which is a
 * `MarketplaceQueryInput` **plus `raw`** — the whole query string, kept so the
 * filter rail can build links back out of it. That object was being handed
 * straight to a `"use cache"` function, so the cache key included `raw`. Three
 * consequences, none visible from a page that looks correct:
 *
 * - `?utm_source=newsletter` and `?fbclid=…` each mint their own entry for
 *   results identical to the plain URL. Campaign traffic — the traffic most worth
 *   serving fast — is the traffic guaranteed to miss.
 * - `?category=crm&industry=retail` and `?industry=retail&category=crm` are two
 *   entries, because object key order follows insertion order.
 * - So does `?category=a&category=b` versus `?category=b&category=a`, which is the
 *   same `$in`.
 *
 * The listing then behaves like it has no cache while paying to maintain one.
 *
 * ## How it is kept honest
 *
 * `NORMALISE` is a mapped type over **every** key of `MarketplaceQueryInput`, with
 * optionality stripped. Adding a field to that interface without deciding what it
 * does to the key is a compile error naming the missing property — which is the
 * only mechanism that survives somebody adding a filter in six months and not
 * reading this comment.
 *
 * Arrays are sorted and de-duplicated because `facetMatch` already treats them as
 * a set (it builds an `$in`), and an empty one is dropped because `[]` and absent
 * produce a byte-identical pipeline. Both are safe *because* the pipeline cannot
 * tell the difference; neither would be safe otherwise.
 *
 * Note `q` is kept: `searchMarketplace` routes free text around the cache
 * entirely, so it never reaches a key. It is normalised here anyway rather than
 * dropped, because a key that quietly ignores a field is how two different
 * searches would come to share one entry the day that routing changes.
 */
type Normaliser<T> = { [K in keyof T]-?: (value: T[K]) => T[K] };

const keep = <T>(value: T): T => value;

/** Sorted, de-duplicated, and `undefined` when it would filter nothing. */
function termSet(value: readonly string[] | undefined): readonly string[] | undefined {
  if (!value || value.length === 0) return undefined;
  return [...new Set(value)].sort();
}

const NORMALISE: Normaliser<MarketplaceQueryInput> = {
  q: keep,
  category: termSet,
  industry: termSet,
  technology: termSet,
  productType: keep,
  vendor: termSet,
  minPrice: keep,
  maxPrice: keep,
  free: keep,
  customisable: keep,
  catalogue: keep,
  sort: keep,
  page: keep,
  limit: keep,
  currency: keep,
};

/**
 * Two URLs describing the same result set produce one key.
 *
 * Key **order** is the declaration order of `NORMALISE` rather than the caller's
 * insertion order, which is half of what makes that true.
 */
export function queryKey(input: MarketplaceQueryInput): MarketplaceQueryInput {
  const key: Record<string, unknown> = {};

  for (const field of Object.keys(NORMALISE) as Array<keyof MarketplaceQueryInput>) {
    const normalise = NORMALISE[field] as (value: unknown) => unknown;
    const value = normalise(input[field]);
    // Omitted rather than set to `undefined`: a present-but-undefined property
    // is a different object, and may serialise differently.
    if (value !== undefined) key[field] = value;
  }

  return key as unknown as MarketplaceQueryInput;
}

export function buildMarketplacePipeline(
  input: MarketplaceQueryInput,
  /**
   * `{ counts: false }` returns the rows branch **flattened** — no `$facet`, so
   * the aggregation yields card documents directly rather than one wrapper.
   *
   * For appending the next page of an infinite-scroll grid. Skipping the counts
   * there is not merely cheaper, it is more *correct*: the facet counts describe
   * the whole filtered set, so appending page three cannot change them, and
   * recomputing would spend an `$unwind` and a `$group` to arrive at the numbers
   * already on the screen. Net, an appended page is cheaper than clicking "2".
   *
   * The default shape is unchanged byte for byte, because `getCardsBySlug`
   * depends on it: it slices stage one off with `.slice(1)` and reuses the rest.
   */
  options: { counts?: boolean } = {},
): Record<string, unknown>[] {
  const page = Math.min(Math.max(1, input.page), MAX_PAGE);
  const limit = Math.min(Math.max(1, input.limit), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const filtering = [
    { $match: primaryMatch(input) },
    { $addFields: computedFields(input) },
    ...priceRangeStage(input),
  ];

  const rows = [
    { $sort: sortStage(input) },
    { $skip: skip },
    { $limit: limit },
    { $project: CARD_PROJECTION },
  ];

  if (options.counts === false) return [...filtering, ...rows];

  return [
    ...filtering,
    {
      $facet: {
        rows,
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
    /*
     * Vendor ticket 12 — a suspended or offboarded vendor's products.
     *
     * `$ne: true` rather than `false`, because the flag is **absent** on every first-party
     * product and on every product of a vendor in good standing. A `false` match would
     * exclude the entire catalogue, which is the kind of filter bug that looks like an
     * empty database.
     */
    listingSuppressed: { $ne: true },
    /*
     * The catalogue split. `$in` rather than a negation, for an index reason the
     * predicate itself explains — see `productCatalogueFilter`.
     */
    ...productCatalogueFilter(input.catalogue),
  };

  const facets = facetMatch({
    ...(input.category ? { category: [...input.category] } : {}),
    ...(input.industry ? { industry: [...input.industry] } : {}),
    ...(input.technology ? { technology: [...input.technology] } : {}),
    ...(input.productType ? { productType: input.productType } : {}),
    ...(input.vendor ? { vendor: [...input.vendor] } : {}),
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

  if (input.free === true) {
    // "Free" is a bound on the same computed field, not a separate mechanism —
    // and it wins over any numeric range, because a max price alongside "free
    // only" is a contradiction the URL can express and the customer did not
    // mean.
    bounds.$lte = 0;
  } else {
    if (typeof input.minPrice === "number") bounds.$gte = input.minPrice;
    if (typeof input.maxPrice === "number") bounds.$lte = input.maxPrice;
  }

  if (Object.keys(bounds).length === 0) return [];

  // A product with no price in this currency is excluded by a price filter —
  // "under £500" cannot include "price unknown". That is different from the
  // unfiltered view, where it appears as "Price on request".
  //
  // The same bracketing is what makes `free` correct rather than nearly
  // correct: `$addFields` writes an explicit `null` when there is no price in
  // this currency (see the `$ifNull` above, verified against EUR), and BSON type
  // bracketing means `{ $lte: 0 }` does not match `null`. So "not priced in NGN"
  // is not reported as "free in NGN" — which would be the worst possible bug on
  // a filter whose whole promise is the price.
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
  dimension: "category" | "industry" | "technology" | "productType" | "vendor";
  slug: string;
  count: number;
}

const PREFIX_TO_DIMENSION: Record<string, FacetCount["dimension"]> = {
  [FACET_PREFIX.category]: "category",
  [FACET_PREFIX.industry]: "industry",
  [FACET_PREFIX.technology]: "technology",
  [FACET_PREFIX.productType]: "productType",
  [FACET_PREFIX.vendor]: "vendor",
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
    "vendor",
  ]);

  if (input.category?.length) honest.delete("category");
  if (input.industry?.length) honest.delete("industry");
  if (input.technology?.length) honest.delete("technology");
  if (input.productType) honest.delete("productType");
  if (input.vendor?.length) honest.delete("vendor");

  return honest;
}
