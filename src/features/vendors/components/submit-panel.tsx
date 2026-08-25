"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors } from "@/features/products/components/section-form";
import { submitForReviewAction, withdrawSubmissionAction } from "../product-actions";
import { toDecimalString } from "@/features/products/components/money-input";
import { CURRENCIES } from "@/lib/money";
import type { ActionResult } from "@/lib/action-result";

/** The create-sibling action, by shape rather than by import — see `templateOffer`. */
type TemplateCreateAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<{ templateId: string; href: string }>>;

/** What the offer needs to make the same call the panel above makes. */
export interface TemplateOfferInput {
  productId: string;
  productName: string;
  /** This product's advertised price, in minor units — the template starts at the same. */
  prices: ReadonlyArray<{ currency: string; amount: number }>;
  createAction: TemplateCreateAction;
}

/**
 * Submitting, and withdrawing — vendor ticket 05.
 *
 * ## The attestation is the point of this screen
 *
 * Not a formality. Recorded with the person, the timestamp and the wording's version,
 * it is the record a takedown is weighed against (vendor ticket 13) — the difference
 * between "they said they had the rights" and "they accepted this text, on this date".
 * So the words are shown in full rather than hidden behind a link, and the box is
 * unchecked by default.
 *
 * ## What is not here
 *
 * No publish button, at any status. A vendor moves a product to `submitted` and a
 * reviewer takes it from there — and the absence of the control is the *smaller* half
 * of that guarantee: `productService.transition` reads
 * `PRODUCT_TRANSITION_RULES` and refuses the edge for a vendor actor whatever gets
 * POSTed.
 */
export function SubmitPanel({
  productId,
  status,
  isPublishable,
  attestationText,
  templateOffer,
}: {
  productId: string;
  status: string;
  isPublishable: boolean;
  attestationText: string;
  /**
   * The "do you also want the website template?" offer, shown once submitted.
   *
   * Only supplied when it is a real question — a `script` with no sibling yet. The
   * page decides that, because it is the thing holding the documents; passing an
   * absent prop is how it says "not applicable" rather than this component
   * re-deriving the rule.
   */
  templateOffer?: TemplateOfferInput;
}) {
  const [submitState, submitAction] = useActionState(submitForReviewAction, null);
  const [withdrawState, withdrawAction] = useActionState(withdrawSubmissionAction, null);

  const submitFailed = submitState && !submitState.ok ? submitState : null;
  const withdrawFailed = withdrawState && !withdrawState.ok ? withdrawState : null;

  // `draft` and `changes_requested` are the two states a vendor submits from —
  // the same two `PRODUCT_TRANSITION_RULES` marks `vendorMay`.
  const canSubmit = status === "draft" || status === "changes_requested";
  const canWithdraw = status === "submitted";

  if (canWithdraw) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[15.5px] tracking-[-0.02em]">With us now</h2>
            <StatusBadge status={status} />
          </div>
          <p className="text-muted-foreground text-[13px]">
            Somebody will read it and either put it on sale or tell you what to change. You can
            pull it back until a reviewer starts.
          </p>

          <form action={withdrawAction} className="flex flex-col gap-2">
            {withdrawFailed && (
              <FormErrors
                error={withdrawFailed.error}
                fieldErrors={withdrawFailed.fieldErrors}
              />
            )}
            <input type="hidden" name="productId" value={productId} />
            <Withdraw />
          </form>
        </div>

        {templateOffer && <TemplateOffer offer={templateOffer} />}
      </div>
    );
  }

  if (!canSubmit) {
    // `internal_review` onwards is ours. Saying so beats a screen with no controls
    // and no explanation.
    return (
      <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">In our hands</h2>
          <StatusBadge status={status} />
        </div>
        <p className="text-muted-foreground text-[13px]">
          This has passed review and is going through our readiness checks. We will tell you
          when it is on sale.
        </p>
      </div>
    );
  }

  return (
    <form
      action={submitAction}
      className="border-border flex flex-col gap-4 rounded-xl border p-5"
    >
      {submitFailed && (
        <FormErrors error={submitFailed.error} fieldErrors={submitFailed.fieldErrors} />
      )}

      <input type="hidden" name="productId" value={productId} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          {status === "changes_requested" ? "Send it back to us" : "Submit for review"}
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox id="attested" name="attested" required />
        <label htmlFor="attested" className="text-[13px] leading-relaxed">
          {attestationText}
        </label>
      </div>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
        <Submit
          disabled={!isPublishable}
          label={status === "changes_requested" ? "Resubmit" : "Submit for review"}
        />
        {!isPublishable && (
          <p className="text-subtle text-[12.5px]">
            Finish the items above first — a reviewer checks the same list.
          </p>
        )}
      </div>
    </form>
  );
}

