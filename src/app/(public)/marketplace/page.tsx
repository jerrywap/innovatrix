import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { CategoryBrowser } from "@/features/marketplace/components/category-browser";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { pageMetadata } from "@/lib/seo";
import { CATALOGUE_SURFACE } from "@/config/catalogue";

/*
 * The name comes from `CATALOGUE_SURFACE`, the `path` stays a literal.
 *
 * That asymmetry is deliberate rather than an oversight: `typedRoutes` checks a
 * literal and would need a cast for `listingPath`, which is a plain `string` —
 * and a cast is strictly less safe than the literal it replaces. Labels are the
 * thing that was drifting; routes were not.
 */
export const metadata: Metadata = pageMetadata({
  title: CATALOGUE_SURFACE.script.plural,
  description:
    "Ready-made software you can buy, adapt and install — CRMs, portals, booking systems and more, with the source included.",
  path: "/marketplace",
});

/**
 * The marketplace — §6, §74, §93, §94.
 *
 * ## Why the page itself never touches `searchParams`
 *
 * Under Cache Components, reading `searchParams` makes a component dynamic.
 * Reading it *here* would make the whole route dynamic and nothing would
 * prerender — the header, the heading and the search box would all wait on a
 * database round trip.
 *
 * So the promise is passed **down** into a Suspense boundary. The shell is
 * static and streams instantly; the grid and the rail arrive when the query
 * finishes. That is what the PPR line in the build output is reporting, and it
 * is why enabling Cache Components was worth doing before this ticket rather
 * than after.
 */
export default function Page({ searchParams }: PageProps<"/marketplace">) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={CATALOGUE_SURFACE.script.plural}
        description="Software that already exists, ready to buy, adapt and install."
      />

      {/* Its own boundary: `getTaxonomyIndex` is cached, but this must not
          hold up the header above it. */}
      <Suspense fallback={<Skeleton className="mt-6 h-[132px] w-full rounded-[26px]" />}>
        <CategoryBrowser catalogue="script" />
      </Suspense>

      {/*
        The search box and the filter button share a row.

        Two boundaries rather than one: each resolves on its own, so a slow
        taxonomy read cannot hold up the search input beside it. Neither runs the
        product query — that is `MarketplaceResults`, further down and behind its
        own boundary — which is what lets both of these paint with the shell.
      */}
      <div className="mt-6 flex max-w-[640px] items-center gap-2.5">
        <div className="min-w-0 flex-1">
          {/* Reads the query string via `useSearchParams`, so it needs its own
              boundary — a client component that suspends would otherwise take
              the static shell down with it. */}
          <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
            <SearchBox basePath="/marketplace" />
          </Suspense>
        </div>

        <Suspense fallback={<Skeleton className="h-11 w-[52px] rounded-xl sm:w-[104px]" />}>
          <FilterControls
            searchParams={searchParams}
            basePath={"/marketplace"}
            catalogue="script"
          />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            searchParams={searchParams}
            basePath="/marketplace"
            catalogue="script"
          />
        </Suspense>
      </div>
    </div>
  );
}
