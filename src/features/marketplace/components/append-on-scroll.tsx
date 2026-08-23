"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { appendMarketplacePageAction } from "../append-actions";

/**
 * The grid, with the next page appended as you reach the bottom.
 *
 * ## The numbered links are rendered, then hidden — they are not removed
 *
 * `<Pagination>` is still **server-rendered on every request**, which keeps two of
 * the three guarantees it always carried:
 *
 * 1. **The crawl path.** §93 wants crawlable links; a scroll listener gives a
 *    crawler one page. Hidden links are still discovered and followed.
 * 2. **No JavaScript.** Before this component hydrates — and if it never does —
 *    the nav is visible and the page behaves exactly as it did before.
 *
 * What changed is when a *hydrated* visitor sees it. Showing numbered pages
 * **and** a "Show more" button **and** an auto-appending grid is three controls
 * competing to do one job, and the first two are noise while the third is working.
 * So the nav is `hidden` while appending can still continue, and revealed the
 * moment it cannot — which is also the third guarantee, arriving exactly when it
 * becomes useful: at the ceiling, or on a failure, the numbered links are how you
 * go further or jump to page 40.
 *
 * **The trade, stated rather than buried.** While the nav is hidden, a
 * screen-reader user cannot jump to an arbitrary page; they get the same
 * scroll-driven appending everyone else does, and Tab does scroll. The
 * alternatives are worse: `sr-only` would give a control to a screen reader that a
 * sighted keyboard user cannot see, and keeping it visible is what made the page
 * read as three competing controls. The reveal-on-exhaustion is what stops this
 * being a dead end.
 *
 * ## One bound, not two
 *
 * `MAX_APPENDED_PAGES` is the whole limit. `MAX_PAGE × MAX_LIMIT` is 4,800 cards,
 * and §94's one non-negotiable rule is not loading thousands of products into a
 * browser. Six pages of results — the one you landed on plus five — is roughly
 * 144 cards, which is a lot of images and a sane place to hand back to the nav.
 *
 * There used to be a second, lower bound (`MAX_AUTO_APPENDS = 3`) that stopped the
 * *automatic* behaviour early and handed over to a button, on the reasoning that
 * an unbounded auto-append makes the footer recede as you walk toward it. That
 * reasoning is sound for an *unbounded* appender and does not apply here: the hard
 * ceiling already guarantees the bottom of the page is reachable, so the button
 * was buying nothing and cost a second control.
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

const MAX_APPENDED_PAGES = 5;

export function AppendOnScroll({
  children,
  search,
  catalogue,
  basePath,
  page,
  pageCount,
  total,
  pagination,
}: {
  /** The first page, server-rendered by `Results`. */
  children: React.ReactNode;
  /** The listing's own query string, forced terms included. */
  search: string;
  catalogue: string;
  basePath: string;
  page: number;
  pageCount: number;
  total: number;
  /**
   * The numbered nav, server-rendered by `Results` and owned here.
   *
   * A React node, not a render function — a function cannot cross the RSC
   * boundary (`AGENTS.md`), and this component only ever needs to decide whether
   * the markup is visible, never to build it.
   */
  pagination: React.ReactNode;
}) {
  const [batches, setBatches] = useState<React.ReactNode[]>([]);
  const [nextPage, setNextPage] = useState(page + 1);
  /**
   * Set when an append comes back with nothing.
   *
   * Without a button there is no manual retry, so a silent failure would leave a
   * visitor scrolling at a sentinel that never fires again and no way onward. This
   * turns that into exhaustion, which reveals the numbered nav — a dead end
   * becomes a working page with one more click in it.
   */
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const sentinel = useRef<HTMLDivElement | null>(null);

  const appended = batches.length;
  const exhausted = failed || nextPage > pageCount || appended >= MAX_APPENDED_PAGES;

  const load = useCallback(() => {
    const params = new URLSearchParams(search);
    params.set("page", String(nextPage));
    const query = params.toString();

    startTransition(async () => {
      const cards = await appendMarketplacePageAction(query, catalogue);
      // A malformed or empty answer must not advance the counter, or the sentinel
      // would walk silently to the end of the page space. It hands over to the
      // numbered nav instead of failing quietly.
      if (!cards) {
        setFailed(true);
        return;
      }

      setBatches((current) => [...current, cards]);
      setNextPage((current) => current + 1);

      // The address bar tells the truth about which page you are reading. See
      // the docblock on why this is `replaceState`.
      window.history.replaceState(null, "", `${basePath}?${query}`);
    });
  }, [basePath, catalogue, nextPage, search]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted || pending) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      // Start a page early, so the cards are usually there by the time the
      // bottom of the grid arrives rather than after a visible gap.
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [exhausted, load, pending]);

  return (
    <>
      {/*
        The count line, moved in here from `Results` and doubling as the live region.

        It has to live on this side of the boundary now. Server-rendered it said
        "page 4 of 37" and stayed saying it while five more pages appended
        underneath — the address bar, the grid and this line each claiming a
        different thing. One `role="status"` also replaces the separate `sr-only`
        span this used to need, so an append is announced once rather than twice.

        A **page range**, not a card count. A count is the tempting version and it
        lies: on page 4 of 37, "showing 144 of 881" would be counting the three
        pages that were skipped past and are not on the screen.

        Identical text on the server and on the first client pass — `appended` is 0
        in both — so there is no hydration mismatch.
      */}
      <p role="status" className="text-subtle font-mono text-[11px] tracking-[0.08em]">
        {total} product{total === 1 ? "" : "s"}
        {pageCount > 1 &&
          (appended === 0
            ? ` · page ${page} of ${pageCount}`
            : ` · pages ${page}–${page + appended} of ${pageCount}`)}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
        {batches}
      </div>

      {/*
        Zero height and no content: it exists to be scrolled past. `aria-hidden`
        because a screen-reader user is not scrolling — the `role="status"` above
        is what tells them a page arrived.
      */}
      {!exhausted && <div ref={sentinel} aria-hidden className="h-px" />}

      {/*
        Feedback while a page is in flight. With no button there is nothing else
        to put a spinner on, and a grid that pauses with no explanation reads as a
        page that has stopped working. `aria-hidden` for the same reason as the
        sentinel: the live region already announces the outcome, and announcing
        "loading" as well is two messages for one event.
      */}
      {pending && (
        <p aria-hidden className="text-muted-foreground flex justify-center py-2 text-[13px]">
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
          Loading more…
        </p>
      )}

      {/*
        Rendered every time, visible only when appending can go no further.

        `hidden` rather than conditional rendering: the markup has to reach a
        crawler and a no-JS visitor on every request, and `exhausted` is computed
        from the same props on the server and on the first client pass — `batches`
        is empty in both — so there is no hydration mismatch.
      */}
      <div hidden={!exhausted}>{pagination}</div>
    </>
  );
}
