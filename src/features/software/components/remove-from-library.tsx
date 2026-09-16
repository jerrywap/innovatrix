"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { setLibraryHiddenAction } from "../actions";

/**
 * "Remove" on a free download — a client island in an otherwise server card.
 *
 * ## The word is the customer's, the behaviour is not a delete
 *
 * Nothing is erased: the action stamps `hiddenAt` on the entitlement, which only
 * the library listing reads. The licence stands, the append-only download log is
 * untouched (§66), and a link they already have keeps working. The copy below
 * says so in the one place a person will read it — at the moment they click —
 * because "remove" without that reads as destroying something they may want back.
 *
 * ## `<form action={fn}>` is safe here
 *
 * The house rule against it (`AGENTS.md`) is about forms containing a Radix
 * control, which answer React's pre-action `form.reset()` by reverting to a ref
 * captured on first render. This form has two hidden inputs and a button, so
 * there is nothing to revert and no reason for the manual-dispatch workaround.
 */
export function RemoveFromLibrary({ entitlementId }: { entitlementId: string }) {
  const [state, formAction] = useActionState(setLibraryHiddenAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="entitlementId" value={entitlementId} />
      <input type="hidden" name="hidden" value="true" />
      <Submit />
      {failed && (
        <p role="alert" className="text-destructive w-full text-[12px]">
          {failed.error}
        </p>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition disabled:opacity-50"
      /*
        The reassurance belongs on the control rather than in a confirm dialog.
        A dialog for something this reversible is ceremony, and the sentence that
        removes the worry is short enough to be a tooltip.
      */
      title="Takes it off this list. You can download it again any time."
    >
      <X className="size-3.5" aria-hidden />
      {pending ? "Removing…" : "Remove"}
      <span className="sr-only"> from My Purchases — you can download it again any time</span>
    </button>
  );
}
