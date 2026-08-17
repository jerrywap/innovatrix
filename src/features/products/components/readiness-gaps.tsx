import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { stepHref, type WizardSurface } from "../steps";
import type { ReadinessGap } from "@/services/catalog/readiness";

/**
 * What is stopping this product going live.
 *
 * Every gap is a **link to the step that fixes it**. That is the whole reason
 * the wizard uses named route folders rather than one `[section]` segment:
 * `stepHref` produces a route the compiler can check, so a gap can never point
 * somewhere that does not exist.
 *
 * The same component renders in the product list and on the review step, from
 * the same `computeReadiness` call — a list column computed by a different code
 * path than the publish gate would eventually disagree with it, and the version
 * that says "ready" while the button says otherwise is the one people trust.
 *
 * `surface` picks which wizard the links point at (vendor ticket 04). It defaults to
 * `admin`, so every existing caller is unchanged, and a vendor's gap links land on
 * the vendor's own steps rather than on a 403.
 */
export function ReadinessGaps({
  gaps,
  productId,
  compact,
  className,
  surface = "admin",
}: {
  gaps: readonly ReadinessGap[];
  productId: string;
  /** The list column: terse, and only the first few. */
  compact?: boolean;
  className?: string;
  surface?: WizardSurface;
}) {
  if (gaps.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-300",
          className,
        )}
      >
        <Check className="size-3.5" aria-hidden />
        Ready to publish
      </span>
    );
  }

  if (compact) {
    const shown = gaps.slice(0, 2);
    const rest = gaps.length - shown.length;

    return (
      <span className={cn("text-muted-foreground text-[12.5px]", className)}>
        {shown.map((gap, index) => (
          <span key={gap.code}>
            {index > 0 && ", "}
            <Link
              href={stepHref(productId, gap.section, surface)}
              className="hover:text-foreground underline decoration-dotted underline-offset-2"
            >
              {gap.message.toLowerCase()}
            </Link>
          </span>
        ))}
        {rest > 0 && <span className="text-subtle"> +{rest} more</span>}
      </span>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {gaps.map((gap) => (
        <li key={gap.code} className="flex items-start gap-2 text-[13.5px]">
          <span className="bg-signal mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
          <Link
            href={stepHref(productId, gap.section, surface)}
            className="hover:text-signal-text underline decoration-dotted underline-offset-2"
          >
            {gap.message}
          </Link>
        </li>
      ))}
    </ul>
  );
}
