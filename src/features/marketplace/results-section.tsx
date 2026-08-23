import "server-only";
import { getTaxonomyIndex, searchMarketplace } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
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
 * ## Currency
 *
 * Resolved once, here, and passed **down** — including to `DiscoveryRails`, which
 * used to read the cookie for itself and so showed £ beside a ₦ grid on
 * `?currency=NGN`. The policy that used to be described in this docblock now lives
 * with the function that implements it, in `services/marketplace/currency.ts`.
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
  const currency = await resolveStorefrontCurrency(raw.currency);

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
        {/* The currency travels as a prop. One resolution per request means the
            rails and the grid cannot quote different currencies — which they did,
            on the same page, for every visitor who switched. */}
        {isBrowsing && <DiscoveryRails catalogue={catalogue} currency={currency} />}
        <Results
          result={result}
          raw={raw}
          basePath={basePath}
          taxonomy={taxonomy}
          appendSearch={appendSearch(raw, forced)}
          catalogue={catalogue}
          {...(query.q ? { query: query.q } : {})}
        />
      </div>
    </div>
  );
}

/**
 * A stable string that changes whenever the query does — the drawer's remount signal.
 *
 * Sorted, so `?a=1&b=2` and `?b=2&a=1` are one key: those are the same view, and remounting the
 * drawer between them would be a flicker with no cause. Built from `raw` rather than from
 * `URLSearchParams`, because `raw` is what this component was handed and going back to the request
 * would be a second source of truth for the same fact.
 */
/**
 * The query string the append action is given.
 *
 * A landing page pins its own term through `forced`, which never appears in the
 * URL — so an append built from `raw` alone would widen the results to the whole
 * catalogue the moment somebody scrolled a category page.
 *
 * Merged into the string rather than passed to the action as options, and that is
 * the security-relevant half: `parseMarketplaceQuery` deliberately **bypasses**
 * `slugs()` for `forced`, because it is the page's own decision rather than the
 * visitor's, and the value lands in an `$in`. Arriving as an ordinary parameter it
 * goes through the slug regex and the per-dimension cap like anything else.
 *
 * `page` is left out: the client sets it per batch, and carrying the current one
 * would make the first append re-fetch the page already on screen.
 */
function appendSearch(
  raw: RawSearchParams,
  forced?: { category?: string[]; industry?: string[] },
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(raw)) {
    if (key === "page" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }

  // Duplicates are harmless — `facetMatch` de-duplicates into a set — so this
  // needs no membership check, and a check is the kind of thing that goes stale.
  for (const slug of forced?.category ?? []) params.append("category", slug);
  for (const slug of forced?.industry ?? []) params.append("industry", slug);

  return params.toString();
}

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
