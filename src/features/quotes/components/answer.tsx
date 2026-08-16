"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Printer, X } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { answerQuoteAction } from "../actions";

/**
 * Accept · Decline · Print — §51.
 *
 * ## Accepting asks again, and restates the number
 *
 * §51 requires a confirmation restating the total and terms. Not politeness:
 * this click creates a contract, and the difference between "Accept" and
 * "Accept £10,800 including VAT, 50% now" is whether somebody can later say
 * they did not know what they were agreeing to.
 *
 * Declining does not confirm — it is reversible by asking for another quote,
 * and a dialog in front of "no" reads as pressure.
 */
export function QuoteAnswer({
  quoteId,
  total,
  currency,
  depositAmount,
  actionable,
}: {
  quoteId: string;
  total: number;
  currency: string;
  depositAmount?: number;
  actionable: boolean;
}) {
  const [state, submit] = useActionState(answerQuoteAction, null);
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);

  return (
    <div className="no-print flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="border-border hover:bg-surface-muted flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px]"
        >
          <Printer className="size-3.5" aria-hidden />
          Save as PDF
        </button>

        {actionable && !confirming && !declining && (
          <>
            <Button type="button" onClick={() => setConfirming(true)} className="w-fit">
              <Check className="size-3.5" aria-hidden />
              Accept this quote
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeclining(true)}
              className="w-fit"
            >
              <X className="size-3.5" aria-hidden />
              Decline
            </Button>
          </>
        )}
      </div>

      {confirming && (
        <form
          action={submit}
          className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4"
        >
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="answer" value="accepted" />

          <div>
            <h3 className="font-display text-[15.5px] tracking-[-0.02em]">
              Accept this quote?
            </h3>
            <p className="text-muted-foreground mt-1 text-[13px]">
              You&rsquo;re agreeing to{" "}
              <strong className="text-foreground font-medium">
                <MoneyDisplay value={money(total, currency as CurrencyCode)} />
              </strong>
              {depositAmount ? (
                <>
                  , with{" "}
                  <strong className="text-foreground font-medium">
                    <MoneyDisplay value={money(depositAmount, currency as CurrencyCode)} />
                  </strong>{" "}
                  payable to start
                </>
              ) : null}
              . We&rsquo;ll send the invoice and get going.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Confirm />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-subtle hover:text-foreground text-[12.5px]"
            >
              Not yet
            </button>
          </div>
        </form>
      )}

      {declining && (
        <form
          action={submit}
          className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4"
        >
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="answer" value="rejected" />

          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-medium">
              What didn&rsquo;t work? <span className="text-subtle font-normal">Optional</span>
            </span>
            <textarea
              name="reason"
              rows={2}
              maxLength={1000}
              placeholder="Over budget, wrong scope, timing…"
              className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
            />
          </label>

          <div className="flex items-center gap-2">
            <Decline />
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="text-subtle hover:text-foreground text-[12.5px]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {state?.ok === false && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]">
          {state.error}
        </p>
      )}
    </div>
  );
}

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Yes, accept it
    </Button>
  );
}

function Decline() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Decline the quote
    </Button>
  );
}
