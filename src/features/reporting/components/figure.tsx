import Link from "next/link";
import type { Route } from "next";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";

/**
 * One headline number, with its trend and its comparison.
 *
 * A figure on its own is nearly useless — "£117,601" answers no question without
 * either a direction or a benchmark — so this pairs it with both when they exist,
 * and shows neither rather than a fabricated one when they do not.
 *
 * Not `StatCard`. That component caps its grid at four and its docstring holds a
 * rule this would break: "a stat that isn't actionable doesn't belong on a
 * customer screen. `href` is how it earns its place." A reporting figure is
 * legitimately not actionable — it is the thing being reported — and this is the
 * exception rather than a reinterpretation of that rule.
 */
export function Figure({
  label,
  value,
  detail,
  delta,
  spark,
  href,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  /** Percentage change against the previous equal-length period. */
  delta?: { percent: number; label: string } | null;
  spark?: readonly number[];
  href?: Route;
  className?: string;
}) {
  const body = (
    <>
      <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[22px] leading-none tracking-[-0.03em] tabular-nums">
            {value}
          </p>
          {detail && <p className="text-muted-foreground mt-1.5 text-[12px]">{detail}</p>}
          {delta && (
            <p className="mt-1.5 flex items-baseline gap-1.5 text-[12px]">
              <span
                className={cn(
                  "font-mono tabular-nums",
                  delta.percent > 0 && "text-[var(--chart-4)]",
                  delta.percent < 0 && "text-[var(--danger)]",
                  delta.percent === 0 && "text-subtle",
                )}
              >
                {delta.percent > 0 ? "+" : ""}
                {delta.percent}%
              </span>
              <span className="text-subtle">{delta.label}</span>
            </p>
          )}
        </div>
        {spark && spark.length > 1 && (
          <span className="shrink-0 pb-0.5">
            <Sparkline values={spark} />
          </span>
        )}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "border-border bg-surface flex flex-col rounded-xl border p-4",
        href && "hover:border-border-strong transition",
        className,
      )}
    >
      {href ? (
        <Link href={href} className="flex flex-col">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/**
 * Percentage change, or `null` when there is no honest answer.
 *
 * Growth from zero is not "+100%" and it is not "+∞" — it is a comparison that
 * cannot be made, and the caller renders nothing rather than a number that will
 * be read as a rate. Two zeroes are genuinely "no change", which is why that case
 * is not folded in with the other.
 */
export function delta(current: number, previous: number, label: string) {
  if (previous === 0) return current === 0 ? { percent: 0, label } : null;
  return { percent: Math.round(((current - previous) / previous) * 100), label };
}
