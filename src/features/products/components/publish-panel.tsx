"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/components/status-badge";
import { PRODUCT_PUBLICATION_PATH, productTransitionRule } from "@/lib/db/states";
import { cn } from "@/lib/utils";
import { transitionProductAction } from "../actions";
import { FormErrors } from "./section-form";
import { ReadinessGaps } from "./readiness-gaps";
import type { ProductStatus } from "@/lib/db/enums";
import type { ReadinessGap } from "@/services/catalog/readiness";

/**
 * The §46 lifecycle control.
 *
 * ## The gaps are shown, and the button is not hidden
 *
 * An incomplete product still offers Publish. Pressing it produces the specific
 * refusal — "add at least one price; add a screenshot" — from the same
 * `computeReadiness` that produced the list above it.
 *
 * That is deliberate. A disabled button explains nothing, and hiding the
 * control entirely leaves someone hunting for where publishing went. The
 * refusal is the explanation, and it comes from the server, so it is the same
 * answer whether it arrives through this form or a direct POST.
 *
 * ## Where publishing went, when it is not on this screen yet
 *
 * Reported after approving a vendor's first submission: *"I went to the product's review
 * step and still cannot see how to publish it."* Nothing was broken — the product was in
 * `internal_review`, publishing is taken from `ready`, and the two states are three hops
 * apart. The screen simply never said so. It printed the four legal destinations as bare
 * status names — "Testing", "Changes requested", "Draft", "Archived" — with `Publish`
 * highlighted only when it happened to be among them, so at every earlier stage the
 * pipeline looked like a dead end with four equal exits, one of which archives the product.
 *
 * Three changes, none of them new mechanism:
 *
 * 1. **The rail.** `PRODUCT_PUBLICATION_PATH` drawn with the current position marked, so
 *    the remaining steps are visible and publication is legibly ahead rather than absent.
 * 2. **Edge labels instead of destination names.** `PRODUCT_TRANSITION_RULES` already
 *    carries a written label for every edge — "Send to testing", "Mark ready", "Publish",
 *    "Request changes" — and this panel was ignoring all of them to print the target state.
 *    A verb says what the button does; a noun leaves the reader to infer it.
 * 3. **Forward first.** The step that advances toward sale is the primary button and is
 *    separated from the ones that go back or archive. Those were sitting in the same row at
 *    the same weight, which is a poor place to keep "Archive".
 */
export function PublishPanel({
  productId,
  status,
  nextStates,
  gaps,
}: {
  productId: string;
  status: ProductStatus;
  /** From the ticket-02 transition map, so the UI cannot offer an illegal move. */
  nextStates: readonly ProductStatus[];
  gaps: readonly ReadinessGap[];
}) {
  const [state, formAction] = useActionState(transitionProductAction, null);
  const failed = state && !state.ok ? state : null;

  /*
   * The furthest-forward legal destination, which is the one that advances this product.
   *
   * "Furthest" rather than "next" because `draft` has two forward edges: `submitted`, which
   * belongs to a vendor and has no staff permission at all, and `internal_review`, which is
   * how a first-party product enters the pipeline. Taking the later one gives the right
   * primary action on this screen at every stage, without a special case for `draft`.
   */
  const position = PRODUCT_PUBLICATION_PATH.indexOf(status as never);
  const forward = [...nextStates]
    .filter((next) => PRODUCT_PUBLICATION_PATH.indexOf(next as never) > position)
    .sort(
      (a, b) =>
        PRODUCT_PUBLICATION_PATH.indexOf(b as never) -
        PRODUCT_PUBLICATION_PATH.indexOf(a as never),
    )
    .at(0);
  const others = nextStates.filter((next) => next !== forward);

  return (
    <div className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] tracking-[-0.02em]">Status</h2>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            Where this product is in its lifecycle.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <PublicationRail status={status} />

      {gaps.length > 0 && (
        <div className="border-border border-t pt-4">
          <p className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Before publishing
          </p>
          <ReadinessGaps gaps={gaps} productId={productId} />
        </div>
      )}

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      {state?.ok && (
        <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-300">
          Moved to {statusLabel(state.data.status).toLowerCase()}.
        </p>
      )}

      {nextStates.length === 0 ? (
        <p className="text-subtle border-border border-t pt-4 text-[13px]">
          This product is archived. Nothing moves from here.
        </p>
      ) : (
        <form action={formAction} className="border-border flex flex-col gap-3 border-t pt-4">
          <input type="hidden" name="productId" value={productId} />

          {forward && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-medium">Next step</p>
              <TransitionButton from={status} to={forward} highlight />
            </div>
          )}

          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-subtle text-[12.5px]">
                {forward ? "Or send it back:" : "Or:"}
              </p>
              <div className="flex flex-wrap gap-2">
                {others.map((next) => (
                  <TransitionButton key={next} from={status} to={next} highlight={false} />
                ))}
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The route to sale, with the current position marked.
 *
 * Not a progress bar: a product can go backwards, and drawing steps behind the current one
 * as "done" would claim a history this component cannot see. A step before the current one
 * is *passed*, which is all the check mark says.
 */
function PublicationRail({ status }: { status: ProductStatus }) {
  const position = PRODUCT_PUBLICATION_PATH.indexOf(status as never);

  // `changes_requested`, `deprecated` and `archived` are not on the route. Drawing the rail
  // with nothing marked would be worse than not drawing it.
  if (position === -1) return null;

  return (
    <ol className="border-border flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-4">
      {PRODUCT_PUBLICATION_PATH.map((step, index) => {
        const current = index === position;
        const passed = index < position;

        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]",
                current && "bg-[var(--signal)] font-medium text-[var(--signal-contrast)]",
                passed && "text-subtle",
                !current && !passed && "text-subtle",
              )}
              // The rail is decoration around a status that is already announced by the
              // badge above; only the current step needs saying, and saying it twice is
              // noise in a screen reader.
              aria-current={current ? "step" : undefined}
            >
              {passed && <Check className="size-3" aria-hidden />}
              {statusLabel(step)}
            </span>
            {index < PRODUCT_PUBLICATION_PATH.length - 1 && (
              <span className="text-subtle text-[11px]" aria-hidden>
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function TransitionButton({
  from,
  to,
  highlight,
}: {
  from: ProductStatus;
  to: ProductStatus;
  highlight: boolean;
}) {
  const { pending } = useFormStatus();

  /*
   * The edge's own label — "Send to testing", "Mark ready", "Publish". Every edge in
   * `PRODUCT_TRANSITIONS` has a rule, and `states.test.ts` fails if one does not, so the
   * fallback to the destination name is unreachable rather than a quiet default.
   */
  const label = productTransitionRule(from, to)?.label ?? statusLabel(to);

  return (
    <Button
      type="submit"
      name="to"
      value={to}
      variant={highlight ? "default" : "outline"}
      size="sm"
      disabled={pending}
      className={highlight ? "w-fit" : undefined}
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden />
    </Button>
  );
}
