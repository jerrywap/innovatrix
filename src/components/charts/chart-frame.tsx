import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";
import type { ChartSeries } from "./chart-types";

/**
 * The panel a chart sits in — a **Server Component**, so only the plot itself
 * ships JavaScript.
 *
 * Everything a reader needs in order to trust the picture lives here rather than
 * inside the chart: what it is, where it goes when clicked, and — the part that
 * matters most on this platform — what it does *not* say. `footnote` exists
 * because several of these panels have a real limit that would otherwise be
 * invisible: job history is capped at seven days by a TTL, and nothing anywhere
 * counts a page view. `services/vendors/analytics-service.ts` already refused to
 * "stub a number that looks real"; a chart drawn over a partial source is the
 * same mistake with an axis on it.
 *
 * The empty state is a first-class prop for the same reason. A freshly deployed
 * platform, and any window with no activity in it, renders an axis with nothing
 * on it — which reads as broken rather than as empty.
 */
export function ChartFrame({
  eyebrow,
  title,
  hint,
  action,
  legend,
  footnote,
  empty = false,
  emptyMessage = "Nothing in this period.",
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  action?: { href: Route; label: string };
  legend?: readonly ChartSeries[];
  footnote?: string;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface flex flex-col gap-3 rounded-xl border p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
              {eyebrow}
            </p>
          )}
          <h2 className="font-display mt-0.5 text-[15.5px] tracking-[-0.02em]">{title}</h2>
          {hint && <p className="text-muted-foreground mt-1 text-[12.5px]">{hint}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className="text-muted-foreground hover:text-foreground shrink-0 text-[12.5px] underline underline-offset-4"
          >
            {action.label}
          </Link>
        )}
      </div>

      {legend && legend.length > 1 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((series) => (
            <li
              key={series.key}
              className="text-muted-foreground flex items-center gap-1.5 text-[12px]"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: series.color }}
              />
              {series.label}
            </li>
          ))}
        </ul>
      )}

      {empty ? (
        <p className="text-muted-foreground py-6 text-[13px]">{emptyMessage}</p>
      ) : (
        /*
         * The chart's own scroll container. AGENTS.md requires wide content to
         * scroll inside itself so the page body never scrolls sideways, and a
         * chart with thirty daily columns on a 390px screen is exactly that
         * content.
         */
        <div className="-mx-1 overflow-x-auto px-1">{children}</div>
      )}

      {footnote && (
        <p className="text-subtle border-border border-t pt-2.5 text-[11.5px] leading-relaxed">
          {footnote}
        </p>
      )}
    </section>
  );
}
