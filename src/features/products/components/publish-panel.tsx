"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/components/status-badge";
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
        <form action={formAction} className="border-border flex flex-col gap-2 border-t pt-4">
          <input type="hidden" name="productId" value={productId} />

          <p className="text-[13px] font-medium">Move to</p>
          <div className="flex flex-wrap gap-2">
            {nextStates.map((next) => (
              <TransitionButton key={next} to={next} highlight={next === "published"} />
            ))}
          </div>
        </form>
      )}
    </div>
  );
}

function TransitionButton({ to, highlight }: { to: ProductStatus; highlight: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="to"
      value={to}
      variant={highlight ? "default" : "outline"}
      size="sm"
      disabled={pending}
    >
      {statusLabel(to)}
      <ArrowRight className="size-3.5" aria-hidden />
    </Button>
  );
}
