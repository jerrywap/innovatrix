import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The screen with nothing on it yet.
 *
 * Two different situations wear this component, and conflating them is the
 * usual mistake:
 *
 * - **Nothing exists yet.** Say what this screen is for and offer the action
 *   that creates the first one. "No orders yet" with a link to the marketplace.
 * - **A filter matched nothing.** Say so, and offer to clear the filter. Never
 *   show the create action here — the thing may well exist, just not in this
 *   view, and inviting someone to make a second one is actively wrong.
 *
 * `variant` picks between them so the caller has to decide.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "empty",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "empty" | "no-results";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface/50 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="bg-surface-muted text-muted-foreground grid size-11 place-items-center rounded-2xl">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <div className="max-w-[40ch]">
        <p className="font-display text-[16px] tracking-[-0.02em]">{title}</p>
        {description && (
          <p className="text-muted-foreground mt-1 text-[13.5px]">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
      {variant === "no-results" && !action && (
        <p className="text-subtle text-[12.5px]">Try removing a filter.</p>
      )}
    </div>
  );
}
