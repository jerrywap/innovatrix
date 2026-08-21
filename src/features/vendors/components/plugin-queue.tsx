"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormErrors } from "@/features/products/components/section-form";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { money, type CurrencyCode } from "@/lib/money";
import { markPluginProvidedAction } from "../provisioning-actions";
import type { PendingProvisioning } from "@/services/checkout/provisioning-service";

/**
 * The vendor's plugin queue.
 *
 * `"use client"` for one reason: `useActionState` per row, so a failure on one
 * handover renders against that row rather than at the top of the page where the
 * vendor cannot tell which of five it belongs to.
 *
 * The order reference is shown; the buyer is not, and there is nothing here to
 * show them with. A vendor never learns who bought their product, so the message
 * they write is addressed to a line and the platform routes it.
 */
export function PluginQueue({ rows }: { rows: readonly PendingProvisioning[] }) {
  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {rows.map((row) => (
        <li key={`${row.orderReference}-${row.lineId}`} className="p-4">
          <PluginRow row={row} />
        </li>
      ))}
    </ul>
  );
}

function PluginRow({ row }: { row: PendingProvisioning }) {
  const [state, formAction] = useActionState(markPluginProvidedAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{row.addonName}</p>
          <p className="text-muted-foreground text-[12.5px]">Bought with {row.productName}</p>
          <p className="text-subtle mt-0.5 font-mono text-[11.5px]">
            {row.orderReference}
            {row.paidAt && ` · paid ${formatDateTime(row.paidAt)}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <MoneyDisplay
            value={money(row.amount, row.currency as CurrencyCode)}
            className="text-[13.5px]"
          />
          <StatusBadge status="pending" />
        </div>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="orderReference" value={row.orderReference} />
        <input type="hidden" name="lineId" value={row.lineId} />

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">What are you sending them?</span>
          <textarea
            name="body"
            required
            rows={3}
            placeholder="The licence key, the account details, or how to get them — this goes straight to the customer."
            className="border-border bg-surface focus-visible:ring-signal/40 rounded-lg border px-3 py-2 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
          />
          <span className="text-subtle text-[11.5px]">
            Required. This is the message the customer receives, so it is also the record that
            you sent it.
          </span>
        </label>

        {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

        <Submit />
      </form>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background self-start rounded-full px-4 py-2 text-[13px] font-medium transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send and mark provided"}
    </button>
  );
}
