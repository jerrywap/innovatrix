"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors } from "@/features/products/components/section-form";
import { submitForReviewAction, withdrawSubmissionAction } from "../product-actions";

/**
 * Submitting, and withdrawing — vendor ticket 05.
 *
 * ## The attestation is the point of this screen
 *
 * Not a formality. Recorded with the person, the timestamp and the wording's version,
 * it is the record a takedown is weighed against (vendor ticket 13) — the difference
 * between "they said they had the rights" and "they accepted this text, on this date".
 * So the words are shown in full rather than hidden behind a link, and the box is
 * unchecked by default.
 *
 * ## What is not here
 *
 * No publish button, at any status. A vendor moves a product to `submitted` and a
 * reviewer takes it from there — and the absence of the control is the *smaller* half
 * of that guarantee: `productService.transition` reads
 * `PRODUCT_TRANSITION_RULES` and refuses the edge for a vendor actor whatever gets
 * POSTed.
 */
export function SubmitPanel({
  productId,
  status,
  isPublishable,
  attestationText,
}: {
  productId: string;
  status: string;
  isPublishable: boolean;
  attestationText: string;
}) {
  const [submitState, submitAction] = useActionState(submitForReviewAction, null);
  const [withdrawState, withdrawAction] = useActionState(withdrawSubmissionAction, null);

  const submitFailed = submitState && !submitState.ok ? submitState : null;
  const withdrawFailed = withdrawState && !withdrawState.ok ? withdrawState : null;

  // `draft` and `changes_requested` are the two states a vendor submits from —
  // the same two `PRODUCT_TRANSITION_RULES` marks `vendorMay`.
  const canSubmit = status === "draft" || status === "changes_requested";
  const canWithdraw = status === "submitted";

  if (canWithdraw) {
    return (
      <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">With us now</h2>
          <StatusBadge status={status} />
        </div>
        <p className="text-muted-foreground text-[13px]">
          Somebody will read it and either put it on sale or tell you what to change. You can
          pull it back until a reviewer starts.
        </p>

        <form action={withdrawAction} className="flex flex-col gap-2">
          {withdrawFailed && (
            <FormErrors error={withdrawFailed.error} fieldErrors={withdrawFailed.fieldErrors} />
          )}
          <input type="hidden" name="productId" value={productId} />
          <Withdraw />
        </form>
      </div>
    );
  }

  if (!canSubmit) {
    // `internal_review` onwards is ours. Saying so beats a screen with no controls
    // and no explanation.
    return (
      <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">In our hands</h2>
          <StatusBadge status={status} />
        </div>
        <p className="text-muted-foreground text-[13px]">
          This has passed review and is going through our own testing and readiness checks. We
          will tell you when it is on sale.
        </p>
      </div>
    );
  }

  return (
    <form
      action={submitAction}
      className="border-border flex flex-col gap-4 rounded-xl border p-5"
    >
      {submitFailed && (
        <FormErrors error={submitFailed.error} fieldErrors={submitFailed.fieldErrors} />
      )}

      <input type="hidden" name="productId" value={productId} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          {status === "changes_requested" ? "Send it back to us" : "Submit for review"}
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox id="attested" name="attested" required />
        <label htmlFor="attested" className="text-[13px] leading-relaxed">
          {attestationText}
        </label>
      </div>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
        <Submit
          disabled={!isPublishable}
          label={status === "changes_requested" ? "Resubmit" : "Submit for review"}
        />
        {!isPublishable && (
          <p className="text-subtle text-[12.5px]">
            Finish the items above first — a reviewer checks the same list.
          </p>
        )}
      </div>
    </form>
  );
}

function Submit({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Submitting…" : label}
    </Button>
  );
}

function Withdraw() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="w-fit" disabled={pending}>
      {pending ? "Withdrawing…" : "Withdraw submission"}
    </Button>
  );
}
