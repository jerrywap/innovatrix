import Link from "next/link";
import type { Route } from "next";
import { listHref, type RawSearchParams } from "@/lib/list-params";
import { RANGES, type RangeKey } from "../range";

const LABELS: Record<RangeKey, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

/**
 * The period control — links, not a `<select>`, and no client JavaScript.
 *
 * The same call every other filter on `/admin` and `/staff` makes, for the same
 * reasons `list-params.ts` sets out: the view is linkable, Back works, and the
 * server renders the right numbers on the first pass rather than flashing an
 * unfiltered set. `admin/products` puts it plainly — "keeps the whole screen a
 * Server Component and makes each filter a shareable URL".
 *
 * There is no granularity control beside it. The range implies its own
 * resolution (see `range.ts`), so there is one decision here instead of two that
 * can contradict each other.
 */
export function RangeFilter({
  pathname,
  searchParams,
  current,
}: {
  pathname: Route;
  searchParams: RawSearchParams;
  current: RangeKey;
}) {
  return (
    <nav aria-label="Reporting period" className="flex flex-wrap items-center gap-1.5">
      {RANGES.map((key) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={listHref(pathname, searchParams, { range: key })}
            aria-current={active ? "true" : undefined}
            className={
              active
                ? "bg-foreground text-background rounded-full px-3 py-1.5 text-[12.5px] font-medium"
                : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground rounded-full border px-3 py-1.5 text-[12.5px] transition"
            }
          >
            {LABELS[key]}
          </Link>
        );
      })}
    </nav>
  );
}
