import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchSurface } from "@/features/search/search-surface";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Search",
    description:
      "Search everything on CoSetup — applications, scripts and website templates, ranked together.",
    path: "/search",
  }),
  /*
   * `noindex, follow`, as a literal.
   *
   * Every URL under this route is a search result, so the decision is static and
   * does not vary by query — which is the one thing that would justify reaching
   * for `robotsFor`. That helper would have to read `searchParams` inside
   * `generateMetadata` to be worth calling, and reading it there makes the whole
   * route dynamic, which is exactly what the Suspense structure below exists to
   * avoid.
   *
   * `follow: true` because the links out of here — the two shelves, the category
   * chips, the cards — are all pages we do want crawled. Same shape as `/cart`.
   */
  robots: { index: false, follow: true },
};

/**
 * Search, across both catalogues — §74.
 *
 * ## Why this is not `/marketplace?q=`
 *
 * Because the two catalogues are two *surfaces*, and a search is a question that
 * does not know which shelf holds the answer. The home page's box has always
 * said "Search apps, scripts, templates…" and always landed on `/marketplace`,
 * which is scripts only — a placeholder promising something the destination
 * could not deliver. This route is the destination that can.
 *
 * One ranked list rather than two sections, deliberately: a template that
 * answers the question better than any script should outrank it, and grouping by
 * catalogue would smuggle catalogue-as-a-filter back in through the layout.
 * `CatalogueExits` is the way to narrow to one shelf if that is what you wanted.
 *
 * ## The shell is static; `searchParams` is passed down
 *
 * Same rule as the marketplace: reading `searchParams` here would make the whole
 * route dynamic and nothing would prerender. It goes into two boundaries — the
 * filter button, and `SearchSurface`, which decides between the landing and the
 * results *inside* its own boundary so the shell is identical either way.
 *
 * ## `SearchBox` is in `filter` mode
 *
 * Its default. On the home page it is `navigate` — a search takes you somewhere
 * else. Here you are already standing on the results, so a debounced
 * replace-in-place is the correct half of that split. It still degrades to a
 * plain `<form action="/search" method="get">`, which is what makes "visit
 * /search and type" work before hydration.
 */
export default function Page({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title="Search"
        description="Applications, scripts and website templates — all of it, in one result set."
      />

      <div className="mt-6 flex max-w-[640px] items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
            <SearchBox
              basePath="/search"
              inputId="search-page"
              label="Search everything on CoSetup"
              placeholder="Search apps, scripts, templates…"
            />
          </Suspense>
        </div>

        <Suspense fallback={<Skeleton className="h-11 w-[52px] rounded-xl sm:w-[104px]" />}>
          <FilterControls searchParams={searchParams} basePath={"/search"} catalogue="all" />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <SearchSurface searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
