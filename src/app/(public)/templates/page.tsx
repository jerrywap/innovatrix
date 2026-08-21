import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Templates",
  description:
    "Website and app templates — admin dashboards, ecommerce pages, corporate sites and landing pages, in Bootstrap, Tailwind and more.",
  path: "/templates",
});

/**
 * The template catalogue.
 *
 * ## Why this is a path and not `?catalogue=template`
 *
 * `robotsFor` allows two filter dimensions before a listing becomes a crawl trap
 * (`MAX_INDEXABLE_DIMENSIONS`). A query parameter would spend one of those two on
 * *every* template page, so the catalogue would be born with a one-filter SEO
 * budget — "Tailwind admin dashboards" would already be `noindex`. A path prefix
 * costs nothing, and it is what a domain move rewrites into.
 *
 * ## Same machinery, different catalogue
 *
 * Everything below is the marketplace's, with `catalogue="template"` passed
 * instead of `"script"`. That single prop scopes the grid, the facet counts, the
 * filter rail's *vocabulary*, the discovery rails and the cache key — which is
 * the argument for a first-class `catalogue` field rather than a taxonomy term.
 *
 * The shell stays static and `searchParams` is passed **down** into Suspense for
 * the same reason as the marketplace: reading it here would make the whole route
 * dynamic and nothing would prerender.
 */
export default function Page({ searchParams }: PageProps<"/templates">) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title="Templates"
        description="Front-ends you can drop in and make your own — dashboards, storefronts, corporate sites."
      />

      <div className="mt-6 max-w-[560px]">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
          <SearchBox basePath="/templates" />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            searchParams={searchParams}
            basePath="/templates"
            catalogue="template"
          />
        </Suspense>
      </div>
    </div>
  );
}
