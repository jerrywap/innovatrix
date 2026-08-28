import "server-only";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { activeFilterCount, type RawSearchParams } from "@/services/marketplace/query";
import { CatalogueExits } from "./catalogue-exits";
import { SearchLanding } from "./search-landing";

/**
 * The dynamic half of `/search` — one component, two pages.
 *
 * ## The branch is inside the boundary, not around it
 *
 * The page passes `searchParams` down rather than awaiting it, so the shell —
 * header, heading, search box — still prerenders. Deciding *here* which of the
 * two surfaces to render keeps that: the static half is identical either way and
 * only this subtree waits.
 *
 * ## `activeFilterCount`, not a hand-rolled "is anything set"
 *
 * It counts `FILTER_KEYS`, which includes `q` and excludes sort, page and
 * currency — exactly the question being asked, and exactly the number the filter
 * button badges. Re-deriving it here is how the two would come to disagree about
 * whether arriving with only a `sort` counts as a search.
 *
 * ## What this settles for free
 *
 * `MarketplaceResults` renders `DiscoveryRails` when `isBrowsing` — no query, no
 * filters. On `/search` that branch is now unreachable, because with nothing set
 * we render the landing instead. That is wanted rather than incidental: the
 * "Most bought" rail hardcodes `/marketplace?sort=popular`, a scripts-only
 * destination that would be a visible leak under `catalogue="all"`.
 */
export async function SearchSurface({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;

  if (activeFilterCount(raw) === 0) return <SearchLanding />;

  const q = typeof raw.q === "string" ? raw.q : Array.isArray(raw.q) ? raw.q[0] : undefined;

  return (
    <div className="flex flex-col gap-8">
      <CatalogueExits {...(q ? { q } : {})} />

      {/*
        The same promise, not a re-wrap: `MarketplaceResults` awaits it itself,
        and handing it the resolved object would mean changing its contract for
        one caller.

        `catalogue="all"` is the whole point of this route. The parser takes it
        from options and never from the URL, so omitting it here would silently
        make `/search` a second scripts listing — which is the failure the prop
        being required exists to prevent.
      */}
      <MarketplaceResults searchParams={searchParams} basePath="/search" catalogue="all" />
    </div>
  );
}
