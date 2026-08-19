"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_REASON_CODES } from "@/lib/db/enums";
import type { ActionResult } from "@/lib/action-result";
import { FormErrors } from "./section-form";
import {
  approveSubmissionAction,
  claimSubmissionAction,
  requestChangesAction,
} from "../review-actions";

/**
 * Deciding a submission — vendor ticket 05.
 *
 * ## Two textareas, and the difference between them is the whole §37 rule
 *
 * `detail` is shown to the vendor **verbatim**. `internalNote` is staff-only: it is
 * stored on the product and no vendor-facing loader selects it, so it is absent from
 * their payload rather than present-and-hidden. The labels say which is which, in
 * those words, because a reviewer who is unsure will put the wrong thing in the wrong
 * box.
 *
 * ## Separate forms per decision
 *
 * Not one form with an intent switch. Each decision is its own server action with its
 * own guard, and the reason requirement differs between them — "request changes"
 * cannot happen without prose, "approve" can. One form would put the choice of what
 * happens inside a request body and make the required-ness conditional on it.
 */
export function ReviewDecision({
  productId,
  status,
  /**
   * Already approved — `internal_review` alone cannot tell us. That status means either
   * "somebody claimed it" or "somebody approved it", and the two want different screens.
   */
  decided,
}: {
  productId: string;
  status: string;
  decided?: boolean;
}) {
  const [claimState, claim] = useActionState(claimSubmissionAction, null);
  const claimFailed = claimState && !claimState.ok ? claimState : null;

  const canClaim = status === "submitted";
  const canDecide = status === "submitted" || status === "internal_review";

  if (!canDecide || decided) {
    return (
      <p className="text-muted-foreground text-[13px]">
        {decided
          ? "Approved, and in our own pipeline now — testing, then the readiness gate, then publishing from the product’s admin screen."
          : "This is past the submission stage — it moves through the ordinary publishing pipeline from here."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {canClaim && (
        <form action={claim} className="flex flex-col gap-2">
          {claimFailed && (
            <FormErrors error={claimFailed.error} fieldErrors={claimFailed.fieldErrors} />
          )}
          <input type="hidden" name="productId" value={productId} />
          <div className="flex flex-wrap items-center gap-3">
            <Submit label="Start review" variant="outline" pendingLabel="Claiming…" />
            <p className="text-subtle text-[12.5px]">
              Marks it as yours so two people don&rsquo;t read the same submission.
            </p>
          </div>
        </form>
      )}

      <Decision
        productId={productId}
        action={requestChangesAction}
        heading="Send it back"
        detailLabel="What needs changing"
        detailHint="The vendor reads this word for word. Required."
        detailRequired
        submitLabel="Request changes"
        showReasons
      />

      <Decision
        productId={productId}
        action={approveSubmissionAction}
        heading="Approve"
        detailLabel="Anything to pass on"
        detailHint="Optional. The vendor reads this."
        submitLabel="Approve into our pipeline"
        note="Approving is not publishing — it goes into our own testing and readiness checks, exactly like a first-party product."
      />
    </div>
  );
}

function Decision({
  productId,
  action,
  heading,
  detailLabel,
  detailHint,
  detailRequired,
  submitLabel,
  showReasons,
  note,
}: {
  productId: string;
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  heading: string;
  detailLabel: string;
  detailHint: string;
  detailRequired?: boolean;
  submitLabel: string;
  showReasons?: boolean;
  note?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;
  const id = `${heading.replace(/\s+/g, "-").toLowerCase()}-${productId}`;

  return (
    <form
      action={formAction}
      className="border-border flex flex-col gap-3 rounded-xl border p-5"
    >
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="productId" value={productId} />

      <h3 className="font-display text-[14.5px] tracking-[-0.02em]">{heading}</h3>
      {note && <p className="text-muted-foreground text-[13px]">{note}</p>}

      {showReasons && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[13px] font-medium">
            Why <span className="text-subtle font-normal">(the vendor sees these)</span>
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {REVIEW_REASON_CODES.map((code) => (
              <label key={code} className="flex items-center gap-1.5 text-[12.5px] capitalize">
                <input type="checkbox" name="reasons" value={code} />
                {code}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`detail-${id}`} className="text-[13px] font-medium">
          {detailLabel}
        </label>
        <Textarea
          id={`detail-${id}`}
          name="detail"
          rows={3}
          maxLength={4000}
          required={detailRequired}
        />
        <p className="text-subtle text-[12.5px]">{detailHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`internal-${id}`} className="text-[13px] font-medium">
          Internal note <span className="text-subtle font-normal">(staff only)</span>
        </label>
        <Textarea id={`internal-${id}`} name="internalNote" rows={2} maxLength={4000} />
        {/* Said plainly, because the consequence of getting it wrong is a reviewer's
            private assessment reaching the person it is about. The rule is §37; the
            reviewer does not need the section number, and printing one in a hint is how
            our internal shorthand ends up on somebody else's screen. */}
        <p className="text-subtle text-[12.5px]">
          Never sent to the vendor, and not in anything they can load.
        </p>
      </div>

      <Submit label={submitLabel} pendingLabel="Saving…" />
    </form>
  );
}

function Submit({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant ?? "default"} className="w-fit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
