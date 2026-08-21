import {
  DEFAULT_CURRENCY,
  STOREFRONT_CURRENCIES,
  toStorefrontCurrency,
  type StorefrontCurrency,
} from "@/config/storefront";
import type { CatalogueScope } from "@/config/catalogue";
import {
  MAX_LIMIT,
  MAX_PAGE,
  type MarketplaceQueryInput,
  type MarketplaceSort,
} from "./pipeline";

/**
 * The URL is the state — §6, and the acceptance criterion that copying a
 * filtered URL reproduces the result set for someone else.
 *
 * Pure and free of `next/*`, so it can be tested directly and so the same
 * parser serves a page, a route handler and the sitemap.
 *
 * ## Everything here is untrusted
 *
 * A query string is whatever anyone types. So: slugs are pattern-matched rather
 * than trusted, prices are clamped to integers in a sane range, the page is
 * bounded, and an unknown sort falls back instead of reaching the pipeline.
 * §94's "no unbounded reads" is enforced at the parse, not at the query.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

const SORTS: readonly MarketplaceSort[] = [
  "relevance",
  "latest",
  "popular",
  "price_asc",
  "price_desc",
];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A price nobody will legitimately type, in minor units. Guards `$skip`-style abuse. */
const MAX_MINOR_UNITS = 1_000_000_00;
const MAX_TERMS_PER_DIMENSION = 12;
export const DEFAULT_PAGE_SIZE = 24;

export interface ParsedMarketplaceQuery extends MarketplaceQueryInput {
  /** Echoed back so the currency switcher and pagination can rebuild the URL. */
  raw: RawSearchParams;
}

export function parseMarketplaceQuery(
  raw: RawSearchParams,
  options: {
    currency?: StorefrontCurrency;
    forced?: Partial<Pick<MarketplaceQueryInput, "category" | "industry">>;
    /**
     * Which catalogue's grid this is. Defaults to `script` — the marketplace.
     *
     * Read from `options` and **never** from `raw`: a catalogue is the surface the
     * visitor is standing on, not a filter they may flip. `?catalogue=template`
     * on `/marketplace` is ignored, which is what stops one storefront being used
     * to browse the other's stock.
     */
    catalogue?: CatalogueScope;
  } = {},
): ParsedMarketplaceQuery {
  const q = trimmedText(raw.q, 120);
  const requestedSort = first(raw.sort);
  const sort: MarketplaceSort =
    requestedSort && (SORTS as readonly string[]).includes(requestedSort)
      ? (requestedSort as MarketplaceSort)
      : // Searching without an explicit sort should rank by relevance; browsing
        // should show the newest first.
        q
        ? "relevance"
        : "latest";

  return {
    ...(q ? { q } : {}),
    // A landing page forces its own term and the rail cannot remove it —
    // otherwise `/marketplace/category/crm` becomes a second `/marketplace`.
    category: options.forced?.category ?? slugs(raw.category),
    industry: options.forced?.industry ?? slugs(raw.industry),
    technology: slugs(raw.technology),
    // Vendor ticket 04. Through `slugs()` like every other dimension, so the
    // `SLUG` pattern and the per-dimension cap apply — a query string is untrusted
    // and this one reaches an `$in` on an indexed array.
    vendor: slugs(raw.vendor),
    ...(firstSlug(raw.productType) ? { productType: firstSlug(raw.productType)! } : {}),
    ...(minorUnits(raw.minPrice) !== undefined ? { minPrice: minorUnits(raw.minPrice)! } : {}),
    ...(minorUnits(raw.maxPrice) !== undefined ? { maxPrice: minorUnits(raw.maxPrice)! } : {}),
    // Through `boolean()` like `customisable`, so `?free=false` means *not free*
    // rather than a truthy non-empty string.
    ...(boolean(raw.free) !== undefined ? { free: boolean(raw.free)! } : {}),
    ...(boolean(raw.customisable) !== undefined
      ? { customisable: boolean(raw.customisable)! }
      : {}),
    sort,
    page: intInRange(first(raw.page), 1, 1, MAX_PAGE),
    limit: intInRange(first(raw.limit), DEFAULT_PAGE_SIZE, 1, MAX_LIMIT),
    currency: options.currency ?? DEFAULT_CURRENCY,
    catalogue: options.catalogue ?? "script",
    raw,
  };
}

/**
 * Rebuild the URL with one thing changed.
 *
 * Every control on the page goes through this, which is what keeps the "copying
 * the URL reproduces the result set" criterion true: there is one place that
 * knows a filter change resets the page to 1, and one place that knows an empty
 * value means "remove the parameter" rather than "set it to empty".
 */
