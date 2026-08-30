import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isReservedCatalogueSegment } from "@/config/catalogue";
import { getTaxonomyIndex } from "@/services/marketplace";
import { termCounts } from "@/services/marketplace/term-counts";
import { rootCategories, visibleRoots } from "@/services/marketplace/taxonomy-tree";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { CategoryBrowser } from "@/features/marketplace/components/category-browser";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A top-level template-category landing page — the `/templates` twin of
 * `/marketplace/[parent]`.
 *
 * ## Why this one has no disambiguator
 *
 * Its marketplace counterpart also answers `/marketplace/{old-product-slug}` with
 * a 308, because that is where every indexed product URL points. `/templates` was
 * never a product's home: `CATALOGUE_SURFACE.template.productPath` was
 * `/marketplace` before the move and is `/details` after it, so there is nothing
 * at this depth to redirect. Adding a lookup "for symmetry" would be a query that
 * can only ever return null.
 *
 * ## Ownership, unchanged
 *
 * Only a `template`-scoped term gets a page here. A `both` category keeps its
 * single home on `/marketplace` and appears under `/templates` as a *filter* —
 * `categoryLandingPath` carries that rule and the sitemap splits on it. Two pages
 * listing the same rows would be duplicate content we generated deliberately.
 *
 * The guard sits in the default export's body, and no `loading.tsx` may be added
 * at or above this segment — `loading-boundaries.test.ts` holds both halves.
 */
export async function generateStaticParams() {
  const [taxonomy, counts] = await Promise.all([
    getTaxonomyIndex("template"),
    termCounts("template"),
  ]);
  // Only the ones with something behind them. `dynamicParams` is on, so an empty
  // parent still renders on demand — it is simply not worth a build slot or a
  // sitemap entry until something is filed under it.
  const parents = visibleRoots(taxonomy, counts.category)
    .filter((term) => term.catalogue === "template")
    .filter((term) => !isReservedCatalogueSegment(term.slug));

  // Cache Components requires at least one param, and an empty database at build
  // time would otherwise fail the build rather than skip prerendering.
  return parents.length > 0
    ? parents.map((term) => ({ parent: term.slug }))
    : [{ parent: "admin-application-ui" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/templates/[parent]">): Promise<Metadata> {
  const { parent } = await params;
  const taxonomy = await getTaxonomyIndex("template");
  const term = rootCategories(taxonomy).find(
    (row) => row.slug === parent && row.catalogue === "template",
  );
  if (!term) return { title: "Not found" };

  const { category: counts } = await termCounts("template");
  const populated = (counts.get(parent) ?? 0) > 0;

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} templates`,
    description,
    alternates: { canonical: `/templates/${parent}` },
    // Renders, but is not worth indexing until something is filed under it —
    // the same judgement `isChildLandingIndexable` makes one tier down, and a
    // self-canonical for the same reason: a canonical away from a noindex page
    // is a contradictory pair.
    ...(populated ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: `${term.name} templates`, description, type: "website" },
  };
}

export default async function Page({ params, searchParams }: PageProps<"/templates/[parent]">) {
  const { parent } = await params;

  const taxonomy = await getTaxonomyIndex("template");
  // Scoped and root-only, so a script category — or a child — 404s here rather
  // than rendering an empty grid under a heading that looks real.
  const term = rootCategories(taxonomy).find(
    (row) => row.slug === parent && row.catalogue === "template",
  );
  if (!term) notFound();

  const basePath = `/templates/${parent}`;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} templates`}
        description={term.description ?? defaultDescription(term.name)}
      />

      {/* Its own boundary: `getTaxonomyIndex` is cached, but this must not
          hold up the header above it. */}
      <Suspense fallback={<Skeleton className="mt-6 h-[132px] w-full rounded-[26px]" />}>
        <CategoryBrowser catalogue="template" active={parent} />
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
            catalogue="template"
            forced={{ category: [parent] }}
            categoryRoot={parent}
          />
        </Suspense>
      </div>

      <div className="mt-8">
        {/* One forced term — the ancestor facet matches everything filed under it. */}
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="template"
            searchParams={searchParams}
            basePath={basePath}
            forced={{ category: [parent] }}
            categoryRoot={parent}
          />
        </Suspense>
      </div>
    </div>
  );
}

function defaultDescription(name: string): string {
  return `${name} website templates you can buy, edit and launch — responsive, and the source is yours.`;
}
