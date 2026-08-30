import type { Metadata } from "next";
import { Suspense } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaxonomyIndex } from "@/services/marketplace";
import { termCounts } from "@/services/marketplace/term-counts";
import {
  categoryBySlug,
  childrenOf,
  isChildLandingIndexable,
  rootCategories,
} from "@/services/marketplace/taxonomy-tree";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { CategoryBrowser } from "@/features/marketplace/components/category-browser";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A child-category landing page — the long tail of the two-tier scheme.
 *
 * `/marketplace/logistics-mobility/fleet-management` is the URL somebody typing
 * "fleet management software" can actually land on, and the reason the vocabulary
 * grew a second tier at all.
 *
 * ## The pair has to be real, not just both valid
 *
 * `parent` and `child` are checked *against each other*: a child filed under a
 * different parent 404s here rather than rendering at a URL that misdescribes it.
 * Without that, every child would be reachable under every parent — a full cross
 * product of duplicate pages, all returning 200.
 *
 * ## Not every child gets indexed
 *
 * See `isChildLandingIndexable`. Below the floor — or where the child *is* the
 * whole parent — this page still renders, because a link to it must never 404,
 * but it is `noindex, follow` with a self-canonical and absent from the sitemap.
 * A self-canonical rather than one pointing at the parent: Google discards a
 * canonical on a noindex page, and the noindex can travel to the target.
 *
 * The guard sits in the default export's body and no `loading.tsx` may be added
 * at or above this segment — `loading-boundaries.test.ts` holds both halves.
 */
export async function generateStaticParams() {
  const [taxonomy, { category: counts }] = await Promise.all([
    getTaxonomyIndex("script"),
    termCounts("script"),
  ]);

  /*
   * Real pairs read off the tree, never `parents.flatMap(p => children.map(...))`.
   * The cross product is the obvious thing to write and most of it is 404s.
   */
  const pairs = rootCategories(taxonomy)
    .filter((parent) => parent.catalogue !== "template")
    .flatMap((parent) =>
      childrenOf(taxonomy, parent.slug)
        .filter((child) =>
          isChildLandingIndexable({
            childCount: counts.get(child.slug) ?? 0,
            parentCount: counts.get(parent.slug) ?? 0,
          }),
        )
        .map((child) => ({ parent: parent.slug, child: child.slug })),
    );

  /*
   * Cache Components requires at least one param. Unlike the other landing
   * routes the fallback cannot be a real slug — at starter scale there may be no
   * indexable child at all, and every child of a one-child parent is correctly
   * excluded. `dynamicParams` is on, so anything unlisted renders on demand,
   * which is exactly what a below-floor child wants.
   */
  return pairs.length > 0 ? pairs : [{ parent: "business-operations", child: "crm" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/[parent]/[child]">): Promise<Metadata> {
  const { parent, child } = await params;
  const taxonomy = await getTaxonomyIndex("script");
  const term = categoryBySlug(taxonomy, child);
  if (!term || term.parentSlug !== parent) return { title: "Not found" };

  const { category: counts } = await termCounts("script");
  const indexable = isChildLandingIndexable({
    childCount: counts.get(child) ?? 0,
    parentCount: counts.get(parent) ?? 0,
  });

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} software`,
    description,
    // Self, always. A canonical to the parent on a noindex page is a
    // contradictory pair, and the products here are real.
    alternates: { canonical: `/marketplace/${parent}/${child}` },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: `${term.name} software`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/marketplace/[parent]/[child]">) {
  const { parent, child } = await params;

  const taxonomy = await getTaxonomyIndex("script");
  const term = categoryBySlug(taxonomy, child);
  // The pair, not the two halves — see the note above.
  if (!term || term.parentSlug !== parent) notFound();

  const parentTerm = categoryBySlug(taxonomy, parent);
  const basePath = `/marketplace/${parent}/${child}`;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      {/*
        Up one level, on every child page. This is half of the internal-linking
        graph the two-tier scheme exists to build — the parent lists its children,
        each child links back.
      */}
      {parentTerm && (
        <Link
          href={`/marketplace/${parent}` as Route}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mb-4 inline-flex items-center gap-1.5 rounded text-[13px] focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All {parentTerm.name.toLowerCase()} software
        </Link>
      )}

      <PageHeader
        title={`${term.name} software`}
        description={term.description ?? defaultDescription(term.name)}
      />

      {/* Its own boundary: `getTaxonomyIndex` is cached, but this must not
          hold up the header above it. */}
      <Suspense fallback={<Skeleton className="mt-6 h-[132px] w-full rounded-[26px]" />}>
        <CategoryBrowser catalogue="script" active={child} />
      </Suspense>

      <div className="mt-6 flex max-w-[640px] items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
            <SearchBox basePath={basePath} />
          </Suspense>
        </div>

        <Suspense fallback={<Skeleton className="h-11 w-[52px] rounded-xl sm:w-[104px]" />}>
          <FilterControls
            searchParams={searchParams}
            basePath={basePath}
            catalogue="script"
            forced={{ category: [child] }}
            categoryRoot={parent}
            activeCategory={child}
          />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="script"
            searchParams={searchParams}
            basePath={basePath}
            forced={{ category: [child] }}
            categoryRoot={parent}
            activeCategory={child}
          />
        </Suspense>
      </div>
    </div>
  );
}

function defaultDescription(name: string): string {
  return `Ready-made ${name.toLowerCase()} software you can buy, adapt to your process and install — with the source included.`;
}