export function marketplaceHref(
  basePath: string,
  current: RawSearchParams,
  changes: Record<string, string | string[] | boolean | number | undefined | null>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (key in changes) continue;
    for (const item of asArray(value)) params.append(key, item);
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    for (const item of asArray(value === true ? "true" : value))
      params.append(key, String(item));
  }

  // Page is derived, never carried. Any change to the result *set* invalidates
  // it — staying on page 7 of a set that now has two pages shows an empty grid
  // and reads as "no results for that filter".
  params.delete("page");
  const requestedPage = Number(changes.page);
  const keepsPage = !("page" in changes) && Object.keys(changes).length === 0;

  if (Number.isFinite(requestedPage) && requestedPage > 1) {
    params.set("page", String(Math.trunc(requestedPage)));
  } else if (keepsPage) {
    for (const item of asArray(current.page)) params.append("page", item);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Which query keys are *filters* — as opposed to sort, page or currency.
 *
 * One list, because it has already been duplicated once and drifted: vendor ticket 04 added the
 * `vendor` dimension and missed the copy behind "Clear all filters", so a vendor-only filter
 * rendered a view with no way back out of it. The mobile drawer needs the same list a third time,
 * to badge its trigger, which is the point at which the list stops being copied.
 *
 * `sort`, `page` and `currency` are deliberately absent. None of them narrows the result set, and a
 * trigger reading "2 filters" because somebody chose a sort order and a currency would be lying.
 */
export const FILTER_KEYS = [
  "q",
  "category",
  "industry",
  "technology",
  "productType",
  "vendor",
  "minPrice",
  "maxPrice",
  "free",
  "customisable",
] as const;

/**
 * How many filters are on — counting *terms*, not keys.
 *
 * Two categories and a price floor is three, because that is what a person would say if asked. The
 * number goes on the mobile drawer's trigger, where the rail itself is out of sight: a closed drawer
 * has to say that the grid behind it is filtered, or the empty result set below it looks like the
 * catalogue rather than like a filter.
 */
export function activeFilterCount(raw: RawSearchParams): number {
  return FILTER_KEYS.reduce((total, key) => total + asArray(raw[key]).length, 0);
}

/** Toggle one term within a dimension, which is what a filter checkbox does. */
export function toggleTerm(
  current: RawSearchParams,
  dimension: string,
  slug: string,
): Record<string, string[]> {
  const selected = asArray(current[dimension]);
  const next = selected.includes(slug)
    ? selected.filter((item) => item !== slug)
    : [...selected, slug];

  return { [dimension]: next };
}

/**
 * The currency must ride in the URL once a price filter is active.
 *
 * "Under 50,000" means nothing without saying 50,000 *of what*, so a URL with a
 * price bound and no currency reproduces a different result set for a viewer
 * whose cookie says something else — which breaks the linkability criterion
 * outright.
 */
export function currencyMustBeInUrl(query: MarketplaceQueryInput): boolean {
  // `free` counts for the same reason: it is a bound on the price in *this*
  // currency, so a shared `?free=true` link without the currency shows a
  // different set to a viewer whose cookie says otherwise.
  return (
    query.minPrice !== undefined || query.maxPrice !== undefined || query.free !== undefined
  );
}

export function isStorefrontCurrencyParam(value: unknown): value is StorefrontCurrency {
  return (
    typeof value === "string" && (STOREFRONT_CURRENCIES as readonly string[]).includes(value)
  );
}

/* ────────────────────────────────────────────── coercion */

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: string | string[] | undefined | number): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function trimmedText(value: string | string[] | undefined, max: number): string | undefined {
  const text = first(value)?.trim();
  return text ? text.slice(0, max) : undefined;
}

function slugs(value: string | string[] | undefined): string[] {
  return [...new Set(asArray(value).filter((item) => SLUG.test(item)))].slice(
    0,
    MAX_TERMS_PER_DIMENSION,
  );
}

function firstSlug(value: string | string[] | undefined): string | undefined {
  const candidate = first(value);
  return candidate && SLUG.test(candidate) ? candidate : undefined;
}

function minorUnits(value: string | string[] | undefined): number | undefined {
  const raw = first(value);
  if (raw === undefined || raw === "") return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;

  return Math.min(Math.round(parsed), MAX_MINOR_UNITS);
}

/**
 * `"false"` must be false.
 *
 * `z.coerce.boolean()` is `Boolean(input)`, which makes the *string* `"false"`
 * true — so `?customisable=false` would filter for customisable products. The
 * bug returns no error and the wrong rows.
 */
function boolean(value: string | string[] | undefined): boolean | undefined {
  const raw = first(value)?.toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return undefined;
}

function intInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export { toStorefrontCurrency };
