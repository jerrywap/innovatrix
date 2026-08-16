import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shape a screen has before its data arrives.
 *
 * Deliberately generic: a skeleton that mimics the final layout too closely
 * becomes a second copy of it, and the two drift. This says "a heading and some
 * rows are coming" and nothing more.
 *
 * It matters because of where the shells read from. Every protected layout
 * calls the DAL, which reads `headers()` — so the route is dynamic and there is
 * a real gap before first paint. Without a `loading.tsx` the browser sits on
 * the previous page during that gap, which reads as a dead click.
 */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
