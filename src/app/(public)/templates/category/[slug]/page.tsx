import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaxonomyIndex, getTaxonomyTerm } from "@/services/marketplace";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A template category landing page — admin dashboards, ecommerce pages, corporate.
 *
 * ## One landing page per term, never two
 *
 * `generateStaticParams` lists only terms scoped **exactly** `template`. A `both`
 * term — an industry, a technology, or a category genuinely shared with scripts —
 * keeps its single landing page on `/marketplace` and appears here as a *filter*
 * instead. The rail always links to filter URLs rather than landing pages, so
 * nothing is lost by that, and two pages for one term would be duplicate content
 * we generated deliberately.
 *
 * ## Why templates get category pages when technology never did
 *
 * The decision recorded on the marketplace's own landing page is that technology
 * and product-type stay filters, because eight thin pages with no unique copy is
 * negative SEO. That still holds. These are `category`-kind terms with real
 * seeded prose behind them, which is exactly the distinction that comment draws —
 * not a reversal of it.
 */
export async function generateStaticParams() {
  const taxonomy = await getTaxonomyIndex("template");
  const owned = taxonomy.category.filter((term) => term.catalogue === "template");

  // Cache Components requires at least one param, and an empty database at build
  // time would otherwise fail the build rather than skip prerendering.
  return owned.length > 0
    ? owned.map((term) => ({ slug: term.slug }))
    : [{ slug: "admin-dashboards" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/templates/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const term = await getTaxonomyTerm("category", slug, "template");
  if (!term) return { title: "Not found" };

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} templates`,
    description,
    alternates: { canonical: `/templates/category/${slug}` },
    openGraph: { title: `${term.name} templates`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/templates/category/[slug]">) {
  const { slug } = await params;
  // Scoped, so a script-only category under `/templates/` 404s rather than
  // rendering an empty grid under a heading that looks real.
  const term = await getTaxonomyTerm("category", slug, "template");
  if (!term) notFound();

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} templates`}
        description={term.description ?? defaultDescription(term.name)}
      />

      <div className="mt-6 max-w-[560px]">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
          <SearchBox basePath={`/templates/category/${slug}`} />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="template"
            searchParams={searchParams}
            basePath={`/templates/category/${slug}`}
            forced={{ category: [slug] }}
            locked={["category"]}
          />
        </Suspense>
      </div>
    </div>
  );
}

function defaultDescription(name: string): string {
  return `${name} templates you can drop into your own project — the markup, the styling and the components, ready to make your own.`;
}
