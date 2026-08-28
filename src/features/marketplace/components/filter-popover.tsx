"use client";

import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The one filter control, beside the search box.
 *
 * ## Why a popover and not the drawer it replaces
 *
 * There used to be a `Sheet` below `lg` and a permanent sidebar above it — two
 * mechanisms, two places to keep in agreement, and a desktop sidebar that had to
 * carry every control because it was the only one there. Sort, price and currency
 * are single decisions rather than lists you scan, so they cost a click to reach
 * and nothing to ignore. One button now serves every width, and the sidebar keeps
 * only what a sidebar is good at.
 *
 * ## The panel is server-rendered
 *
 * Everything inside is passed as `children` from a Server Component — the term
 * lists, the GET forms, the hrefs. This component owns exactly one thing, the
 * open boolean, which is the only part that has to be client-side. That is what
 * keeps the rail's "works before hydration" property: with JavaScript off the
 * button does nothing, but nothing inside it was reachable by a click anyway, and
 * every filter remains reachable by URL.
 *
 * ## Its own scroll, on a phone
 *
 * The panel carries the taxonomy below `lg`, so it can be taller than a small
 * viewport. `max-h` against `--radix-popover-content-available-height` is Radix's
 * own measurement of the space between the trigger and the viewport edge, so the
 * panel never runs off the bottom and never needs the page to scroll behind it.
 */
export function FilterPopover({
  activeCount,
  children,
}: {
  /** Badged on the trigger, so a collapsed panel still says how many are on. */
  activeCount: number;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-ring flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-[13.5px] focus-visible:ring-2 focus-visible:outline-none"
        aria-label={
          activeCount > 0 ? `Filters and sort, ${activeCount} active` : "Filters and sort"
        }
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        <span className="hidden sm:inline">Filters</span>
        {activeCount > 0 && (
          <span
            aria-hidden
            className="bg-signal text-signal-contrast grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10.5px]"
          >
            {activeCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        // Wider than the default `w-72`, and capped rather than fixed: on a phone
        // it fills the viewport minus a gutter, on a laptop it stops at 340px.
        className="scrollbar-on-hover max-h-[var(--radix-popover-content-available-height)] w-[min(calc(100vw-2rem),340px)] overflow-y-auto overscroll-contain p-4"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
