import Link from "next/link";
import { categoryLandingPath } from "@/config/catalogue";
import type { Route } from "next";
import { SearchX } from "lucide-react";
import { AppendOnScroll } from "./append-on-scroll";
import { ProductCardTile } from "./product-card";
import { marketplaceHref, type RawSearchParams } from "@/services/marketplace/query";
import type { MarketplaceResult, TaxonomyIndex } from "@/services/marketplace";

/**
 * The grid, its empty state and its pagination.
 *
 * Rendered inside `<Suspense>` by the page, which is what lets the shell — the
 * header, the rail's skeleton, the heading — prerender under Cache Components
 * while this streams in. The page reads `searchParams`, so without the boundary
 * the whole route would be dynamic and nothing would prerender.
 */
export function Results({
  result,
  raw,
  basePath,
  taxonomy,
  query,
  appendSearch,
  catalogue,
}: {
  result: MarketplaceResult;
  raw: RawSearchParams;
  basePath: string;
  taxonomy: TaxonomyIndex;
  query?: string;
  /**
   * The listing's own query string, with a landing page's forced terms merged in
   * as ordinary parameters.
   *
   * Built by the caller because only it knows the forced terms — and merged into
   * the string rather than passed separately on purpose: `parseMarketplaceQuery`
   * trusts `forced` (it is the page's own decision, not the visitor's) and puts it
   * straight into an `$in`, so it must not be a value the client can supply.
   */
  appendSearch: string;
  catalogue: string;
}) {
  if (result.total === 0) {
    return <NoResults query={query} taxonomy={taxonomy} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        The grid lives inside `AppendOnScroll` so appended cards join the same
        grid and the layout stays continuous — a second grid below the first would
        restart the columns and leave a seam on any row that was not full.

        The numbered nav goes in as a **prop** rather than a sibling, because
        whether it is visible depends on how far appending has got, which only that
        component knows. It is still rendered here, on the server, on every
        request: what it loses is visibility while appending is working, not its
        place in the markup.
      */}
      <AppendOnScroll
        search={appendSearch}
        catalogue={catalogue}
        basePath={basePath}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pagination={<Pagination result={result} raw={raw} basePath={basePath} />}
      >
        {result.products.map((card, index) => (
          // The first card is the grid's LCP element, so it skips lazy-loading.
          <ProductCardTile key={card.id} card={card} priority={index === 0} />
        ))}
      </AppendOnScroll>
    </div>
  );
}

/**
 * §6: "empty-state suggests popular categories" — guidance, not an empty grid.
 *
 * A zero-result search is the one moment a visitor is most likely to leave, and
 * a blank rectangle tells them the catalogue is empty rather than that their
 * words did not match. The categories are real links to sets that are not
 * empty.
 */
function NoResults({ query, taxonomy }: { query?: string; taxonomy: TaxonomyIndex }) {
  return (
    <div className="border-border flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
      <SearchX className="text-subtle size-6" aria-hidden />

      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">
          {query ? `Nothing matches “${query}”` : "Nothing matches those filters"}
        </h2>
        <p className="text-muted-foreground max-w-[46ch] text-[13.5px]">
          {query
            ? "Try fewer words, or browse a category below. If we don't have it yet, we can build it."
            : "Try removing a filter — the categories below are a good place to start."}
        </p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {taxonomy.category.slice(0, 8).map((term) => (
          <li key={term.slug}>
            <Link
              /*
                `categoryLandingPath`, not a `/marketplace/category/` literal.
                This was a live dead end on `/templates`: `getTaxonomyIndex`
                returns template-scoped terms there, and a hardcoded
                `/marketplace/category/<template-slug>` does **not** 404 —
                `marketplace/category/[slug]` looks the term up with the default
                `"all"` scope, so it resolves and renders a real heading over a
                scripts-only grid. An empty page reached from an empty page.

                Byte-identical for `script` and `both` terms, so `/marketplace`
                is unchanged.
              */
              href={categoryLandingPath(term) as Route}
              className="border-border hover:bg-surface-muted rounded-full border px-3 py-1 text-[12.5px]"
            >
              {term.name}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href={"/custom-software" as Route}
        className="text-[13px] underline underline-offset-4"
      >
        Have something built instead →
      </Link>
    </div>
  );
}

/**
 * Numbered pages — always rendered, conditionally visible.
 *
 * This has been revised twice and the history is the useful part. It began as
 * "numbered pages, **not** infinite scroll", on reasoning that was right about
 * *why* the links matter and wrong to treat the two as alternatives. It then
 * became "alongside appending, and always visible", which is what shipped — and
 * which put a numbered nav, a "Show more" button and an auto-appending grid on one
 * screen, three controls competing to do one job.
 *
 * Now: rendered on the server on every request, so a crawler still walks deep
 * results (§93) and a no-JS visitor still gets working links, but `AppendOnScroll`
 * owns whether a hydrated visitor *sees* it — hidden while appending can continue,
 * revealed at the ceiling or on a failure, which is exactly when jumping to page
 * 40 becomes the useful thing again.
 *
 * The bounded page space is untouched and still deliberate — `$skip` past a
 * hundred pages is a collection scan, and an unbounded one is a crawl trap that
 * costs real money in database time. Appending does not widen it: it walks the
 * same pages, one at a time, and stops well short of the ceiling.
 */
function Pagination({
  result,
  raw,
  basePath,
}: {
  result: MarketplaceResult;
  raw: RawSearchParams;
  basePath: string;
}) {
  if (result.pageCount <= 1) return null;

  const pages = pageWindow(result.page, result.pageCount);

  return (
    <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
      {result.page > 1 && (
        <PageLink
          href={marketplaceHref(basePath, raw, { page: result.page - 1 })}
          label="Previous"
        />
      )}

      {pages.map((page, index) =>
        page === null ? (
          <span key={`gap-${index}`} className="text-subtle px-1 text-[12px]">
            …
          </span>
        ) : (
          <PageLink
            key={page}
            href={marketplaceHref(basePath, raw, { page })}
            label={String(page)}
            active={page === result.page}
          />
        ),
      )}

      {result.page < result.pageCount && (
        <PageLink
          href={marketplaceHref(basePath, raw, { page: result.page + 1 })}
          label="Next"
        />
      )}
    </nav>
  );
}

function PageLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={`border-border hover:bg-surface-muted min-w-9 rounded-lg border px-2.5 py-1.5 text-center font-mono text-[12px] ${
        active ? "border-[var(--signal)] text-[var(--signal)]" : ""
      }`}
    >
      {label}
    </Link>
  );
}

/** First, last, and a window around the current page — `null` marks a gap. */
function pageWindow(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const window = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...window].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const withGaps: Array<number | null> = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) withGaps.push(null);
    withGaps.push(page);
    previous = page;
  }

  return withGaps;
}
