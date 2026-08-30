import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaxonomyIndex, getTaxonomyTerm } from "@/services/marketplace";
import { termCounts } from "@/services/marketplace/term-counts";
import { isIndustryLandingIndexable } from "@/services/marketplace/taxonomy-tree";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * An industry landing page for templates — the answer to "logistics website
 * template", which nothing on this site could answer before.
 *
 * ## This deliberately departs from the ownership rule
 *
 * `categoryLandingPath` gives a `both`-scoped **category** exactly one home,
 * because two URLs would list identical rows and that is duplicate content
 * generated on purpose. Industries are the opposite case:
 * `/marketplace/industry/logistics` lists **scripts** and this lists
 * **templates**. Different inventory, different heading, different canonical.
 *
 * Applying the ownership rule here would have meant almost no template industry
 * page existing at all — `catalogue` defaults to `both`, so nearly every industry
 * would have been ruled out — which deletes the entire reason for the route.
 *
 * Two things keep the departure honest, and both are load-bearing:
 *
 * - **Its own default copy.** Reusing `Taxonomy.description` verbatim would give
 *   the two pages the same prose under different headings, which is the thin
 *   duplicate the ownership rule was guarding against, arriving by another door.
 *   A term with real seeded prose still uses it — that prose describes the
 *   industry, not the catalogue.
 * - **An inventory floor.** See `isIndustryLandingIndexable`. Below it the page
 *   renders — a link to it must never 404 — but it is `noindex, follow` with a
 *   self-canonical and absent from the sitemap.
 *
 * At starter scale that means most of these are `noindex`, and that is correct
 * rather than a failure: there are 135 templates in total. The vocabulary branch
 * is what fills them.
 *
 * The guard sits in the default export's body and no `loading.tsx` may be added
 * at or above this segment.
 */
export async function generateStaticParams() {
  const [taxonomy, { industry: industries }] = await Promise.all([
    getTaxonomyIndex("template"),
    termCounts("template"),
  ]);

  const worth = taxonomy.industry.filter((term) =>
    isIndustryLandingIndexable(industries.get(term.slug) ?? 0),
  );

  /*
   * Cache Components requires at least one param, and at starter scale there may
   * be no industry above the floor at all. `dynamicParams` is on, so anything
   * unlisted renders on demand — which is what a below-floor industry wants.
   */
  return worth.length > 0
    ? worth.map((term) => ({ slug: term.slug }))
    : [{ slug: "healthcare" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/templates/industry/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  // Scoped, like every other landing page here — an industry the template
  // catalogue cannot see must 404 rather than render an empty grid.
  const term = await getTaxonomyTerm("industry", slug, "template");
  if (!term) return { title: "Not found" };

  const { industry: industries } = await termCounts("template");
  const indexable = isIndustryLandingIndexable(industries.get(slug) ?? 0);

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} website templates`,
    description,
    alternates: { canonical: `/templates/industry/${slug}` },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: `${term.name} website templates`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/templates/industry/[slug]">) {
  const { slug } = await params;
  const term = await getTaxonomyTerm("industry", slug, "template");
  if (!term) notFound();

  const basePath = `/templates/industry/${slug}`;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} website templates`}
        description={term.description ?? defaultDescription(term.name)}
      />

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
            forced={{ industry: [slug] }}
            locked={["industry"]}
          />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="template"
            searchParams={searchParams}
            basePath={basePath}
            forced={{ industry: [slug] }}
            locked={["industry"]}
          />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Its own wording, not the marketplace page's.
 *
 * The two pages sit on the same term and must not read the same, or the
 * departure from the ownership rule produces the duplicate it was allowed in
 * order to avoid. "Software you install" versus "a front end you edit" is the
 * actual difference between the two catalogues, so that is what the sentence says.
 */
function defaultDescription(name: string): string {
  return `Website templates built for ${name.toLowerCase()} — pages, layouts and styling ready to edit, with the source included.`;
}
