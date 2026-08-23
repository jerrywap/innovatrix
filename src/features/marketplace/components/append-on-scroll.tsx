"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { appendMarketplacePageAction } from "../append-actions";

/**
 * The grid, with the next page appended as you reach the bottom.
 *
 * ## The numbered links stay
 *
 * This does **not** replace `<Pagination>`, and that is three separate
 * guarantees, not one:
 *
 * 1. **The crawl path.** §93 wants crawlable links; a scroll listener gives a
 *    crawler one page.
 * 2. **No JavaScript.** Before this component hydrates — and if it never does —
 *    the page behaves exactly as it did before, because the first page and the
 *    links are both server-rendered.
 * 3. **Getting back.** Jumping to page 40, or returning to page 2 after a reload,
 *    is a thing appending cannot do at all.
 *
 * A control that a screen reader announces and a sighted keyboard user cannot see
 * is a worse story than a visible one, so the nav is not hidden either.
 *
 * ## Two bounds, both deliberate
 *
 * `MAX_AUTO_APPENDS` stops the automatic behaviour after three pages, so the
 * footer and the pagination nav remain reachable — an unbounded auto-append is a
 * page whose bottom recedes as you walk toward it, and everything down there
 * becomes unreachable by scrolling. After that a button takes over, which is an
 * explicit request rather than a guess.
 *
 * `MAX_APPENDED_PAGES` is the harder ceiling. `MAX_PAGE × MAX_LIMIT` is 4,800
 * cards, and §94's one non-negotiable rule is not loading thousands of products
 * into a browser.
 *
 * ## `replaceState`, not `pushState` and not `router.replace`
 *
 * `pushState` would turn Back into "un-scroll by one increment", N times over.
 * `router.replace` re-runs the server render, which is the whole cost being
 * avoided. `replaceState` keeps the address bar honest — copy the URL after
 * scrolling and you get the page you are looking at — at the cost of writing
 * `?page=3` while three pages are on screen.
 *
 * `?page=3` therefore still means **one** page of results when the URL is opened
 * fresh. Making it mean "pages 1 through 3" would unbound every cache entry and
 * turn a shared link into a 72-document read.
 *
 * Known limitation, written down rather than papered over: scroll restoration on
 * Back is approximate, because the appended pages are not in the restored
 * document.
 */

const MAX_AUTO_APPENDS = 3;
const MAX_APPENDED_PAGES = 5;

export function AppendOnScroll({
  children,
  search,
  catalogue,
  basePath,
  page,
  pageCount,
}: {
  /** The first page, server-rendered by `Results`. */
  children: React.ReactNode;
  /** The listing's own query string, forced terms included. */
  search: string;
  catalogue: string;
  basePath: string;
  page: number;
  pageCount: number;
}) {
  const [batches, setBatches] = useState<React.ReactNode[]>([]);
  const [nextPage, setNextPage] = useState(page + 1);
  const [autoAppends, setAutoAppends] = useState(0);
  const [pending, startTransition] = useTransition();

  const sentinel = useRef<HTMLDivElement | null>(null);

  const appended = batches.length;
  const exhausted = nextPage > pageCount || appended >= MAX_APPENDED_PAGES;
  const autoAllowed = autoAppends < MAX_AUTO_APPENDS;

  const load = useCallback(
    (automatic: boolean) => {
      const params = new URLSearchParams(search);
      params.set("page", String(nextPage));
      const query = params.toString();

      startTransition(async () => {
        const cards = await appendMarketplacePageAction(query, catalogue);
        // A malformed or empty answer must not advance the counter, or the
        // sentinel would walk silently to the end of the page space.
        if (!cards) return;

        setBatches((current) => [...current, cards]);
        setNextPage((current) => current + 1);
        if (automatic) setAutoAppends((current) => current + 1);

        // The address bar tells the truth about which page you are reading. See
        // the docblock on why this is `replaceState`.
        window.history.replaceState(null, "", `${basePath}?${query}`);
      });
    },
    [basePath, catalogue, nextPage, search],
  );

  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted || !autoAllowed || pending) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load(true);
      },
      // Start a page early, so the cards are usually there by the time the
      // bottom of the grid arrives rather than after a visible gap.
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [autoAllowed, exhausted, load, pending]);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
        {batches}
      </div>

      {/*
        What is on screen, for a screen reader.

        The visible count line above the grid is server-rendered and static, so it
        cannot report an append. This renders the identical sentence on the server
        and on the first client pass — `appended` is 0 in both — so there is no
        hydration mismatch, and then updates as pages arrive.

        Stated as a **page range**, not a card count. A count is the tempting
        version and it lies: on page 3 of 5, "showing 96 of 148" would be counting
        the two pages that were skipped past and are not on the screen at all.
      */}
      <span role="status" className="sr-only">
        {appended === 0
          ? `Page ${page} of ${pageCount}`
          : `Pages ${page} to ${page + appended} of ${pageCount}`}
      </span>

      {/*
        Zero height and no content: it exists to be scrolled past. `aria-hidden`
        because a screen-reader user is not scrolling, and the button below is
        their route to more results.
      */}
      {!exhausted && autoAllowed && <div ref={sentinel} aria-hidden className="h-px" />}

      {!exhausted && !autoAllowed && (
        /*
          Focus deliberately stays here after a click. The button persists rather
          than being replaced, so Shift+Tab from it lands on the last appended
          card — where a keyboard user wants to be. Moving focus to the *first*
          new card strands forward-Tab behind the cards already read, and doing it
          on an automatic append would yank focus with no user action at all,
          which is a WCAG 3.2.x failure.
        */
        <button
          type="button"
          onClick={() => load(false)}
          disabled={pending}
          className="border-border hover:bg-surface-muted focus-visible:ring-ring mx-auto rounded-full border px-4 py-2 text-[13px] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="mr-1.5 inline size-3.5 animate-spin" aria-hidden />
              Loading…
            </>
          ) : (
            "Show more products"
          )}
        </button>
      )}
    </>
  );
}
