import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaxonomyIndex, getTaxonomyTerm } from "@/services/marketplace";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A category landing page — §7, §93.
 *
 * ## Why this is a page and not a filter shortcut
 *
 * §93 wants unique titles, descriptions and canonicals. A route that redirected
 * to `/marketplace?category=crm` would have none of those, and Google would see
 * one page where the business wants twenty-eight.
 *
 * The copy comes from `Taxonomy.description`. Without a real description the
 * criterion fails with twenty-eight identical strings, so the fallback here is
 * written to at least be *specific* — it names the category — while the seed
 * carries real prose.
 *
 * Technology and product-type deliberately have **no** landing pages: eight
 * thin pages with no unique copy is negative SEO, not more of it. They stay
 * filters.
 */
export async function generateStaticParams() {
  const taxonomy = await getTaxonomyIndex();
  // Cache Components requires at least one param, and an empty database at
  // build time would otherwise fail the build rather than skip prerendering.
  return taxonomy.category.length > 0
    ? taxonomy.category.map((term) => ({ slug: term.slug }))
    : [{ slug: "crm" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const term = await getTaxonomyTerm("category", slug);
  if (!term) return { title: "Not found" };

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} software`,
    description,
    alternates: { canonical: `/marketplace/category/${slug}` },
    openGraph: { title: `${term.name} software`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/marketplace/category/[slug]">) {
  const { slug } = await params;
  const term = await getTaxonomyTerm("category", slug);
  if (!term) notFound();

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} software`}
        description={term.description ?? defaultDescription(term.name)}
      />

      <div className="mt-6 max-w-[560px]">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-xl" />}>
          <SearchBox basePath={`/marketplace/category/${slug}`} />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <MarketplaceResults
            searchParams={searchParams}
            basePath={`/marketplace/category/${slug}`}
            forced={{ category: [slug] }}
            locked={["category"]}
          />
        </Suspense>
      </div>
    </div>
  );
}

function defaultDescription(name: string): string {
  return `Ready-made ${name.toLowerCase()} software you can buy, adapt to your process and install — with the source included.`;
}
