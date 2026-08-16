import type { Route } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single number with a label.
 *
 * §102 is wary of these, and rightly: a row of counters at the top of a
 * dashboard is the easiest thing to build and the least useful thing to read.
 * So there is one rule here — **a stat that isn't actionable doesn't belong on
 * a customer screen.** `href` is how it earns its place; "3 open requests" is
 * worth showing because it goes somewhere.
 *
 * Staff queue screens are the exception: for someone whose job is the queue,
 * the count *is* the information.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  href?: Route;
  /** `signal` for the one number that matters most on a queue screen. */
  tone?: "default" | "signal";
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-[12.5px] font-medium">{label}</p>
        {Icon && <Icon className="text-subtle size-4 shrink-0" aria-hidden />}
      </div>
      <p
        className={cn(
          "font-display mt-2 text-[26px] leading-none tracking-[-0.03em] tabular-nums",
          tone === "signal" && "text-signal-text",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-subtle mt-1.5 text-[12px]">{hint}</p>}
    </>
  );

  const shell = cn(
    "border-border bg-surface rounded-xl border p-4",
    href && "hover:border-border-strong transition",
    className,
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** Responsive grid for a row of them. Caps at four — more is a table. */
export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}
