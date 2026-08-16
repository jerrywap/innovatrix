"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveInterpretationAction } from "../actions";

/**
 * §34's other half — the staff reading, kept apart.
 *
 * This field exists so `customerRequirements` never has to be edited. A staff
 * member who thinks "shift swaps" means something more involved than the
 * customer wrote it down as writes that here, and both are on screen together.
 * Merging the two would destroy the only record of what the customer actually
 * agreed to, which is what a dispute turns on.
 */
export function InterpretationForm({
  requestId,
  reference,
  initial,
  canEdit,
}: {
  requestId: string;
  reference: string;
  initial: string;
  canEdit: boolean;
}) {
  const [state, submit] = useActionState(saveInterpretationAction, null);

  if (!canEdit) {
    if (!initial) return null;
    return (
      <section className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border border-dashed p-4">
        <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
          <NotebookPen className="text-subtle size-4" aria-hidden />
          Internal interpretation
        </h2>
        <p className="text-[13px] whitespace-pre-wrap">{initial}</p>
      </section>
    );
  }

  return (
    <form
      action={submit}
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border border-dashed p-4"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reference" value={reference} />

      <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
        <NotebookPen className="text-subtle size-4" aria-hidden />
        Internal interpretation
      </h2>
      <p className="text-subtle text-[12px]">
        Your reading of what they need. Never shown to the customer, and stored separately from
        what they confirmed.
      </p>

      <textarea
        name="text"
        defaultValue={initial}
        rows={4}
        maxLength={4000}
        className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        aria-label="Internal interpretation"
      />

      <Submit />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save note
    </Button>
  );
}