function Submit({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Submitting…" : label}
    </Button>
  );
}

/**
 * The step after submitting: do you want the front-end listing too?
 *
 * ## Why here and not on the panel above
 *
 * The template panel higher up the page asks the same question *before* the
 * submit button, which is the right place for a vendor who already knows they want
 * both. This is for the one who did not — and the moment they are most able to
 * answer is the moment they have just finished, when the shape of the work is
 * fresh and the next form is empty.
 *
 * ## "No" must not claim a draft was saved
 *
 * The obvious copy — "the draft was saved, you can return to it" — is *false* when
 * the vendor declines, because declining creates nothing. So No says what actually
 * happened: nothing, and here is where to change your mind. The saved-draft
 * sentence belongs to Yes, and `TemplateSiblingPanel` already says it there.
 */
function TemplateOffer({ offer }: { offer: TemplateOfferInput }) {
  const [state, formAction, pending] = useActionState(offer.createAction, null);
  const [declined, setDeclined] = useState(false);

  const created = state && state.ok ? state.data : null;
  const failed = state && !state.ok ? state.error : null;

  if (created) {
    return (
      <div className="border-border bg-surface-muted/40 flex flex-col gap-2 rounded-xl border p-5">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          The website template draft is ready
        </h2>
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          It has the name, summary, pricing and description carried over. The description is
          marked as needing a read — it still describes a backend the template does not have —
          and it needs its own front-end download, screenshots and a template category before it
          can go on sale.
        </p>
        <a
          href={created.href}
          className="text-signal-text w-fit text-[13px] underline underline-offset-4"
        >
          Start on the template listing →
        </a>
      </div>
    );
  }

  if (declined) {
    return (
      <p className="text-muted-foreground border-border rounded-xl border border-dashed p-4 text-[13px] leading-relaxed">
        No template listing was created. You can add one any time from this product&rsquo;s
        review step — nothing about {offer.productName} changes either way.
      </p>
    );
  }

  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-5">
      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          Do you want the website template version of {offer.productName} too?
        </h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
          The same design without the backend, as a second listing in the template catalogue. We
          will start it as a draft with what we can carry over from this one.
        </p>
      </div>

      {failed && <p className="text-destructive text-[12.5px]">{failed}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {/*
          The price comes from this product's cheapest package rather than a field:
          the offer is a yes/no at a moment when the vendor is finishing, and asking
          for a number here would turn it back into a form. It is editable on the
          template's own pricing step, which the copy above points at.
        */}
        <form action={formAction}>
          <input type="hidden" name="productId" value={offer.productId} />
          {/*
            The attestation the panel above collects with a checkbox. Pressing "Yes,
            continue" *is* the confirmation here — there is nothing else the button
            could mean — so a second tick would be ceremony.
          */}
          <input type="hidden" name="confirm" value="on" />
          {/*
            This product's own price, carried over. `templateSiblingSchema` requires
            at least one currency, and asking for a number would turn a yes/no back
            into a form at the moment the vendor is trying to finish. Editable on the
            template's own pricing step, which the copy above points at.
          */}
          {offer.prices.map((price) => (
            <input
              key={price.currency}
              type="hidden"
              name={`prices[${price.currency}]`}
              value={toDecimalString(
                price.amount,
                CURRENCIES[price.currency as keyof typeof CURRENCIES]?.exponent ?? 2,
              )}
            />
          ))}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Yes, continue"}
          </Button>
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDeclined(true)}>
          No, not now
        </Button>
      </div>
    </div>
  );
}

function Withdraw() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="w-fit" disabled={pending}>
      {pending ? "Withdrawing…" : "Withdraw submission"}
    </Button>
  );
}
