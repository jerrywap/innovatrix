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
 * the first place. Now that the rail is a drawer below `lg` (see `filter-drawer.tsx`), this holds a
 * trigger-sized block where the trigger lands, and the two agree at every width.
 */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      {/* Sized to the drawer trigger, so nothing moves when it resolves. */}
      <Skeleton className="h-[38px] w-[152px] rounded-lg lg:hidden" />

      <div className="hidden flex-col gap-6 lg:flex">
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
