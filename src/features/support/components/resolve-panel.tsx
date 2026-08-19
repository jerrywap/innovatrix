"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Gavel, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISPUTE_OUTCOMES } from "@/lib/db/enums";
import { resolveDisputeAction } from "../actions";

/**
 * Deciding a dispute — vendor ticket 13.
 *
 * ## An outcome and a reason, both required
 *
 * `no_action` is in the outcome list deliberately: a dispute decided in the vendor's favour is a
 * real decision, and without that option a reviewer's only choices would be to act or to leave the
 * thread open. Leaving it open is how a dispute goes quiet, which is the one ending this structure
 * exists to make impossible.
 *
 * ## The reason is read by both parties, verbatim
 *
 * Which is why the field is required and the copy says who reads it. "Resolved in accordance with
 * our policies" is what gets written when nobody is told it will be quoted back at them.
 *
 * ## Choosing an outcome does not perform it
 *
 * A refund, a delisting, a review removal and a suspension each have their own screen, permission
 * and audit row. This records the decision; the action is taken deliberately afterwards, and the
 * copy under the control says so rather than leaving somebody to assume a refund has gone out.
 */
export function ResolvePanel({ conversationId }: { conversationId: string }) {
  const [state, submit] = useActionState(resolveDisputeAction, null);

  if (state?.ok) {
    return (
      <p className="text-subtle border-border rounded-lg border p-3 text-[12.5px]">
        Decided. Both parties have been told, with your reason.
      </p>
    );
  }

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <input type="hidden" name="conversationId" value={conversationId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-col gap-1.5">
          <span className="text-[13px] font-medium">Outcome</span>
          <select
            name="outcome"
            required
            defaultValue="no_action"
            className="border-border bg-background h-9 rounded-lg border px-2 text-[13px]"
          >
            {DISPUTE_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome] ?? outcome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Reason</span>
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={2000}
          placeholder="The version sold does have the documented import limit; 2.1 raises it and has been offered."
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
        <span className="text-subtle text-[12px]">
          The customer and the vendor both read this, word for word. Recording the outcome does
          not carry it out — a refund, a delisting or a suspension is a separate action on its
          own screen.
        </span>
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit />
    </form>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  refunded: "Refund the customer",
  product_delisted: "Delist the product",
  review_removed: "Remove the review",
  vendor_suspended: "Suspend the vendor",
  no_action: "No action — the vendor is in the right",
  other: "Something else",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Gavel className="size-3.5" aria-hidden />
      )}
      Record the decision
    </Button>
  );
}
