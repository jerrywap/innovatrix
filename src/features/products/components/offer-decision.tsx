"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { FormErrors } from "./section-form";
import { decideCompleteOnRequestAction } from "../review-actions";

/**
 * Approving or refusing a "complete on request" offer — COS-43.
 *
 * ## What is actually being decided
 *
 * Not the listing. The template is already published and stays exactly as it is
 * either way; what staff are judging is whether **this vendor can deliver a
 * backend**, which is why the form asks about capability and not about the product.
 *
 * ## The note is required on a refusal, and the vendor reads it
 *
 * Same rule as `review-decision.tsx`: "rejected" on its own is not something
 * anybody can act on, and the wording reaching the vendor unedited is what makes a
 * resubmission worth attempting. The service refuses a refusal without one, so the
 * requirement survives a direct POST.
 *
 * There is deliberately **no** staff-only note here. `review-decision.tsx` has one
 * because a submission is a conversation with a history; a capability decision is a
 * yes or a no, and a second box invites the reviewer to write the real reason where
 * the vendor cannot read it.
 */
export function OfferDecision({ productId }: { productId: string }) {
  const [state, formAction] = useActionState(decideCompleteOnRequestAction, null);
  const failed = state && !state.ok ? state : null;
  const decided = state?.ok === true;

  if (decided) {
    return (
      <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-300">
        <Check className="mr-1 inline size-3.5" aria-hidden />
        {state.data.outcome === "approved"
          ? "Approved. The offer is live on the listing."
          : "Sent back, with your note."}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="productId" value={productId} />

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Why <span className="text-subtle font-normal">— required to send it back</span>
        </span>
        <Textarea
          name="note"
          rows={3}
          maxLength={1000}
          placeholder="We need to see something you have already built end to end before we can offer this."
        />
        <span className="text-subtle text-[12.5px]">The vendor reads this word for word.</span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Decide
          value="approved"
          label="They can deliver"
          className="bg-foreground text-background"
          icon={<Check className="size-3.5" aria-hidden />}
        />
        <Decide
          value="rejected"
          label="Send it back"
          className="border-border border"
          icon={<X className="size-3.5" aria-hidden />}
        />
      </div>
    </form>
  );
}

/**
 * Both buttons submit the one form, distinguished by `name="outcome"`.
 *
 * `useFormStatus` reports on the form rather than the button, so both disable
 * together — which is right: two live buttons during a decision is how the same
 * offer gets approved and refused in the same second.
 */
function Decide({
  value,
  label,
  className,
  icon,
}: {
  value: "approved" | "rejected";
  label: string;
  className: string;
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="outcome"
      value={value}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition disabled:opacity-50 ${className}`}
    >
      {icon}
      {pending ? "Saving…" : label}
    </button>
  );
}
