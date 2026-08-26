"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The hero search, made persistent — it travels with the hero, locks under the
 * nav, and comes back when you scroll into the hero again.
 *
 * ## This reverses a decision the hero wrote down
 *
 * `hero.tsx` says "Static, as asked: no parallax, no scroll coupling. A hero that
 * moves under a headline fights the headline." That still holds for the *media*,
 * and parallax is still refused. What this adds is not continuous scroll-linked
 * motion but a **discrete state change** — docked or not — of one control, which is
 * a different thing and answers `prefers-reduced-motion` by docking instantly
 * rather than sliding.
 *
 * ## One node that moves, not two that swap
 *
 * The search is rendered once and this wrapper changes where it sits. Two copies —
 * an inline one and a docked one — was the obvious alternative and is worse in
 * three ways: `SearchBox`'s `inputId` exists because "two boxes on one page must not
 * share a label", two visible inputs both named "Search the marketplace" is its own
 * accessibility problem, and the text someone had typed would not survive the
 * handover because `SearchBox` keeps its value in component state.
 *
 * The slot keeps its measured height while docked, so detaching the bar does not
 * pull the rest of the hero up by 52px.
 *
 * ## Why `fixed` and not `sticky`
 *
 * The hero `<section>` is `overflow-hidden` — it has to be, it clips the
 * photograph layer and its bleeding gradients. A `sticky` child of an
 * `overflow-hidden` ancestor appears to stick and then vanishes at the section's
 * edge, which looks like a z-index bug. `overflow` does not clip a `fixed`
 * descendant, and nothing above the hero establishes a containing block for one.
 * **That is the fragile part of this component**: a `transform`, `filter`,
 * `backdrop-filter`, `perspective` or `contain: paint` added to any ancestor would
 * re-anchor the bar to that element with no compile error.
 *
 * `z-30` because the band 21–39 is unused, the hero's own ceiling is `z-20`, and the
 * public header is `z-50` — so the bar passes *under* the nav. Radix overlays are
 * portalled to `<body>`, so a sheet or dialog still buries it for free.
 *
 * ## What it does not own
 *
 * No filter state, no knowledge of the URL. The panel arrives as a server-rendered
 * `ReactNode` whose every control is a link, which is what keeps filtering working
 * before hydration. Same split as `FilterDrawer`, for the same reason.
 */
