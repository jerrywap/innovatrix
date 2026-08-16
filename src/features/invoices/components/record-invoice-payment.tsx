"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EvidenceFields,
  EvidencePicker,
  useEvidenceUpload,
} from "@/features/payments/components/evidence-upload";
import { recordInvoicePaymentAction } from "../actions";

/**
 * Record a transfer against an invoice — §63, and the second caller of Part A's
 * machinery.
 *
 * ## The amount defaults to the outstanding balance, not the total
 *
 * A part-paid invoice's total is the wrong number to pre-fill: accepting it
 * would be an overpayment, which the service refuses outright. Defaulting to
 * what is actually owed means the common case is one click.
 *
 * ## A partial amount is allowed here, unlike on an order
 *
 * An order pays in full or fulfils nothing, because the thing being released is
 * indivisible. An invoice takes instalments by design, so the only server-side
 * refusal is paying *more* than is owed.
 */
export function RecordInvoicePayment({
  invoiceId,
  outstanding,
  currency,
}: {
  invoiceId: string;
  /** Major units, already formatted — the server re-parses with `fromDecimal`. */
  outstanding: string;
  currency: string;
}) {
  const [state, submit] = useActionState(recordInvoicePaymentAction, null);
  const upload = useEvidenceUpload();

  if (state?.ok) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px]">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        <span>
          {state.data.outcome === "paid"
            ? "Payment recorded. This invoice is settled in full."
            : "Payment recorded. There's still a balance outstanding."}
        </span>
      </p>
    );
  }

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="draftId" value={upload.draftId} />
      <EvidenceFields evidence={upload.evidence} />

      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Record a payment</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          For a transfer that has landed against this invoice.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Amount received</span>
          <Input name="amount" defaultValue={outstanding} inputMode="decimal" required />
          <span className="text-subtle text-[12px]">
            Part payments are fine. More than the balance is refused.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Currency</span>
          <Input name="currency" defaultValue={currency} readOnly className="font-mono" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Bank reference <span className="text-subtle font-normal">— optional</span>
        </span>
        <Input
          name="bankReference"
          maxLength={120}
          placeholder="What appeared on the statement"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Note <span className="text-subtle font-normal">— internal</span>
        </span>
        <textarea
          name="note"
          rows={2}
          maxLength={1000}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </label>

      <EvidencePicker
        evidence={upload.evidence}
        uploading={upload.uploading}
        error={upload.error}
        onPick={(file) => void upload.upload(file)}
        fileRef={upload.fileRef}
      />

      {state?.ok === false && (
        <p className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden />
          <span>{state.error}</span>
        </p>
      )}

      <Submit disabled={upload.uploading} />
    </form>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Record payment
    </Button>
  );
}
