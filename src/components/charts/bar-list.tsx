import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";

/**
 * A ranking, as bars — a **Server Component**, no library, no JavaScript.
 *
 * Deliberately not recharts, and the reason is not weight. A ranking's rows are
 * the most clickable thing on either dashboard — top products, queue depth,
 * workload, categories — and a `<Bar>` inside an SVG cannot be a `<Link>`
 * without reimplementing focus, hover and keyboard traversal that an `<a>` has
 * already. Rendered as list rows, every bar is a real link, tab order is free,
 * and the labels wrap instead of being truncated at an axis.
 *
 * `star-rating.tsx` already established the idiom here — and its rule, which
 * this copies: bars are a **proportion of the largest row, not of the total**, so
 * a distribution with one dominant value still shows the shape of the rest.
 * Proportion-of-total makes every row after the first a hairline.
 *
 * `earnings-surface.tsx` made the same call in one line: "It carries the same
 * information as the two figures above it and needs no axis, no legend and no
 * library."
 */
export interface BarListRow {
  key: string;
  label: string;
  /** The bar's length. */
  value: number;
  /** What the row reads as — already formatted, since the server has the currency. */
  display: string;
  /** A second, quieter figure: "of which 3 failed", a count beside a total. */
  detail?: string;
  href?: Route;
  /** Overrides the default bar colour, for a row that means something. */
  color?: string;
  /** Renders the row in the attention tone — it needs somebody. */
  urgent?: boolean;
}

export function BarList({
  rows,
  emptyMessage = "Nothing to show yet.",
  className,
}: {
  rows: readonly BarListRow[];
  emptyMessage?: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-[13px]">{emptyMessage}</p>;
  }

  // Of the largest, not of the total. Guarded so a list of zeroes renders empty
  // bars rather than dividing by nothing.
  const largest = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px]">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {row.detail && <span className="text-subtle text-[11.5px]">{row.detail}</span>}
                <span className="font-mono text-[12.5px] tabular-nums">{row.display}</span>
              </span>
            </span>
            <span
              aria-hidden
              className="bg-surface-muted mt-1.5 block h-1.5 overflow-hidden rounded-full"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max((Math.abs(row.value) / largest) * 100, row.value === 0 ? 0 : 1.5)}%`,
                  background: row.color ?? (row.urgent ? "var(--signal)" : "var(--chart-1)"),
                }}
              />
            </span>
          </>
        );

        return (
          <li key={row.key} className="border-border border-b py-2.5 last:border-b-0">
            {row.href ? (
              <Link
                href={row.href}
                className="focus-visible:ring-ring -mx-1.5 flex flex-col rounded-md px-1.5 py-0.5 transition hover:bg-[var(--surface-muted)]"
              >
                {body}
              </Link>
            ) : (
              <div className="flex flex-col">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
