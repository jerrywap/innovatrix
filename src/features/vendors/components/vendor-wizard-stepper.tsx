"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { VENDOR_WIZARD_STEPS, stepHref } from "@/features/products/steps";
import type { ProductSection } from "@/services/catalog/readiness";

/**
 * The vendor wizard's step rail — vendor ticket 04.
 *
 * A near-copy of `WizardStepper`, and the difference is one argument: `stepHref`'s
 * surface. They are separate components rather than one with a `surface` prop
 * because both are `"use client"` islands that import their step list at module
 * scope, and a shared one would ship the admin route strings into the vendor bundle
 * for no gain.
 *
 * The `SOON` marker the staff rail shows for ticket 07's steps is gone: by the time
 * a vendor sees this, those steps exist.
 */
export function VendorWizardStepper({
  productId,
  blockedSections,
}: {
  productId: string;
  blockedSections: readonly ProductSection[];
}) {
  const segment = useSelectedLayoutSegment();
  const blocked = new Set(blockedSections);

  return (
    <nav aria-label="Product setup" className="flex flex-col gap-0.5">
      {VENDOR_WIZARD_STEPS.map((step) => {
        const isCurrent = segment === step.segment;
        const hasGap = blocked.has(step.id);

        return (
          <Link
            key={step.id}
            href={stepHref(productId, step.id, "vendor")}
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
          </Link>
        );
      })}
    </nav>
  );
}
