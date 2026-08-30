import type { Metadata } from "next";
import { Suspense } from "react";
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isReservedCatalogueSegment, productHref } from "@/config/catalogue";
import { getTaxonomyIndex } from "@/services/marketplace";
import { termCounts } from "@/services/marketplace/term-counts";
import { resolveProductSlug } from "@/services/marketplace/detail";
import {
  categoryBySlug,
  rootCategories,
  visibleRoots,
} from "@/services/marketplace/taxonomy-tree";
import { FilterControls } from "@/features/marketplace/filter-controls";
import { MarketplaceResults } from "@/features/marketplace/results-section";
import { CategoryBrowser } from "@/features/marketplace/components/category-browser";
import { ResultsSkeleton } from "@/features/marketplace/components/results-skeleton";
import { SearchBox } from "@/features/marketplace/components/search-box";

/**
 * A top-level category landing page — and the route that decides what a
 * one-segment `/marketplace/…` URL means now that products have left it.
 *
 * ## Why this is also the disambiguator
 *
 * Products moved to `/details/{slug}` so that a category could own
 * `/marketplace/{parent}`; Next allows one dynamic segment per level, so the two
 * could not share it. Everything already indexed at `/marketplace/{product-slug}`
 * therefore arrives *here*, and this page is what turns it into a 308. There is
 * no version of the move that does not include this file, which is why they
 * shipped together.
 *
 * ## The order of the four cases is load-bearing
 *
 * 1. **A root category → render.** Category wins any collision. Products and
 *    categories live in separate collections with separate unique indexes and
 *    there are no collisions today, by luck rather than design; if a product ever
 *    slugs itself `finance`, the category must keep the URL.
 * 2. **A live or renamed product → 308 to `/details/{current}`.** One query
 *    (`resolveProductSlug`) rather than two, because "is this a product" and "is
 *    this a product's old name" have the same answer: its current slug.
 * 3. **A child at parent depth → 308 up to its two-segment URL.** Two things
 *    need this. It is the forward-compatibility hook for the larger vocabulary,
 *    where a term gets re-parented and its old one-segment URL has to keep
 *    working. And it is the safety net for a `ProductDetail` cached before
 *    `parentSlug` existed, whose breadcrumb renders exactly this shape — without
 *    the redirect that is a 404 on the most-linked page on the site.
 * 4. **Anything else → 404.**
 *
 * ## Every decision resolves before the first `return`
 *
 * `loading-boundaries.test.ts` requires the guard in the default export's own
 * body when the page contains a `<Suspense>`, and the reason applies to
 * `permanentRedirect` just as much as to `notFound()`: a `NEXT_REDIRECT` thrown
 * from inside a boundary that has already flushed becomes a **client-side**
 * navigation under `200 OK`. That is the same status-code bug `authInterrupts`
 * and the no-`loading.tsx` rule both exist to prevent, and a 200 on a moved URL
 * throws away the ranking the 308 exists to carry.
 *
 * The cost is one `getTaxonomyIndex` — `"use cache"`, and already warm from
 * `MarketplaceResults` on the same request via its React `cache()` wrapper. The
 * product query is paid only on the miss path, which ends in a redirect or a 404
 * anyway. Guard first, stream second.
 *
 * **No `loading.tsx` may be added at or above this segment.**
 */
export async function generateStaticParams() {
  const [taxonomy, counts] = await Promise.all([
    getTaxonomyIndex("script"),
    termCounts("script"),
  ]);
  // Only the ones with something behind them. `dynamicParams` is on, so an empty
  // parent still renders on demand — it is simply not worth a build slot or a
  // sitemap entry until something is filed under it.
  const parents = visibleRoots(taxonomy, counts.category)
    .filter((term) => term.catalogue !== "template")
    // A category can never be slugged `category` or `industry` — those static
    // segments win the match, so its page would be unreachable. The write path
    // refuses them; this makes sure a row written before that guard existed is
    // not prerendered at a URL that will never route to it.
    .filter((term) => !isReservedCatalogueSegment(term.slug));

  // Cache Components requires at least one param, and an empty database at
  // build time would otherwise fail the build rather than skip prerendering.
  return parents.length > 0
    ? parents.map((term) => ({ parent: term.slug }))
    : [{ parent: "business-operations" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/[parent]">): Promise<Metadata> {
  const { parent } = await params;
  const taxonomy = await getTaxonomyIndex("script");
  const term = rootCategories(taxonomy).find((row) => row.slug === parent);
  if (!term) return { title: "Not found" };

  const { category: counts } = await termCounts("script");
  const populated = (counts.get(parent) ?? 0) > 0;

  const description = term.description ?? defaultDescription(term.name);

  return {
    title: `${term.name} software`,
    description,
    alternates: { canonical: `/marketplace/${parent}` },
    // Renders, but is not worth indexing until something is filed under it —
    // the same judgement `isChildLandingIndexable` makes one tier down, and a
    // self-canonical for the same reason: a canonical away from a noindex page
    // is a contradictory pair.
    ...(populated ? {} : { robots: { index: false, follow: true } }),
    openGraph: { title: `${term.name} software`, description, type: "website" },
  };
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/marketplace/[parent]">) {
  const { parent } = await params;

  const taxonomy = await getTaxonomyIndex("script");
  const term = rootCategories(taxonomy).find((row) => row.slug === parent);

  if (!term) {
    const current = await resolveProductSlug(parent);
    if (current) permanentRedirect(productHref(current) as Route);

    // A child that arrived one level too high — send it to its real address.
    const child = categoryBySlug(taxonomy, parent);
    if (child?.parentSlug) {
      permanentRedirect(`/marketplace/${child.parentSlug}/${child.slug}` as Route);
    }

    notFound();
  }

  const basePath = `/marketplace/${parent}`;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader
        title={`${term.name} software`}
        description={term.description ?? defaultDescription(term.name)}
      />

      {/*
        Two boundaries rather than one: each resolves on its own, so a slow
        taxonomy read cannot hold up the search input beside it. Neither runs the
        product query — that is `MarketplaceResults`, further down and behind its
        own boundary — which is what lets both of these paint with the shell.
      */}
      {/* Its own boundary: `getTaxonomyIndex` is cached, but this must not
          hold up the header above it. */}
      <Suspense fallback={<Skeleton className="mt-6 h-[132px] w-full rounded-[26px]" />}>
        <CategoryBrowser catalogue="script" active={parent} />
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
            forced={{ category: [parent] }}
            categoryRoot={parent}
          />
        </Suspense>
      </div>

      <div className="mt-8">
        {/*
          One forced term, not the parent plus its children — a product carries
          its category's parent in `facets` too, so `cat:{parent}` matches
          everything filed underneath. See `withAncestors` for why that is stored
          rather than expanded here: a forced list longer than
          `MAX_TERMS_PER_DIMENSION` diverges between page one and page two of the
          infinite scroll, because `appendSearch` flattens it back through
          `slugs()`.
        */}
        <Suspense fallback={<ResultsSkeleton />}>
          <MarketplaceResults
            catalogue="script"
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
  return `Ready-made ${name.toLowerCase()} software you can buy, adapt to your process and install — with the source included.`;
}
