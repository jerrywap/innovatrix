"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordManualPaymentAction } from "../actions";
import { EvidenceFields, EvidencePicker, useEvidenceUpload } from "./evidence-upload";

/**
 * Record a bank transfer against an order — §7.9.
 *
 * ## This creates real licences with no provider confirming anything
 *
 * Which is why the amount is pre-filled with the order total and still checked
 * against it server-side (a mismatch lands in `requires_review` and fulfils
 * nothing), why it has its own permission, and why the whole thing is audited
 * with the staff member's id in the source.
 *
 * The receipt upload is `useEvidenceUpload` — the same one the invoice form
 * uses, because the draft-id-to-payment-id handshake it implements has to be
 * identical on both or `assertPaymentProofKey` refuses the attachment.
 */
export function RecordPayment({
  orderReference,
  total,
  currency,
}: {
  orderReference: string;
  total: string;
  currency: string;
}) {
  const [state, submit] = useActionState(recordManualPaymentAction, null);
  const upload = useEvidenceUpload();

  if (state?.ok) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-[13px]">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        <span>
          Payment recorded against {state.data.orderReference}. The customer&rsquo;s licences
          and downloads are live.
        </span>
      </p>
    );
  }

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4"
    >
      <input type="hidden" name="orderReference" value={orderReference} />
      <input type="hidden" name="draftId" value={upload.draftId} />
      <EvidenceFields evidence={upload.evidence} />

      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Record a payment</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          For a transfer that has landed. This releases the customer&rsquo;s software
          immediately, exactly as a card payment would.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Amount received</span>
          <Input name="amount" defaultValue={total} inputMode="decimal" required />
          <span className="text-subtle text-[12px]">
            Must match the order total, or nothing is released.
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
      Record payment and release
    </Button>
  );
}
