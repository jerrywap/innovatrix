import "server-only";
import { cookies } from "next/headers";
import { CURRENCY_COOKIE, toStorefrontCurrency } from "@/config/storefront";
import { getTaxonomyIndex, searchMarketplace } from "@/services/marketplace";
import {
  activeFilterCount,
  currencyMustBeInUrl,
  parseMarketplaceQuery,
  type RawSearchParams,
} from "@/services/marketplace/query";
import { logZeroResultSearch } from "@/services/marketplace/saved";
import { vendorNames } from "@/services/marketplace/storefront";
import { FilterDrawer } from "./components/filter-drawer";
import { FilterRail } from "./components/filter-rail";
import { DiscoveryRails } from "./components/rails";
import type { CatalogueScope } from "@/config/catalogue";
import { Results } from "./components/results";

/**
 * Everything on the marketplace that depends on the request.
 *
 * Lives behind the page's `<Suspense>` boundary, which is the whole reason it
 * is a separate module: `searchParams` and `cookies()` are both dynamic under
 * Cache Components, and reading either one in the page would stop the shell
 * prerendering.
 *
 * ## Currency resolution, in order
 *
 * URL → cookie → default. Explicitly **not** `Accept-Language` or geo-IP:
 * language is not currency (an `en-GB` browser in Lagos is a normal case for
 * this business, not an edge case), and both make the response vary on a header
 * — which poisons any shared cache and makes "copy the URL" stop working.
 */
export async function MarketplaceResults({
  searchParams,
  basePath,
  catalogue,
  forced,
  locked,
}: {
  searchParams: Promise<RawSearchParams>;
  basePath: string;
  /**
   * Which catalogue's grid this is — **required**, so a new surface cannot forget
   * it and quietly show both.
   *
   * A separate prop rather than part of `forced`, because it is not a *filter*: it
   * never appears in the URL, never counts toward the drawer badge, and cannot be
   * removed by the rail. `forced` is for a landing page pinning one of its own
   * dimensions.
   */
  catalogue: CatalogueScope;
  /** A landing page's own term, which the rail cannot remove. */
  forced?: { category?: string[]; industry?: string[] };
  locked?: ReadonlyArray<"category" | "industry" | "technology" | "productType">;
}) {
  const raw = await searchParams;
  const jar = await cookies();

  const currency = toStorefrontCurrency(
    firstOf(raw.currency) ?? jar.get(CURRENCY_COOKIE)?.value,
  );

  const query = parseMarketplaceQuery(raw, {
    currency,
    catalogue,
    ...(forced ? { forced } : {}),
  });

  const [result, taxonomy, vendorLabels] = await Promise.all([
    searchMarketplace(query),
    // Scoped, which is what stops one catalogue's rail advertising the other's
    // categories greyed out at zero.
    getTaxonomyIndex(catalogue),
    // Vendor ticket 11. Only for the slugs actually in the URL — a vendor is not a taxonomy,
    // so there is no index to read a name from, and listing every seller in the rail would be
    // a query on every render for a control nobody could scan.
    vendorNames(query.vendor ?? []),
  ]);

  // §74 — "log searches with zero results; that list is a product-roadmap
  // input". Deliberately not awaited into the render path: it is a business
  // input, and a slow write must not delay a page that already knows what it
  // is showing. `logZeroResultSearch` swallows its own failures.
  if (query.q && result.total === 0) {
    void logZeroResultSearch(query.q, {
      hadFilters:
        (query.category?.length ?? 0) +
          (query.industry?.length ?? 0) +
          (query.technology?.length ?? 0) >
        0,
    });
  }

  // §6's rails belong on the *unfiltered* listing only. Someone who has
  // filtered has told you what they want; pushing it below "Featured" shows
  // them something they did not ask for.
  const isBrowsing =
    !query.q &&
    !forced &&
    (query.category?.length ?? 0) === 0 &&
    (query.industry?.length ?? 0) === 0 &&
    (query.technology?.length ?? 0) === 0 &&
    !query.productType &&
    query.minPrice === undefined &&
    query.maxPrice === undefined &&
    query.customisable === undefined &&
    query.page === 1;

  /*
   * One element, two placements.
   *
   * Below `lg` the rail goes in a drawer and above it stays in the grid column. Assigning it once and
   * using the variable twice is the difference between two placements and two *call sites*: the rail
   * takes nine props, and a second `<FilterRail …/>` would be nine chances for the phone and the
   * desktop to start showing different filters.
   *
   * React renders it once per placement, and the hidden one costs nothing that matters — it is markup,
   * not queries. Every value it needs was already fetched above for the other placement.
   */
  const rail = (
    <FilterRail
      basePath={basePath}
      raw={raw}
      taxonomy={taxonomy}
      facetCounts={result.facetCounts}
      countableDimensions={result.countableDimensions}
      currency={currency}
      currencyInUrl={currencyMustBeInUrl(query)}
      vendorLabels={vendorLabels}
      {...(locked ? { locked } : {})}
    />
  );

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      {/* Above the results on a phone, so the grid is the first thing under the trigger rather than
          the last thing under a thousand pixels of filters.

          The `key` is how the drawer closes on navigation. It holds `open` in client state, and a
          key that changes with the query string remounts it back to closed — React's own answer to
          "reset state when a value changes", and it keeps the drawer ignorant of the URL. Doing it
          with a `useEffect` that calls `setState` is what the React Compiler lint refuses, and it
          would cascade a render to boot. */}
      <div className="lg:hidden">
        <FilterDrawer key={drawerKey(raw)} activeCount={activeFilterCount(raw)}>
          {rail}
        </FilterDrawer>
      </div>

      <div className="hidden lg:block">{rail}</div>

      <div className="flex flex-col gap-12">
        {isBrowsing && <DiscoveryRails catalogue={catalogue} />}
        <Results
          result={result}
          raw={raw}
          basePath={basePath}
          taxonomy={taxonomy}
          {...(query.q ? { query: query.q } : {})}
        />
      </div>
    </div>
  );
}

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A stable string that changes whenever the query does — the drawer's remount signal.
 *
 * Sorted, so `?a=1&b=2` and `?b=2&a=1` are one key: those are the same view, and remounting the
 * drawer between them would be a flicker with no cause. Built from `raw` rather than from
 * `URLSearchParams`, because `raw` is what this component was handed and going back to the request
 * would be a second source of truth for the same fact.
 */
function drawerKey(raw: RawSearchParams): string {
  return Object.entries(raw)
    .flatMap(([key, value]) =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(
        (item) => `${key}=${item}`,
      ),
    )
    .sort()
    .join("&");
}
