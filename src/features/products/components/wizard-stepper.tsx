"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRODUCT_WIZARD_STEPS, stepHref } from "../steps";
import type { ProductSection } from "@/services/catalog/readiness";

/**
 * The wizard's step rail.
 *
 * A client island for one reason: `useSelectedLayoutSegment()`, to know which
 * step is open. The layout is a Server Component and Next does not re-render it
 * on navigation within the same layout, so the current step cannot be resolved
 * server-side.
 *
 * Not `<Stepper>` from `components/`. That one marks progress by *position* —
 * everything before the current step is done — which is right for checkout and
 * wrong here: this wizard is navigable in any order, and a step is complete
 * when its data is complete, not when you have walked past it. `blockedSections`
 * comes from the same `computeReadiness` call the publish gate uses.
 */
export function WizardStepper({
  productId,
  blockedSections,
}: {
  productId: string;
  /** Sections with an outstanding publish gap. */
  blockedSections: readonly ProductSection[];
}) {
  const segment = useSelectedLayoutSegment();
  const blocked = new Set(blockedSections);

  return (
    <nav aria-label="Product setup" className="flex flex-col gap-0.5">
      {PRODUCT_WIZARD_STEPS.map((step) => {
        const isCurrent = segment === step.segment;
        const hasGap = blocked.has(step.id);

        return (
          <Link
            key={step.id}
            href={stepHref(productId, step.id)}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition",
              isCurrent
                ? "bg-signal-soft text-signal-text font-medium"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                hasGap
                  ? "bg-signal/15 text-signal-text"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              )}
              aria-hidden
            >
              {hasGap ? "!" : <Check className="size-2.5" />}
            </span>

            <span className="flex-1">{step.label}</span>

            {step.ticket && (
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.1em]">SOON</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
