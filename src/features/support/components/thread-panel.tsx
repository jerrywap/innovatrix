"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, EyeOff, Loader2, Send } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { DISPUTE_REASONS } from "@/lib/db/enums";
import { raiseDisputeAsVendorAction, replyAsVendorAction } from "../actions";

/**
 * The vendor's side of a support thread — vendor ticket 13.
 *
 * ## Two audiences in one composer
 *
 * A vendor writes either to the customer or to us, and the control says which in plain words
 * rather than with a word like "internal". That matters because §37's boundary now has two edges:
 * a note to us is invisible to the customer, and staff notes about the *vendor* are invisible to
 * the vendor. Labelling the vendor's own option "internal" would suggest they can see the other
 * kind, which they cannot.
 *
 * The choice is a radio pair rather than a checkbox: "who reads this" has no sensible default that
 * is safe both ways round, and a mis-set checkbox on a customer-facing reply is the mistake with
 * the worst consequence.
 */
export function VendorThreadPanel({
  conversationId,
  entitlementId,
  hasOpenDispute,
}: {
  conversationId: string;
  entitlementId: string;
  hasOpenDispute: boolean;
}) {
  const [mode, setMode] = useState<"reply" | "dispute">("reply");

  return (
    <div className="flex flex-col gap-3">
      {mode === "reply" ? (
        <ReplyForm conversationId={conversationId} entitlementId={entitlementId} />
      ) : (
        <DisputeForm conversationId={conversationId} onCancel={() => setMode("reply")} />
      )}

      {mode === "reply" && !hasOpenDispute && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setMode("dispute")}
          className="w-fit"
        >
          <AlertTriangle className="size-3.5" aria-hidden />
          Raise a dispute
        </Button>
      )}

      {hasOpenDispute && (
        <p className="text-subtle text-[12.5px]">
          A dispute is open on this thread. Innovatrix decides it — anything you add to the
          conversation is read before a decision is made.
        </p>
      )}
    </div>
  );
}

function ReplyForm({
  conversationId,
  entitlementId,
}: {
  conversationId: string;
  entitlementId: string;
}) {
  const [state, submit] = useActionState(
    replyAsVendorAction as (
      previous: ActionResult<unknown> | null,
      formData: FormData,
    ) => Promise<ActionResult<unknown>>,
    null,
  );

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="entitlementId" value={entitlementId} />

      <textarea
        name="body"
        rows={3}
        required
        maxLength={5000}
        placeholder="The import fails on files over 10MB — 2.1 raises that limit, and I can send you a build today."
        className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
      />

      <fieldset className="flex flex-wrap gap-4 text-[12.5px]">
        <legend className="sr-only">Who reads this</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="audience" value="customer" defaultChecked />
          <Send className="size-3" aria-hidden />
          Reply to the customer
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="audience" value="vendor" />
          <EyeOff className="size-3" aria-hidden />
          Note for Innovatrix only
        </label>
      </fieldset>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit label="Send" />
    </form>
  );
}

/**
 * A vendor raising a dispute.
 *
 * The reasons are the same closed set the customer's form offers, deliberately: one queue, one
 * vocabulary, and a reason staff can count. A vendor-only enum would mean a dispute list that
 * cannot be grouped.
 */
function DisputeForm({
  conversationId,
  onCancel,
}: {
  conversationId: string;
  onCancel: () => void;
}) {
  const [state, submit] = useActionState(
    raiseDisputeAsVendorAction as (
      previous: ActionResult<unknown> | null,
      formData: FormData,
    ) => Promise<ActionResult<unknown>>,
    null,
  );

  return (
    <form
      action={submit}
      className="flex flex-col gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-4"
    >
      <input type="hidden" name="conversationId" value={conversationId} />

      <p className="text-[13px]">
        Raising a dispute brings Innovatrix in to decide it. Both you and the customer can see
        that it is open and what it says.
      </p>

      <label className="flex max-w-64 flex-col gap-1.5">
        <span className="text-[13px] font-medium">What is the problem?</span>
        <select
          name="reason"
          required
          defaultValue="abusive_buyer"
          className="border-border bg-background h-9 rounded-lg border px-2 text-[13px]"
        >
          {DISPUTE_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REASON_LABELS[reason] ?? reason}
            </option>
          ))}
        </select>
      </label>

      <textarea
        name="detail"
        rows={3}
        required
        maxLength={4000}
        placeholder="The licence key has been activated on 40 machines against a single-installation licence."
        className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
      />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Submit label="Raise it" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const REASON_LABELS: Record<string, string> = {
  not_as_described: "Not as described",
  does_not_work: "Does not work",
  refund_refused: "About a refund",
  no_response: "Nobody replied",
  abusive_buyer: "Abusive buyer",
  licence_misuse: "Licence misuse",
  unfair_review: "A review that breaks the rules",
  other: "Something else",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
