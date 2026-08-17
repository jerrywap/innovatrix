import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Marketplace",
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
        title="Marketplace"
        description="Software that already exists, ready to buy, adapt and install."
      />

      <div className="mt-6 max-w-[560px]">
        {/* Reads the query string via `useSearchParams`, so it needs its own
            boundary — a client component that suspends would otherwise take
            the static shell down with it. */}
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
          <SearchBox basePath="/marketplace" />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults searchParams={searchParams} basePath="/marketplace" />
        </Suspense>
      </div>
    </div>
  );
}
