import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaxonomyIndex, getTaxonomyTerm } from "@/services/marketplace";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A industry landing page — §7, §93.
 *
 * ## Why this is a page and not a filter shortcut
 *
 * §93 wants unique titles, descriptions and canonicals. A route that redirected
 * to `/marketplace?industry=crm` would have none of those, and Google would see
 * one page where the business wants twenty-eight.
 *
 * The copy comes from `Taxonomy.description`. Without a real description the
 * criterion fails with twenty-eight identical strings, so the fallback here is
 * written to at least be *specific* — it names the industry — while the seed
 * carries real prose.
 *
 * Technology and product-type deliberately have **no** landing pages: eight
 * thin pages with no unique copy is negative SEO, not more of it. They stay
 * filters.
 */
export async function generateStaticParams() {
  const taxonomy = await getTaxonomyIndex("script");
  // Cache Components requires at least one param, and an empty database at
  // build time would otherwise fail the build rather than skip prerendering.
  return taxonomy.industry.length > 0
    ? taxonomy.industry.map((term) => ({ slug: term.slug }))
    : [{ slug: "crm" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/industry/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const term = await getTaxonomyTerm("industry", slug);
  if (!term) return { title: "Not found" };

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} software`,
    description,
    alternates: { canonical: `/marketplace/industry/${slug}` },
    openGraph: { title: `${term.name} software`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/marketplace/industry/[slug]">) {
  const { slug } = await params;
  const term = await getTaxonomyTerm("industry", slug);
  if (!term) notFound();

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} software`}
        description={term.description ?? defaultDescription(term.name)}
      />

      {/*
        The search box and the filter button share a row.

        Two boundaries rather than one: each resolves on its own, so a slow
        taxonomy read cannot hold up the search input beside it. Neither runs the
        product query — that is `MarketplaceResults`, further down and behind its
        own boundary — which is what lets both of these paint with the shell.
      */}
      <div className="mt-6 flex max-w-[640px] items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
            <SearchBox basePath={`/marketplace/industry/${slug}`} />
          </Suspense>
        </div>

        <Suspense fallback={<Skeleton className="h-11 w-[52px] rounded-xl sm:w-[104px]" />}>
          <FilterControls
            searchParams={searchParams}
            basePath={`/marketplace/industry/${slug}`}
            catalogue="script"
            forced={{ industry: [slug] }}
            locked={["industry"]}
          />
        </Suspense>
      </div>

      <div className="mt-8">
        {/* The shared silhouette, not a bare block: the same content resolved out of two
            different shapes before, and only one of them matched the layout. */}
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="script"
            searchParams={searchParams}
            basePath={`/marketplace/industry/${slug}`}
            forced={{ industry: [slug] }}
            locked={["industry"]}
          />
        </Suspense>
      </div>
    </div>
  );
}

function defaultDescription(name: string): string {
  return `Ready-made ${name.toLowerCase()} software you can buy, adapt to your process and install — with the source included.`;
}
