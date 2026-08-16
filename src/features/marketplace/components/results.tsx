import Link from "next/link";
import type { Route } from "next";
import { SearchX } from "lucide-react";
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
}: {
  result: MarketplaceResult;
  raw: RawSearchParams;
  basePath: string;
  taxonomy: TaxonomyIndex;
  query?: string;
}) {
  if (result.total === 0) {
    return <NoResults query={query} taxonomy={taxonomy} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-subtle font-mono text-[11px] tracking-[0.08em]">
        {result.total} product{result.total === 1 ? "" : "s"}
        {result.pageCount > 1 ? ` · page ${result.page} of ${result.pageCount}` : ""}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.products.map((card, index) => (
          // The first card is the grid's LCP element, so it skips lazy-loading.
          <ProductCardTile key={card.id} card={card} priority={index === 0} />
        ))}
      </div>

      <Pagination result={result} raw={raw} basePath={basePath} />
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
              href={`/marketplace/category/${term.slug}` as Route}
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
 * Numbered pages, not infinite scroll.
 *
 * §93 needs crawlable links; infinite scroll gives a crawler one page. And a
 * bounded page space is deliberate — `$skip` past a hundred pages is a
 * collection scan, and an unbounded one is a crawl trap that costs real money
 * in database time.
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
