"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormErrors } from "@/features/products/components/section-form";
import { reviewApplicationAction, decideVerificationAction } from "../actions";

/**
 * Staff decisions on a vendor — vendor tickets 01 and 02.
 *
 * Two panels, two permissions, two forms. `vendor.review` decides whether somebody
 * may sell here at all; `vendor.verify` decides whether the evidence behind an
 * identity holds up. They are separate because their blast radii are: the first is
 * a commercial call, the second is what eventually lets money leave the platform.
 *
 * The reason box is shared markup and *not* shared state — a rejection reason typed
 * into the application panel must not end up on a verification decision.
 */

export function ApplicationDecision({
  vendorId,
  status,
  canVerify,
}: {
  vendorId: string;
  status: string;
  canVerify: boolean;
}) {
  const [state, formAction] = useActionState(reviewApplicationAction, null);
  const failed = state && !state.ok ? state : null;

  const canStart = status === "applied";
  // Verifying requires identity to be approved first; the service refuses
  // otherwise, and `canVerify` is what stops the button being offered when it
  // would only produce that refusal.
  const canApprove = status === "in_review" && canVerify;
  const canReject = status === "applied" || status === "in_review";

  if (!canStart && !canApprove && !canReject) return null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="vendorId" value={vendorId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-reason" className="text-[13px] font-medium">
          Reason <span className="text-subtle font-normal">(required to reject)</span>
        </label>
        <Textarea
          id="review-reason"
          name="reason"
          rows={3}
          maxLength={1000}
          placeholder="The applicant reads this verbatim."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {canStart && <Decide value="start_review" label="Start review" variant="outline" />}
        {canApprove && <Decide value="verify" label="Approve and verify" />}
        {canReject && <Decide value="reject" label="Reject" variant="outline" />}
      </div>

      {status === "in_review" && !canVerify && (
        <p className="text-subtle text-[12.5px]">
          Approve the identity level below before verifying the vendor — that is the gate on
          listing a product, and the service refuses without it.
        </p>
      )}
    </form>
  );
}

export function VerificationDecision({
  vendorId,
  level,
  documentCount,
}: {
  vendorId: string;
  level: "identity" | "business";
  documentCount: number;
}) {
  const [state, formAction] = useActionState(decideVerificationAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="vendorId" value={vendorId} />
      <input type="hidden" name="level" value={level} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${level}`} className="text-[13px] font-medium">
          Note <span className="text-subtle font-normal">(required to reject)</span>
        </label>
        <Textarea
          id={`note-${level}`}
          name="note"
          rows={2}
          maxLength={1000}
          placeholder="What was wrong, in words the vendor can act on."
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Outcome value="approved" label="Approve" />
        <Outcome value="rejected" label="Reject" variant="outline" />
        <span className="text-subtle text-[12.5px]">
          {documentCount === 0
            ? "No documents uploaded yet."
            : `Deciding removes the ${documentCount} document${documentCount === 1 ? "" : "s"} and keeps only the outcome.`}
        </span>
      </div>
    </form>
  );
}

function Decide({
  value,
  label,
  variant,
}: {
  value: string;
  label: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={value}
      variant={variant ?? "default"}
      disabled={pending}
    >
      {pending ? "Working…" : label}
    </Button>
  );
}

function Outcome({
  value,
  label,
  variant,
}: {
  value: string;
  label: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="outcome"
      value={value}
      variant={variant ?? "default"}
      size="sm"
      disabled={pending}
    >
      {pending ? "Working…" : label}
    </Button>
  );
}
