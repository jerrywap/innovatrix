"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action-result";

/**
 * Activate / deactivate.
 *
 * The word is "Deactivate", never "Delete", and that is not softening: the row
 * genuinely survives. An order placed with this code two years ago must still
 * resolve it when support looks the order up.
 */
export function ToggleActive({
  id,
  isActive,
  action,
}: {
  id: string;
  isActive: boolean;
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <Submit isActive={isActive} />
      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

function Submit({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-50"
    >
      {pending ? "…" : isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
