import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { PipelineStage } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { Product, Taxonomy } from "@/lib/db/models/catalog";
import type { TaxonomyCatalogue, TaxonomyKind } from "@/lib/db/enums";
import { DEFAULT_CURRENCY, type StorefrontCurrency } from "@/config/storefront";
import {
  productCatalogueFilter,
  taxonomyScopeFilter,
  type CatalogueScope,
} from "@/config/catalogue";
import { CACHE_PROFILE, CATALOG_TAG, TAXONOMY_TAG } from "@/services/catalog/cache";
import {
  buildMarketplacePipeline,
  dimensionsWithHonestCounts,
  toFacetCounts,
  type FacetCount,
  type MarketplaceQueryInput,
} from "./pipeline";
import { toCard, type RawCard } from "./card-mapper";

/**
 * Marketplace reads — §6, §74, §94.
 *
 * ## What is cached and what is not
 *
 * **Cached:** the taxonomy (changes rarely, read on every page) and
 * filter/sort/page combinations, which come from a **closed vocabulary** — a
 * bounded set of slugs the admin defined.
 *
 * **Not cached:** anything with a free-text query. `q` is attacker-controlled,
 * so caching on it makes the key space unbounded: a few thousand requests with
 * random strings fill the cache with entries nobody will ever read again and
 * evict the ones that matter. Search is the one path that pays full price, and
 * it is the right one to choose.
 *
 * ## Everything here returns plain data
 *
 * `use cache` requires serialisable returns and `ObjectId` is not one. Cards
 * carry string ids, and the taxonomy is a plain record — which also means a
 * component cannot accidentally reach for a field the card query never fetched.
 */

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Already resolved against the taxonomy — no `$lookup`, see below. */
  categories: Array<{ slug: string; name: string }>;
  technologies: Array<{ slug: string; name: string }>;
  image?: { url: string; alt: string };
  /** Absent means "price on request" — never zero, never NaN. */
  price?: { amount: number; currency: StorefrontCurrency; compareAtAmount?: number };
  customisable: boolean;
  isFeatured: boolean;
  /**
   * Who made it — vendor ticket 04. Absent ⇒ first-party.
   *
   * Carries no `href`. The storefront at `/vendors/[slug]` is vendor ticket 11's, and
   * `typedRoutes` makes a link to a route nobody has built a compile error — which is
   * the rule working: the link arrives with the page it points at. The slug is here so
   * that page needs no second query when it does.
   *
   * First-party products carry nothing at all, because "by CoSetup" on a platform
   * called CoSetup is noise.
   */
  vendor?: { slug: string; name: string };
  /**
   * The rating, derived from the cached sum and count — vendor ticket 10.
   *
   * Absent when nobody has reviewed it. A card for an unreviewed product shows no stars at
   * all rather than an empty five, because zero stars reads as "everybody hated it".
   */
  rating?: { average: number; count: number };
}

export interface MarketplaceResult {
  products: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
  facetCounts: FacetCount[];
  /** Dimensions where a count would be honest — see `dimensionsWithHonestCounts`. */
  countableDimensions: FacetCount["dimension"][];
}

export interface TaxonomyTerm {
  slug: string;
  name: string;
  description?: string;
  /**
   * Which catalogue's vocabulary it is in — `both` for most.
   *
   * Carried on the term so a landing page can decide whether it *owns* the term
   * or merely uses it as a filter: a `both` category gets exactly one landing
   * page (on `/marketplace`), and appears on `/templates` as a filter only. Two
   * landing pages for one term is duplicate content that we would be generating
   * on purpose.
   */
  catalogue: TaxonomyCatalogue;
}

export type TaxonomyIndex = Record<TaxonomyKind, TaxonomyTerm[]>;

/* ────────────────────────────────────────────── taxonomy */

/**
 * Every active taxonomy term, cached hard.
 *
 * This is what lets the product query avoid a `$lookup`. The card needs
 * *names*, the document stores *slugs* in `facets`, and joining 24 products to
 * their categories on every request is the obvious improvement that is actually
 * a large regression — the whole point of denormalising `facets` was to make
 * the grid one indexed read.
 */
export async function getTaxonomyIndex(
  /*
   * Scoped by catalogue, and this argument is what closes the rail leak.
   *
   * `filter-rail.tsx` renders **every** term of a kind and only greys out the ones
   * with no matches — deliberately, so the rail "never loses options as it
   * narrows". So filtering the products is not enough: without scoping the
   * vocabulary here, `/templates` advertises "CRM" and `/marketplace` advertises
   * "Admin dashboards", each greyed out and neither meaning anything.
   *
   * Being an argument also puts it in the `"use cache"` key, so the two surfaces
   * cannot share a cached index. That is the requirement satisfied structurally
   * rather than remembered.
   */
  scope: CatalogueScope = "all",
): Promise<TaxonomyIndex> {
  "use cache";
  cacheTag(TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.taxonomy);

  await connectToDatabase();

  const rows = await Taxonomy.find({ isActive: true, ...taxonomyScopeFilter(scope) })
    .sort({ sortOrder: 1, name: 1 })
    .select({ kind: 1, slug: 1, name: 1, description: 1, catalogue: 1 })
    .lean<
      Array<{
        kind: TaxonomyKind;
        slug: string;
        name: string;
        description?: string;
        catalogue?: TaxonomyCatalogue;
      }>
    >();

  const index: TaxonomyIndex = {
    category: [],
    industry: [],
    technology: [],
    product_type: [],
  };

  for (const row of rows) {
    index[row.kind].push({
      slug: row.slug,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      // Absent ⇒ `both`, matching the schema default, so a term written before
      // the field existed is usable in either catalogue rather than neither.
      catalogue: row.catalogue ?? "both",
    });
  }

  return index;
}

