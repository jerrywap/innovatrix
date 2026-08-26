import { cn } from "@/lib/utils";

/**
 * The label-and-figure tile used at the top of `/admin` and `/staff`.
 *
 * There were two of these — one local to each page, same design, different prop
 * shapes (`children` on one, `value`/`detail` on the other) — which is how a
 * label's letter-spacing ends up differing by a hundredth of an em between two
 * screens that sit one click apart. One component, both call styles supported,
 * because both were reasonable: a plain figure wants `value`, and a row of
 * per-currency amounts wants `children`.
 *
 * Distinct from `Figure` in the same directory, which is the reporting version —
 * bigger type, a sparkline, a period comparison. These tiles sit above a page
 * whose job is navigation and are deliberately quieter.
 */
export function Tile({
  label,
  value,
  detail,
  children,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface flex flex-col gap-1 rounded-xl border p-4",
        className,
      )}
    >
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </span>
      {value !== undefined && <span className="text-[18px] font-medium">{value}</span>}
      {detail !== undefined && <span className="text-subtle text-[12.5px]">{detail}</span>}
      {children}
    </div>
  );
}

/**
 * "+18% on last month", or nothing.
 *
 * Nothing, specifically, when the previous figure was zero: growth from nothing
 * is not a percentage, and "+100%" beside a first sale is worse than no
 * comparison at all. Two zeroes are a genuine "no change", which is why that case
 * is separated rather than folded in.
 */
export function MonthOnMonth({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);

  return (
    <span
      className={cn(
        "font-mono text-[12px] tabular-nums",
        change > 0 && "text-[var(--chart-4)]",
        change < 0 && "text-[var(--danger)]",
        change === 0 && "text-subtle",
      )}
    >
      {change > 0 ? "+" : ""}
      {change}% on last month
    </span>
  );
}
