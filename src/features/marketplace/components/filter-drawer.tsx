"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The filter rail, on a phone — §8's rail without §8's assumption that there is a column for it.
 *
 * ## What was wrong
 *
 * `results-section.tsx` is `grid gap-8 lg:grid-cols-[220px_1fr]` with the rail first in DOM order,
 * and the rail's own `<aside>` had no responsive classes at all. Below `lg` the grid collapses to one
 * column, so the whole rail stacked *above* the results: nine sections and around thirty option rows,
 * roughly 1,300px at seed data and nearer 1,900px with a production taxonomy. On a 667px phone that
 * is two to three screens of filters before the first product card.
 *
 * The page's own Suspense fallback already hid the rail below `lg`, so the skeleton and the content
 * disagreed and the rail appeared *after* the results resolved — a layout shift on top of the scroll
 * problem. That disagreement is the evidence this was an omission rather than a decision.
 *
 * ## The rail stays a Server Component
 *
 * That property is load-bearing: every control is an `<a>`, so filtering works before hydration, Back
 * does what Back should do, and a copied URL reproduces the result set by construction. None of that
 * survives being rewritten as client state, so it is not rewritten. This component holds open/closed
 * and nothing else; the rail arrives as `children`, rendered on the server, and **the same element is
 * used for both placements** so the two cannot drift.
 *
 * ## Closing on navigation is the caller's `key`, not an effect in here
 *
 * `MobileNav` threads an `onNavigate` callback into `SidebarNav`. That is not available here: the
 * rail's links are server-rendered, and giving `RailLink` an `onClick` would make the whole rail a
 * client component — the one thing worth protecting.
 *
 * So this component holds no idea of the URL at all. `results-section` passes a **`key` derived from
 * the query string**, and a navigation therefore remounts this with `open` back at its initial
 * `false`. That is React's own answer to "reset state when a value changes", and it is better than the
 * alternatives in three ways: no `useEffect` calling `setState` (which the React Compiler lint
 * correctly refuses, since it cascades a render), no `useSearchParams` in the client bundle, and it
 * fires on the navigation *committing* rather than on a link being pressed. It also covers the price
 * range, which is a native `<form method="get">` that an onClick hook would miss entirely.
 *
 * `side="left"`, not `"bottom"`: the bottom variant of `SheetContent` is `h-auto`, and 1,300px of rail
 * would run straight off the viewport with no way to scroll it.
 */
export function FilterDrawer({
  activeCount,
  children,
}: {
  /** Filter *terms* in the URL, from `activeFilterCount` — the trigger is the only place a closed rail can speak. */
  activeCount: number;
  children: React.ReactNode;
}) {
  // Reset by remount — see the `key` note above. Nothing else in here is stateful, so there is
  // nothing a remount loses.
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="border-border hover:bg-surface-muted flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition lg:hidden">
        <SlidersHorizontal className="size-4" aria-hidden />
        Filter and sort
        {activeCount > 0 && (
          <>
            <span className="rounded-full bg-[var(--signal)] px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-[var(--signal-contrast)]">
              {activeCount}
            </span>
            {/* The badge is a number in a circle. WCAG 2.5.3 wants the accessible name to contain
                the visible text, so the name is extended rather than replaced. */}
            <span className="sr-only">
              {activeCount === 1 ? "— 1 filter on" : `— ${activeCount} filters on`}
            </span>
          </>
        )}
      </SheetTrigger>

      <SheetContent side="left" className="w-[300px] p-0">
        <SheetHeader className="px-4 pt-5 pb-0">
          {/* Radix warns without a title, and a visible one would repeat the trigger. */}
          <SheetTitle className="sr-only">Filter and sort</SheetTitle>
        </SheetHeader>

        {/* `SheetContent` sets no overflow of its own, so the scroll container is here — the same
            place `MobileNav` puts it, and necessary for a rail this tall. */}
        <div className="overflow-y-auto px-3.5 pt-2 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
