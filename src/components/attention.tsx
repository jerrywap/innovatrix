import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Needs your attention" — §102.
 *
 * The spec is blunt about this: the dashboard leads with **what the customer
 * must do**, not with decorative statistics. A quote awaiting acceptance, an
 * invoice due, a request blocked on their answer.
 *
 * Three rules this component exists to enforce:
 *
 * 1. **Every item is a link to the thing itself.** An attention item that
 *    can't be acted on is an anxiety generator, not a feature.
 * 2. **The signal colour is reserved for these.** Nothing decorative uses it,
 *    so orange on a dashboard always means "you".
 * 3. **An empty list is a success state**, not a hole. `AttentionEmpty` says so
 *    rather than leaving a blank panel that reads as broken.
 */

export interface AttentionItem {
  id: string;
  title: string;
  detail?: string;
  href: Route;
  /** Rendered as-is. Use `MoneyDisplay` or a due date, not decoration. */
  meta?: React.ReactNode;
  icon?: LucideIcon;
  /** Overdue and expiring items sort to the top and read louder. */
  urgent?: boolean;
}

export function Attention({
  items,
  title = "Needs your attention",
  className,
}: {
  items: readonly AttentionItem[];
  title?: string;
  className?: string;
}) {
  if (items.length === 0) return <AttentionEmpty className={className} />;

  // Urgent first, stable within each group so the order doesn't jitter between
  // renders when nothing has changed.
  const ordered = [...items].sort(
    (a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)),
  );

  return (
    <section
      className={cn("flex flex-col gap-3", className)}
      aria-labelledby="attention-heading"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="attention-heading" className="font-display text-[17px] tracking-[-0.02em]">
          {title}
        </h2>
        <span className="text-subtle text-[12.5px]">
          {ordered.length} {ordered.length === 1 ? "item" : "items"}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {ordered.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={cn(
                  "group border-border bg-surface hover:border-border-strong flex items-center gap-3.5 rounded-xl border p-3.5 transition",
                  item.urgent && "border-signal/30 bg-signal-soft",
                )}
              >
                {Icon && (
                  <span
                    className={cn(
                      "text-muted-foreground bg-surface-muted grid size-9 shrink-0 place-items-center rounded-lg",
                      item.urgent && "bg-signal/15 text-signal-text",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{item.title}</p>
                  {item.detail && (
                    <p className="text-muted-foreground mt-0.5 truncate text-[12.5px]">
                      {item.detail}
                    </p>
                  )}
                </div>

                {item.meta && (
                  <div className="text-muted-foreground hidden shrink-0 text-[13px] sm:block">
                    {item.meta}
                  </div>
                )}

                <ArrowRight
                  className="text-subtle group-hover:text-foreground size-4 shrink-0 transition"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AttentionEmpty({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "border-border bg-surface flex items-center gap-3 rounded-xl border p-4",
        className,
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        ✓
      </span>
      <div>
        <p className="text-[14px] font-medium">Nothing needs you right now</p>
        <p className="text-muted-foreground text-[12.5px]">
          We&rsquo;ll put anything waiting on you here.
        </p>
      </div>
    </section>
  );
}