/** One term, for a category or industry landing page's metadata and copy. */
export async function getTaxonomyTerm(
  kind: TaxonomyKind,
  slug: string,
  /*
   * Scoped, so a landing page for the wrong catalogue's term 404s rather than
   * rendering an empty grid under a real-looking heading.
   */
  scope: CatalogueScope = "all",
): Promise<TaxonomyTerm | null> {
  const index = await getTaxonomyIndex(scope);
  return index[kind].find((term) => term.slug === slug) ?? null;
}

/* ────────────────────────────────────────────── search */

export async function searchMarketplace(
  input: MarketplaceQueryInput,
): Promise<MarketplaceResult> {
  // Free text bypasses the cache entirely — unbounded key space. Everything
  // else goes through `cachedSearch`, whose inputs come from a closed set.
  return input.q ? runSearch(input) : cachedSearch(input);
}

async function cachedSearch(input: MarketplaceQueryInput): Promise<MarketplaceResult> {
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.listing);

  return runSearch(input);
}

interface RawFacetResult {
  rows: RawCard[];
  facetCounts: Array<{ _id: string; count: number }>;
  total: Array<{ value: number }>;
}

async function runSearch(input: MarketplaceQueryInput): Promise<MarketplaceResult> {
  await connectToDatabase();

  const [result] = await Product.aggregate<RawFacetResult>(
    // The builder is deliberately free of Mongoose types so it stays pure and
    // testable; this is the one place the two meet.
    buildMarketplacePipeline(input) as unknown as PipelineStage[],
  );
  const taxonomy = await getTaxonomyIndex();

  const rows = result?.rows ?? [];
  const total = result?.total?.[0]?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / input.limit));

  return {
    products: rows.map((row) => toCard(row, taxonomy, input.currency)),
    total,
    page: input.page,
    pageCount,
    facetCounts: toFacetCounts(result?.facetCounts ?? []),
    countableDimensions: [...dimensionsWithHonestCounts(input)],
  };
}

/* ────────────────────────────────────────────── rails */

/**
 * A small set of cards by slug, for the recently-viewed rail.
 *
 * Preserves the order it was asked for — a "recently viewed" rail sorted by
 * publish date is not recently viewed. `$in` returns index order, so the
 * reordering happens here.
 */
export async function getCardsBySlug(
  slugs: readonly string[],
  currency: StorefrontCurrency,
  /*
   * Scoped explicitly, because this is one of the three readers that **skip
   * stage one** — it writes its own `$match` and then reuses the pipeline from
   * stage two. A predicate added to `primaryMatch` never reaches here, so
   * "recently viewed" on `/templates` would happily show the script somebody
   * looked at yesterday.
   *
   * `"all"` for a saved list, which spans both by design.
   */
  scope: CatalogueScope = "all",
): Promise<ProductCard[]> {
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.listing);

  if (slugs.length === 0) return [];

  await connectToDatabase();

  const [result] = await Product.aggregate<RawFacetResult>([
    {
      $match: {
        slug: { $in: [...slugs] },
        status: "published",
        deletedAt: null,
        ...productCatalogueFilter(scope),
      },
    },
    // Reuses the same pipeline minus its own `$match`, so the card projection
    // and the price logic cannot drift between the grid and the rails.
    ...(buildMarketplacePipeline({
      sort: "latest",
      page: 1,
      limit: slugs.length,
      currency,
      // Irrelevant here — stage one is sliced off — but the type requires a
      // decision, which is the point of it being required.
      catalogue: scope,
    }).slice(1) as unknown as PipelineStage[]),
  ] as PipelineStage[]);

  const taxonomy = await getTaxonomyIndex(scope);
  const cards = (result?.rows ?? []).map((row) => toCard(row, taxonomy, currency));
  const bySlug = new Map(cards.map((card) => [card.slug, card]));

  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((card): card is ProductCard => Boolean(card));
}

/**
 * How many products are actually on sale.
 *
 * Exists because the landing page claimed "148 products across 31 industries"
 * as a hardcoded string — three times, in two different senses — while the
 * catalogue held a thousand and nine industries. The figure had been copied
 * from a design mock-up whose own footnotes call its numbers illustrative.
 *
 * `limit: 1` still runs the whole aggregation: `$facet` computes the count
 * regardless, so the limit only bounds the rows we then throw away. It is
 * cheap for the right reason instead — no `q`, so it routes through
 * `cachedSearch` and is served from the listing cache like every other
 * catalogue read.
 */
export async function getPublishedProductCount(
  currency: StorefrontCurrency = DEFAULT_CURRENCY,
  catalogue: CatalogueScope = "script",
): Promise<number> {
  const { total } = await searchMarketplace({
    sort: "latest",
    page: 1,
    limit: 1,
    currency,
    catalogue,
  });
  return total;
}

/** Featured / latest / popular rails for the marketplace landing page. */
export async function getRail(
  rail: "featured" | "latest" | "popular",
  currency: StorefrontCurrency,
  limit = 4,
  catalogue: CatalogueScope = "script",
): Promise<ProductCard[]> {
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.listing);

  const result = await runSearch({
    sort: rail === "popular" ? "popular" : "latest",
    page: 1,
    limit,
    currency,
    catalogue,
  });

  if (rail !== "featured") return result.products;

  const featured = result.products.filter((card) => card.isFeatured);
  // Falling back to latest rather than rendering an empty rail: "Featured" with
  // nothing in it reads as a broken page, and nothing being featured yet is the
  // normal state of a new catalogue.
  return featured.length > 0 ? featured : result.products;
}
