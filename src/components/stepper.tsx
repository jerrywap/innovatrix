import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Progress through a fixed sequence — checkout, the product-upload wizard,
 * quote acceptance.
 *
 * §100 (progressive complexity): showing the whole path up front is what makes
 * a five-step checkout feel finite. The count is the reassurance.
 *
 * Rendered as an ordered list with `aria-current="step"` rather than a row of
 * divs, so it is navigable and announced. On mobile it collapses to
 * "Step 2 of 4 — Payment": four labels do not fit on a phone, and shrinking
 * them until they do is how they become unreadable.
 */

export interface Step {
  id: string;
  label: string;
}

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: readonly Step[];
  /** Zero-based index of the active step. */
  current: number;
  className?: string;
}) {
  const index = Math.min(Math.max(current, 0), steps.length - 1);
  const active = steps[index];

  return (
    <>
      {/* Mobile */}
      <p className="text-muted-foreground text-[13px] sm:hidden">
        Step {index + 1} of {steps.length}
        {active && <> — {active.label}</>}
      </p>

      {/* Desktop */}
      <ol className={cn("hidden items-center gap-2 sm:flex", className)}>
        {steps.map((step, i) => {
          const done = i < index;
          const isCurrent = i === index;

          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition",
                  done && "border-border text-muted-foreground",
                  isCurrent && "border-signal/30 bg-signal-soft text-signal-text",
                  !done && !isCurrent && "border-border text-subtle",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded-full text-[10px] font-semibold",
                    done && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                    isCurrent && "bg-signal text-signal-contrast",
                    !done && !isCurrent && "bg-surface-muted text-subtle",
                  )}
                >
                  {done ? <Check className="size-2.5" aria-hidden /> : i + 1}
                </span>
                {step.label}
              </span>

              {i < steps.length - 1 && (
                <span className="bg-border h-px w-5 shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
