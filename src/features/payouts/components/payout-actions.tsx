"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Upload } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PayoutStatus } from "@/lib/db/enums";
import {
  approvePayoutAction,
  cancelPayoutAction,
  confirmPayoutAction,
  failPayoutAction,
  requestEvidenceUploadAction,
  sendPayoutAction,
} from "../actions";

/**
 * The four decisions a staff member takes on a payout — vendor ticket 09.
 *
 * ## One control per state, and never two at once
 *
 * Which controls appear is driven by the status, so a payout in `sending` shows "confirm" and
 * "record a failure" and nothing else. That is cosmetic — every action re-checks its permission
 * and the state machine refuses an illegal edge — but the cosmetic layer is what stops somebody
 * approving a payout they have already sent and then wondering why nothing happened.
 *
 * ## Approve and send are separate buttons on purpose
 *
 * They answer different questions: "is this the right amount to the right vendor" and "has the
 * transfer been made". Collapsing them would mean the person checking the figures is also
 * confirming a bank transfer they may not have made yet — and with the `manual` driver, *is*
 * the person who has to make it.
 */
export function PayoutActions({
  payoutId,
  status,
  canApprove,
  canSend,
}: {
  payoutId: string;
  status: PayoutStatus;
  canApprove: boolean;
  canSend: boolean;
}) {
  return (
    <div className="no-print flex flex-col gap-4">
      {canApprove && status === "draft" && (
        <SimpleForm
          payoutId={payoutId}
          action={approvePayoutAction}
          label="Approve for payment"
          note="Releases it for transfer. It does not send anything."
        />
      )}

      {canSend && status === "approved" && (
        <SimpleForm
          payoutId={payoutId}
          action={sendPayoutAction}
          label="Mark as sending"
          note="Records that the transfer is going out. With a manual payout, make the transfer in your banking app and then confirm it below."
        />
      )}

      {canSend && status === "sending" && (
        <>
          <ConfirmForm payoutId={payoutId} />
          <ReasonForm
            payoutId={payoutId}
            action={failPayoutAction}
            label="Record a failure"
            placeholder="The bank rejected the account number."
            note="Puts it back in the queue with the reason. The earnings stay where they are — nothing is lost."
          />
        </>
      )}

      {canApprove && (status === "draft" || status === "approved" || status === "failed") && (
        <ReasonForm
          payoutId={payoutId}
          action={cancelPayoutAction}
          label="Cancel this payout"
          placeholder="Vendor asked us to hold it."
          note="Returns the earnings to the vendor's balance for a future run."
          destructive
        />
      )}
    </div>
  );
}

/**
 * The shape every action here shares.
 *
 * `ActionResult<unknown>` rather than a per-action payload type: these forms use the `ok` flag
 * and the error message and nothing else, and a generic would make three components carry a
 * type parameter to describe data none of them reads.
 */
type SimpleAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

function SimpleForm({
  payoutId,
  action,
  label,
  note,
}: {
  payoutId: string;
  action: SimpleAction;
  label: string;
  note: string;
}) {
  const [state, submit] = useActionState(action, null);

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <input type="hidden" name="payoutId" value={payoutId} />
      <p className="text-muted-foreground text-[13px]">{note}</p>
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      <Submit label={label} />
    </form>
  );
}

function ReasonForm({
  payoutId,
  action,
  label,
  placeholder,
  note,
  destructive,
}: {
  payoutId: string;
  action: SimpleAction;
  label: string;
  placeholder: string;
  note: string;
  destructive?: boolean;
}) {
  const [state, submit] = useActionState(action, null);

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <input type="hidden" name="payoutId" value={payoutId} />
      <p className="text-muted-foreground text-[13px]">{note}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Reason</span>
        {/* Required, and the vendor reads it. A blank reason turns "we did not pay you" into a
            mystery somebody has to reconstruct from an email thread. */}
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={500}
          placeholder={placeholder}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
        />
      </label>
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      <Submit label={label} variant={destructive ? "destructive" : "outline"} />
    </form>
  );
}

/**
 * Confirming a transfer, with the remittance advice.
 *
 * The upload is the **two-step round trip** every upload in this codebase uses: an action
 * returns a presigned `PUT`, the browser sends the bytes straight to S3, and only the key comes
 * back here. Bytes never pass through the Next.js server (AGENTS.md), and a Server Action's body
 * limit is something a phone photograph clears without trying.
 *
 * A client component with `useState` because the upload has to finish *before* the form is
 * submitted, and the key it produces is what the submit carries.
 */
function ConfirmForm({ payoutId }: { payoutId: string }) {
  const [state, submit] = useActionState(confirmPayoutAction, null);
  const [uploaded, setUploaded] = useState<{
    key: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const ticket = await requestEvidenceUploadAction({
        payoutId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        setUploadError(ticket.error);
        return;
      }

      const put = await fetch(ticket.data.url, {
        method: "PUT",
        body: file,
        headers: ticket.data.headers,
      });

      if (!put.ok) {
        // The bucket's own refusal — a size or type mismatch against the signed ticket, or
        // CORS. Reported rather than swallowed: a silent failure here means a payout confirmed
        // with no evidence behind it.
        setUploadError(`The upload was refused (${put.status}).`);
        return;
      }

      setUploaded({
        key: ticket.data.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={submit} className="border-border flex flex-col gap-3 rounded-xl border p-4">
      <input type="hidden" name="payoutId" value={payoutId} />
      {uploaded && (
        <>
          <input type="hidden" name="storageKey" value={uploaded.key} />
          <input type="hidden" name="filename" value={uploaded.filename} />
          <input type="hidden" name="contentType" value={uploaded.contentType} />
          <input type="hidden" name="sizeBytes" value={String(uploaded.sizeBytes)} />
        </>
      )}

      <p className="text-muted-foreground text-[13px]">
        Confirms the money has left. This settles the ledger entries behind it, which cannot be
        undone — a mistake is corrected with an adjustment.
      </p>

      <label className="flex max-w-72 flex-col gap-1.5">
        <span className="text-[13px] font-medium">Bank reference</span>
        <Input
          name="externalReference"
          maxLength={120}
          placeholder="FT26081700123"
          className="font-mono"
        />
        <span className="text-subtle text-[12px]">
          What the vendor will see on their statement. Optional, and worth the ten seconds.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Remittance advice</span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="text-[13px]"
        />
        {uploading && (
          <span className="text-subtle flex items-center gap-1.5 text-[12px]">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Uploading…
          </span>
        )}
        {uploaded && (
          <span className="flex items-center gap-1.5 text-[12px]">
            <Upload className="size-3" aria-hidden /> {uploaded.filename} attached
          </span>
        )}
        {uploadError && <span className="text-[12px] text-[var(--danger)]">{uploadError}</span>}
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit label="Confirm it has been paid" />
    </form>
  );
}

function Submit({
  label,
  variant = "outline",
}: {
  label: string;
  variant?: "outline" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
