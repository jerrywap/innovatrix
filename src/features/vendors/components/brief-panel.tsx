"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Ban, Loader2, Send, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrors } from "@/features/products/components/section-form";
import type { ActionResult } from "@/lib/action-result";
import {
  declineBriefAction,
  replyAsVendorOnBriefAction,
  submitProposalAction,
} from "../brief-actions";

type Action = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

/**
 * What a vendor does with a brief — vendor ticket 14.
 *
 * Three things, and the shape of the screen says which is the main one: **price it**. Asking a
 * question is a form below it, and declining is behind a deliberate second click, because a decline
 * is a decision staff have to relay to a customer and it should not be one keystroke from a reply.
 *
 * ## The composer has no audience control
 *
 * `VendorThreadPanel` on the support screen has a radio pair — write to the customer, or write to
 * us. This one does not, and its absence is the mediation: **there is no customer on this thread**.
 * A vendor cannot address the buyer, cannot see the buyer's messages, and cannot see who they are.
 * Offering a control that says "the customer will read this" would be a lie about where the message
 * goes, and offering one that says "only Innovatrix reads this" would imply the other option exists.
 *
 * So the copy says what is true: staff read it, and staff decide what the customer is told.
 */
export function BriefPanel({
  briefId,
  currency,
  /** `sent` — waiting on the vendor. Anything else and pricing is closed. */
  open,
}: {
  briefId: string;
  /** The customer's currency, resolved server-side. A vendor does not choose what they are paid in. */
  currency: string;
  open: boolean;
}) {
  const [declining, setDeclining] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      {open && !declining && <ProposalForm briefId={briefId} currency={currency} />}

      {open && declining && (
        <DeclineForm briefId={briefId} onCancel={() => setDeclining(false)} />
      )}

      <ReplyForm briefId={briefId} />

      {open && !declining && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDeclining(true)}
          className="w-fit"
        >
          <Ban className="size-3.5" aria-hidden />
          We can&rsquo;t take this on
        </Button>
      )}
    </div>
  );
}

function ProposalForm({ briefId, currency }: { briefId: string; currency: string }) {
  const [state, submit] = useActionState(submitProposalAction as Action, null);
  const failed = state && !state.ok ? state : null;

  if (state?.ok) {
    return (
      <p className="rounded-xl border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-4 text-[13px]">
        Sent. We will come back to you once the customer has decided.
      </p>
    );
  }

  return (
    <form action={submit} className="border-border flex flex-col gap-4 rounded-xl border p-5">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="briefId" value={briefId} />
      <input type="hidden" name="currency" value={currency} />

      <div>
        <h3 className="font-display flex items-center gap-2 text-[15px] tracking-[-0.02em]">
          <Tag className="text-subtle size-4" aria-hidden />
          What would this cost?
        </h3>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Your figure for the work, before our commission. We quote the customer and handle the
          invoice — you are not billing them directly.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Price ({currency})</span>
        {/*
          A decimal, and the server converts. The client never multiplies money: a `× 100` here
          would be wrong for JPY, which has no minor unit, and `fromDecimal` is the only thing that
          knows each currency's exponent.
        */}
        <Input
          name="amount"
          required
          inputMode="decimal"
          pattern="[0-9]+([.,][0-9]{1,2})?"
          title="A number, with up to two decimal places."
          placeholder="2400"
          className="font-mono"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Roughly how long</span>
        <Input
          name="effort"
          required
          maxLength={400}
          placeholder="About a week, once we have their logo files"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Anything this depends on{" "}
          <span className="text-subtle font-normal">— optional, and we pass it on</span>
        </span>
        <textarea
          name="caveats"
          rows={3}
          maxLength={4000}
          className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
          placeholder="Assumes their host runs PHP 8.2 or later."
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Price good until <span className="text-subtle font-normal">— optional</span>
        </span>
        {/* A date input, not "30 days": a vendor knows their own diary and we should not guess. */}
        <Input name="validUntil" type="date" className="w-fit" />
      </label>

      <Submit label="Send this price" pending="Sending…" />
    </form>
  );
}

function DeclineForm({ briefId, onCancel }: { briefId: string; onCancel: () => void }) {
  const [state, submit] = useActionState(declineBriefAction as Action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form
      action={submit}
      className="flex flex-col gap-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-5"
    >
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="briefId" value={briefId} />

      <h3 className="font-display text-[15px] tracking-[-0.02em]">Turning this one down</h3>
      <p className="text-[13px]">
        Tell us why and we will explain it to the customer. &ldquo;No capacity until
        March&rdquo; and &ldquo;that change would break every other install&rdquo; need
        completely different things said to them, so the reason matters more than the refusal.
      </p>

      <textarea
        name="reason"
        rows={3}
        required
        maxLength={2000}
        className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
      />

      <div className="flex flex-wrap gap-2">
        <Submit label="Decline it" pending="Sending…" />
        <Button type="button" variant="ghost" onClick={onCancel} className="w-fit">
          Never mind
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ briefId }: { briefId: string }) {
  const [state, submit] = useActionState(replyAsVendorOnBriefAction as Action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={submit} className="flex flex-col gap-2">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="briefId" value={briefId} />

      <label htmlFor={`ask-${briefId}`} className="text-[13px] font-medium">
        Ask us something
      </label>
      <textarea
        id={`ask-${briefId}`}
        name="body"
        rows={3}
        required
        maxLength={5000}
        className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
        placeholder="Do they need this on their existing install, or a fresh one?"
      />
      {/* Said plainly, because a vendor who thinks they are writing to the buyer will write
          something different — and because there is no control here implying they could. */}
      <p className="text-subtle text-[12.5px]">
        This comes to us, not to the customer. We pass on what needs passing on.
      </p>

      <Submit label="Send" pending="Sending…" icon />
    </form>
  );
}

function Submit({
  label,
  pending: pendingLabel,
  icon,
}: {
  label: string;
  pending: string;
  icon?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : icon ? (
        <Send className="size-3.5" aria-hidden />
      ) : null}
      {pending ? pendingLabel : label}
    </Button>
  );
}
