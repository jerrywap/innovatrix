"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Switch } from "@/components/ui/switch";
import { toggleProviderAction } from "../actions";
import type { PaymentProvider } from "@/lib/db/enums";

/**
 * Enable/disable and test/live, as one form.
 *
 * Submitting on change rather than behind a Save button: there are two controls
 * and no draft state worth holding, so a separate save is a step that only
 * exists to be forgotten.
 */
export function ProviderToggle({
  provider,
  enabled,
  mode,
}: {
  provider: PaymentProvider;
  enabled: boolean;
  mode: "test" | "live";
}) {
  const [state, formAction] = useActionState(toggleProviderAction, null);

  return (
    <form action={formAction} className="flex items-center gap-4">
      <input type="hidden" name="provider" value={provider} />

      <label className="flex items-center gap-2 text-[12.5px]">
        <select
          name="mode"
          defaultValue={mode}
          className="border-border bg-background h-8 rounded-lg border px-2 font-mono text-[11.5px]"
        >
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-[13px]">
        <Switch name="enabled" value="on" defaultChecked={enabled} />
        Enabled
      </label>

      <Save />

      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
