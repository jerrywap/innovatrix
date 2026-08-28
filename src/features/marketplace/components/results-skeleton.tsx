import { Skeleton } from "@/components/ui/skeleton";

/**
 * The fallback for `MarketplaceResults`, shaped like what replaces it at **both** breakpoints.
 *
 * ## Why it is shared rather than per page
 *
 * Three pages render `MarketplaceResults` — `/marketplace` and the category and industry landing
 * pages — and they had two different fallbacks between them: the marketplace mirrored the layout,
 * and the two landing pages used a bare `h-96` block, so the same content resolved out of two
 * different silhouettes.
 *
 * ## What it got wrong before
 *
 * The rail column was `hidden … lg:flex` here while the real rail had no responsive classes at all.
 * So on a phone the skeleton showed a bare grid and then the rail arrived *above* it once results
 * resolved — a layout shift that moved the scroll position, on top of the rail being 1,300px tall in
 * the first place. The sidebar is now `lg`-only and carries taxonomy alone; below `lg` the filter
 * button beside the search box is the whole control, and it has its own fallback up there rather
 * than one here.
 *
 * ## What it must mirror
 *
 * Two strings in `results-section.tsx`, not one: the **grid container**
 * (`lg:grid-cols-[220px_1fr]`) and the **rail column** — which is now sticky with
 * its own scroll. Change either there and change it here in the same commit.
 */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      {/* Mirrors the real rail column in `results-section.tsx` — see the note
          above about what happens when these two disagree. The sticky and
          overflow classes have no visible effect here, since four short groups
          never reach the cap; they are present so the two strings can be
          compared literally. */}
      <div className="border-border bg-surface scrollbar-on-hover hidden rounded-xl lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col lg:gap-6 lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:border lg:p-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton className="aspect-[16/10] w-full rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
