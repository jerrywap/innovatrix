"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Landmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { saveOfflineInstructionsAction } from "../actions";

/**
 * Bank details, shown to customers who choose to pay by transfer.
 *
 * The one field on this screen that holds a *value* rather than an env-var
 * name — and deliberately so. A provider secret must never be in the database;
 * bank details must be, because the customer has to see them.
 *
 * Empty means the option disappears from checkout. That is the off switch, and
 * it is the right one: an empty instructions box and an enabled flag would
 * offer a payment route with no destination.
 */
export function OfflineSettings({
  enabled,
  instructions,
}: {
  enabled: boolean;
  instructions: string;
}) {
  const [state, submit] = useActionState(saveOfflineInstructionsAction, null);

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
        <Landmark className="text-subtle size-4" aria-hidden />
        Bank transfer
      </h2>

      <label className="flex items-start gap-2.5 text-[13.5px]">
        <Checkbox
          name="offlineEnabled"
          value="on"
          defaultChecked={enabled}
          className="mt-0.5"
        />
        <span>
          Offer bank transfer at checkout
          <span className="text-subtle block text-[12px]">
            The order is placed unpaid and nothing is released until somebody records the
            payment against it.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">What the customer sees</span>
        <textarea
          name="offlineInstructions"
          defaultValue={instructions}
          rows={6}
          maxLength={2000}
          placeholder={
            "Account name: Innovatrix Ltd\nSort code: 00-00-00\nAccount number: 12345678"
          }
          className="border-border bg-background rounded-lg border px-3 py-2 font-mono text-[12.5px]"
        />
        <span className="text-subtle text-[12px]">
          Shown with the order reference and amount. Leave this empty to turn the option off
          however the tickbox is set — a payment route with no destination is worse than none.
        </span>
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save
    </Button>
  );
}
