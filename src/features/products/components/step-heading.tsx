import { stepFor } from "../steps";
import type { ProductSection } from "@/services/catalog/readiness";

/**
 * The heading each wizard step opens with.
 *
 * Reads `steps.ts` rather than taking a title, so a step's label cannot say one
 * thing in the rail and another above the form.
 *
 * `h2`, not `h1` — the layout's `PageHeader` owns the page's only `h1`, which
 * is the product's name. Two `h1`s on one page is the most common way a form
 * screen fails an accessibility audit.
 */
export function StepHeading({ section }: { section: ProductSection }) {
  const step = stepFor(section);
  if (!step) return null;

  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">{step.label}</h2>
      <p className="text-muted-foreground text-[13.5px]">{step.description}</p>
    </div>
  );
}
