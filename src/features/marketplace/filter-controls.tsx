import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { StorefrontCurrency } from "@/config/storefront";
import {
  activeFilterCount,
  currencyMustBeInUrl,
  marketplaceHref,
  parseMarketplaceQuery,
} from "@/services/marketplace/query";
import type { RawSearchParams } from "@/services/marketplace/query";
import { getTaxonomyIndex, searchMarketplace } from "@/services/marketplace";
import type { ParsedMarketplaceQuery } from "@/services/marketplace/query";
import type { TaxonomyIndex } from "@/services/marketplace";
import { vendorNames } from "@/services/marketplace/storefront";
import type { CatalogueScope } from "@/config/catalogue";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { FilterPanel, FilterTaxonomy } from "./components/filter-rail";
import { FilterPopover } from "./components/filter-popover";

/**
 * The filter button beside the search box, and everything behind it.
 *
 * ## Why this is separate from `MarketplaceResults`
 *
 * Both need `raw`, the currency and the taxonomy — but this one deliberately does
 * **not** run the search. `MarketplaceResults` is inside a Suspense boundary
 * because its query is slow and the shell should not wait for it; putting the
 * filter button in there too would mean the control next to the search box
 * appearing a beat after the search box itself, which reads as the page still
 * loading.
 *
 * So this renders from what is cheap: the parsed query string, the resolved
 * currency, and `getTaxonomyIndex`, which is `use cache`. No `searchMarketplace`,
 * which is the expensive one — and the only thing lost with it is the facet
 * counts, which is why the panel's term lists carry none. See `FilterPanel`.
 *
 * It still needs its own `<Suspense>` at the call site: `resolveStorefrontCurrency`
 * reads a cookie, and awaiting `searchParams` is dynamic by definition.
 *
 * ## The props mirror the results section's on purpose
 *
 * `catalogue`, `forced` and `locked` mean exactly what they mean there. A landing
 * page that pins its own category must pin it in both places, or the button would
 * offer a way out of a filter the page does not actually let go of.
 */
export async function FilterControls({
  searchParams,
  basePath,
  catalogue,
  forced,
  locked,
}: {
  searchParams: Promise<RawSearchParams>;
  basePath: string;
  catalogue: CatalogueScope;
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

  const [taxonomy, vendorLabels] = await Promise.all([
    // Scoped, which is what stops one catalogue's panel advertising the other's
    // categories.
    getTaxonomyIndex(catalogue),
    // Only for the slugs actually in the URL — there is no seller index to read,
    // and this is the label on the chip that lets you take the filter off again.
    vendorNames(query.vendor ?? []),
  ]);

  return (
    <FilterPopover activeCount={activeFilterCount(raw)}>
      <FilterPanel
        basePath={basePath}
        raw={raw}
        currency={currency}
        currencyInUrl={currencyMustBeInUrl(query)}
        // The *effective* sort, not `raw.sort`. The parser has already applied
        // the "searching ranks by relevance, browsing shows newest first" rule,
        // and deriving it a second time is how the two came to disagree.
        sort={query.sort}
        vendorLabels={vendorLabels}
        taxonomySlot={
          /*
           * Its own boundary, so the counts do not hold up the button.
           *
           * Everything above this point is cheap — a parsed query string, a
           * cookie, and `getTaxonomyIndex`, which is `use cache`. The counts are
           * not: they come from the search. Suspending only this part is what
           * lets the trigger paint with the static shell while the numbers
           * stream in behind it.
           */
          <Suspense fallback={<TaxonomySkeleton />}>
            <PanelTaxonomy
              query={query}
              raw={raw}
              taxonomy={taxonomy}
              basePath={basePath}
              currency={currency}
              {...(locked ? { locked } : {})}
            />
          </Suspense>
        }
      />
    </FilterPopover>
  );
}

/**
 * The term lists for the panel, with their counts.
 *
 * ## The second `searchMarketplace` is usually free
 *
 * `MarketplaceResults` runs the same search for the grid. This is not a second
 * query in the ordinary case: `searchMarketplace` normalises through `queryKey`
 * and answers from a `"use cache"` entry, so both callers hit the same one.
 *
 * The exception is free text, which bypasses that cache on purpose — `q` is
 * attacker-controlled and would make the key space unbounded — so a search *does*
 * cost a second aggregation. It is bounded and it is off the critical path: this
 * whole subtree is suspended, so nothing a visitor can see waits for it, and the
 * alternative was a panel that shows a term list with no numbers on the one
 * device where the sidebar is not there to supply them.
 */
async function PanelTaxonomy({
  query,
  raw,
  taxonomy,
  basePath,
  currency,
  locked,
}: {
  query: ParsedMarketplaceQuery;
  raw: RawSearchParams;
  taxonomy: TaxonomyIndex;
  basePath: string;
  currency: StorefrontCurrency;
  locked?: ReadonlyArray<"category" | "industry" | "technology" | "productType">;
}) {
  const result = await searchMarketplace(query);
  const currencyInUrl = currencyMustBeInUrl(query);

  return (
    <FilterTaxonomy
      raw={raw}
      taxonomy={taxonomy}
      facetCounts={result.facetCounts}
      countableDimensions={result.countableDimensions}
      hrefFor={(changes) =>
        marketplaceHref(basePath, raw, currencyInUrl ? { currency, ...changes } : changes)
      }
      {...(locked ? { locked } : {})}
    />
  );
}

/** Four groups, matching the term lists that replace them. */
function TaxonomySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ))}
    </div>
  );
}
