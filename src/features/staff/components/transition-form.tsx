"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { transitionRequestAction } from "../actions";

/**
 * The moves this staff member may make — §91, §32.
 *
 * `actions` comes from `permittedTransitions`, which reads the same rules the
 * service enforces. So a button here always works and a missing button was
 * always going to be refused; the UI cannot get out of step with the machine
 * because it is not making the decision.
 *
 * The two notes are separate fields on purpose. §37: one of them the customer
 * reads and one they never do, and a single box with a checkbox is how the
 * wrong one gets sent.
 */
export function TransitionForm({
  requestId,
  reference,
  actions,
}: {
  requestId: string;
  reference: string;
  actions: { to: string; label: string }[];
}) {
  const [state, submit] = useActionState(transitionRequestAction, null);
  const [chosen, setChosen] = useState<string | null>(null);

  const action = actions.find((candidate) => candidate.to === chosen);

  return (
    <form action={submit} className="flex flex-col gap-2.5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reference" value={reference} />

      <div className="flex flex-wrap gap-2">
        {actions.map((candidate) => (
          <button
            key={candidate.to}
            type="button"
            onClick={() => setChosen(chosen === candidate.to ? null : candidate.to)}
            aria-pressed={chosen === candidate.to}
            className={
              chosen === candidate.to
                ? "bg-foreground text-background rounded-full px-3.5 py-1.5 text-[12.5px]"
                : "border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
            }
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {action && (
        <>
          <input type="hidden" name="to" value={action.to} />

          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium">
              What the customer sees
              <span className="text-subtle font-normal"> — optional</span>
            </span>
            <textarea
              name="note"
              rows={2}
              maxLength={500}
              placeholder={
                action.to === "waiting_for_customer"
                  ? "Which payroll system do you use?"
                  : "Leave blank for the standard wording"
              }
              className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium">
              Internal note
              <span className="text-subtle font-normal"> — the customer never sees this</span>
            </span>
            <textarea
              name="internalNote"
              rows={2}
              maxLength={2000}
              className="border-border bg-background rounded-lg border border-dashed px-3 py-2 text-[13px]"
            />
          </label>

          <Submit label={action.label} />
        </>
      )}

      {state?.ok === false && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[12.5px]">
          {state.error}
        </p>
      )}
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
