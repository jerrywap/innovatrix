"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Send, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors } from "./section-form";
import {
  submitCompleteOnRequestAction,
  withdrawCompleteOnRequestAction,
} from "@/features/vendors/product-actions";
import type { ActionResult } from "@/lib/action-result";
import type { AdminProductView } from "@/services/catalog/product-view";

/**
 * Sending the "complete on request" offer, and taking it back — COS-43.
 *
 * ## Why this is not a button inside the Options form
 *
 * `SectionForm` posts the whole section, so a submit control inside it would make
 * "save what I typed" and "ask staff to decide" the same click — and a vendor
 * correcting a typo would re-open an approved offer every time. Editing the words
 * and asking for a decision are two acts, so they are two forms.
 *
 * ## Which control shows
 *
 * One at a time, from the offer's own status. `pending` shows neither: the offer is
 * with staff, and a withdraw button there invites a vendor to yank it mid-decision
 * for no gain — they can withdraw once it is approved, which is when it matters.
 */
export function CompleteOnRequestPanel({ product }: { product: AdminProductView }) {
  const status = product.completeOnRequest.status;

  // A script has nothing to complete, and the service refuses one.
  if (product.catalogue !== "template") return null;

  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Complete on request</h2>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            Whether buyers can ask you to build the working application.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {status === "pending" ? (
        <p className="text-muted-foreground border-border border-t pt-3.5 text-[13px] leading-relaxed">
          With us now. Your listing is unchanged while we decide, and we&rsquo;ll email you
          either way.
        </p>
      ) : status === "approved" ? (
        <OfferForm
          action={withdrawCompleteOnRequestAction}
          productId={product.id}
          label="Stop offering this"
          icon={<Undo2 className="size-3.5" aria-hidden />}
          hint="Your listing stays exactly as it is. It just stops appearing to people looking for a complete application."
        />
      ) : (
        <OfferForm
          action={submitCompleteOnRequestAction}
          productId={product.id}
          label={status === "rejected" ? "Send it again" : "Send for approval"}
          icon={<Send className="size-3.5" aria-hidden />}
          hint="We check that you can deliver a backend before this goes live. Save what you would build first — we read it."
        />
      )}
    </div>
  );
}

function OfferForm({
  action,
  productId,
  label,
  icon,
  hint,
}: {
  /**
   * Either offer action. Typed by what this form needs rather than as one of the
   * two — they answer with different `data` shapes and the form reads neither.
   */
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  productId: string;
  label: string;
  icon: React.ReactNode;
  hint: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="border-border flex flex-col gap-2 border-t pt-3.5">
      <input type="hidden" name="productId" value={productId} />
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
      <Submit label={label} icon={icon} />
      <p className="text-subtle text-[12.5px] leading-relaxed">{hint}</p>
    </form>
  );
}

function Submit({ label, icon }: { label: string; icon: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted inline-flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition disabled:opacity-50"
    >
      {icon}
      {pending ? "Sending…" : label}
    </button>
  );
}
