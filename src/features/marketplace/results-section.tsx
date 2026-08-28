import "server-only";
import { getTaxonomyIndex, searchMarketplace } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import {
  currencyMustBeInUrl,
  parseMarketplaceQuery,
  type RawSearchParams,
} from "@/services/marketplace/query";
import { logZeroResultSearch } from "@/services/marketplace/saved";
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

  const [result, taxonomy] = await Promise.all([
    searchMarketplace(query),
    // Scoped, which is what stops one catalogue's rail advertising the other's
    // categories greyed out at zero.
    getTaxonomyIndex(catalogue),
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
   * One placement now, not two.
   *
   * The rail used to be assigned once and rendered twice — in the grid column above `lg` and inside a
   * drawer below it. The drawer is gone: the filter button beside the search box carries the taxonomy
   * on a phone (see `FilterPanel`), so there is one sidebar, at one breakpoint.
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
      {...(locked ? { locked } : {})}
    />
  );

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      {/*
        Sticky, with its own scroll — and the classes are here rather than on the
        rail's own `<aside>` for two reasons, both load-bearing.

        **This is the grid item.** `self-start` only means anything on a grid
        child; without it the item stretches to the row height, which both defeats
        `max-h` and leaves `sticky` with nothing to travel through.

        **The same `<aside>` element is also rendered inside the drawer** — one
        element, two placements, see the comment above `rail`. Any `lg:` class put
        on it would ship into the Sheet too. Inert today, because the drawer is
        `lg:hidden`, but "inert because a sibling hides it" is the kind of
        coupling that breaks the next time somebody moves a breakpoint.

        `lg:top-24` is the offset every sticky aside in this codebase uses and
        clears the 67px sticky header; the max-height/overflow trio is the tall
        variant, copied from `assistant.tsx` rather than reinvented.
        `overscroll-contain` is what stops a flick inside the rail scrolling the
        page behind it.

        One consequence to know: the rail is now capped, so anything past roughly
        the fifth section needs scrolling *inside* it. That is why the section
        order puts the escape hatch and the price at the top.
      */}
      <div className="scrollbar-on-hover hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
        {rail}
      </div>

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