export function HeroSearch({
  panel,
  children,
}: {
  /** The filter panel, server-rendered. See `HeroFilters`. */
  panel: React.ReactNode;
  /** The search control itself, already inside its own `<Suspense>`. */
  children: React.ReactNode;
}) {
  const panelId = useId();
  const slot = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  const [docked, setDocked] = useState(false);
  const [open, setOpen] = useState(false);
  /** The header's measured height — the line the bar docks against. */
  const [offset, setOffset] = useState(67);
  /** The height to hold open once the bar leaves the flow. */
  const [slotHeight, setSlotHeight] = useState<number>();

  useEffect(() => {
    const mark = sentinel.current;
    if (!mark) return;

    /*
     * Measured, not hard-coded.
     *
     * The header is 67px today — a 38px account button, `py-3.5`, and a 1px border —
     * and stable across breakpoints because the mobile-nav trigger it swaps in is
     * shorter than the button. But nothing in the repo encodes that: the three
     * sticky sidebars all just repeat `lg:top-24`. Reading it once keeps the dock
     * correct through a header redesign, and one value feeds both the observer's
     * boundary and the bar's `top`.
     */
    const header = document.querySelector("header");
    const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 67;
    setOffset(headerHeight);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        /*
         * Read the geometry, not `isIntersecting`.
         *
         * `!isIntersecting` is also true when the sentinel is *below* the fold, so
         * on a short viewport it would dock the bar on load. The observer fires
         * immediately on `observe()`, which is what settles the state for a reload
         * halfway down the page or a restored scroll position — the bar is docked on
         * first paint rather than undocked and then corrected.
         */
        setDocked(entry.boundingClientRect.top < headerHeight);
      },
      // The boundary is the nav's lower edge, so the handover happens exactly as
      // the search's top reaches it.
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: [0, 1] },
    );

    observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  // Freeze the height before the bar leaves the flow, so nothing below it jumps.
  useEffect(() => {
    const node = slot.current;
    if (!node || docked) return;
    setSlotHeight(node.getBoundingClientRect().height);
  }, [docked]);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  /*
   * A disclosure, not a modal: Escape closes and returns focus to the trigger, a
   * press outside closes it, and focus is neither trapped nor moved on open — Tab
   * reaches the panel naturally, which is the right behaviour for a disclosure and
   * far less machinery than a Popover. `pointerdown` rather than `click` so a drag
   * that starts outside does not leave the panel open under the cursor.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!shell.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  return (
    <div ref={slot} style={docked && slotHeight ? { height: slotHeight } : undefined}>
      {/* Zero-height, at the top of the slot: the boundary is the search's top edge. */}
      <div ref={sentinel} aria-hidden className="h-px" />

      <div
        ref={shell}
        className={cn(
          "no-print",
          docked
            ? // `animate-in`, not `transition`. `position` is not an animatable
              // property, so a transition here would be inert — the bar would
              // appear instantly and the classes would be a comment that lies.
              // A CSS animation *does* run when its class is applied to an element
              // that is already mounted, which is exactly this state change.
              // `motion-reduce:animate-none` lands it in its final position with no
              // movement, matching the marquee's treatment one band below.
              "border-border bg-background/85 animate-in slide-in-from-top-2 fixed inset-x-0 z-30 border-b backdrop-blur-xl duration-200 motion-reduce:animate-none"
            : "relative",
        )}
        style={docked ? { top: offset } : undefined}
      >
        <div
          className={cn(
            docked
              ? "mx-auto flex max-w-[1400px] items-center gap-2 px-5 py-2.5 lg:px-10"
              : "flex items-center gap-2",
          )}
        >
          <div className="min-w-0 flex-1">{children}</div>

          <button
            ref={trigger}
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={panelId}
            className="border-border bg-surface hover:border-border-strong text-muted-foreground hover:text-foreground inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition"
          >
            {open ? (
              <X className="size-4" aria-hidden />
            ) : (
              <SlidersHorizontal className="size-4" aria-hidden />
            )}
            <span className="hidden sm:inline">Filters</span>
          </button>

          {/*
            Only in the docked bar. Inline, the hero already offers this three
            times — a path card, the vendor line's neighbour and the eyebrow — and a
            fourth would be noise; once the hero has scrolled away, none of them are
            on screen.
          */}
          {docked && (
            <Link
              href="/custom-software"
              className="bg-signal text-signal-contrast hidden h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[13px] font-medium transition hover:opacity-90 md:inline-flex"
            >
              <Sparkles className="size-4" aria-hidden />
              Request a custom build
            </Link>
          )}
        </div>

        {/*
          Overlaid, never in flow — "without disrupting the hero flow" means the
          page must not reflow when this opens. `absolute` inside the docked bar's
          own box works in both states because the parent is `relative` when inline
          and `fixed` when docked.

          `max-h` plus its own scroll rather than a sheet on mobile: one code path,
          one set of keyboard behaviour, and the curated set rarely needs to scroll.
        */}
        {open && (
          <div
            className={cn(
              "absolute top-full z-30 mt-2",
              // Docked, it lines up with the bar's own container rather than the
              // viewport — on a wide screen `inset-x-0` alone would leave the panel
              // 440px wider than the row it hangs from.
              docked ? "inset-x-0" : "left-0 w-[min(44rem,calc(100vw-2.5rem))]",
            )}
          >
            <div className={cn(docked && "mx-auto max-w-[1400px] px-5 lg:px-10")}>
              <div
                id={panelId}
                className="border-border bg-surface shadow-float max-h-[min(70vh,32rem)] overflow-y-auto rounded-2xl border p-5 lg:p-6"
              >
                {panel}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
