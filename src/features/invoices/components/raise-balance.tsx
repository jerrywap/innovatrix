"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { raiseBalanceInvoiceAction } from "../actions";

/**
 * Raise the balance invoice — §63, §52.
 *
 * Staff-triggered because nothing else knows the work is finished. The action
 * is idempotent, so a double click produces one invoice rather than two.
 */
export function RaiseBalance({ quoteId }: { quoteId: string }) {
  const [state, submit] = useActionState(raiseBalanceInvoiceAction, null);

  if (state?.ok) {
    return (
      <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px]">
        Balance invoice {state.data.reference} raised.
      </p>
    );
  }

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4"
    >
      <input type="hidden" name="quoteId" value={quoteId} />
      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Work finished?</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          The deposit is settled. Raise the balance invoice when the work is done — the customer
          gets it immediately.
        </p>
      </div>
      <Raise />
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
    </form>
  );
}

function Raise() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <FilePlus2 className="size-3.5" aria-hidden />
      )}
      Raise the balance invoice
    </Button>
  );
}
