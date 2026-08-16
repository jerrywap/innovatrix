"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CreditCard, Loader2, Printer } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { payInvoiceAction } from "../actions";

/**
 * Pay Now · Save as PDF — §63.
 *
 * ## The button names the amount
 *
 * Same reasoning as the quote confirmation: this click moves money, and "Pay
 * £5,400" is a different promise from "Pay". On a part-paid invoice the figure
 * is the *outstanding* balance, not the total, because that is what will
 * actually be charged.
 *
 * ## Paying by transfer needs no button
 *
 * The bank details are rendered beside this, not behind a control. A customer
 * who has chosen to pay by transfer should not have to click anything to be
 * told where to send it.
 */
export function PayInvoice({
  invoiceId,
  outstanding,
  currency,
  payable,
  online,
}: {
  invoiceId: string;
  outstanding: number;
  currency: string;
  payable: boolean;
  /** Whether any provider can take this currency. */
  online: boolean;
}) {
  const [state, submit] = useActionState(payInvoiceAction, null);

  return (
    <div className="no-print flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="border-border hover:bg-surface-muted flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px]"
        >
          <Printer className="size-3.5" aria-hidden />
          Save as PDF
        </button>

        {payable && online && (
          <form action={submit}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <Pay amount={outstanding} currency={currency} />
          </form>
        )}
      </div>

      {payable && !online && (
        <p className="text-muted-foreground text-[12.5px]">
          {/* Honest rather than a dead button: no provider we use takes this
              currency, so a transfer is the route. */}
          We can&rsquo;t take a card payment in {currency} — please pay by transfer using the
          details below.
        </p>
      )}

      {state?.ok === false && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]">
          {state.error}
        </p>
      )}
    </div>
  );
}

function Pay({ amount, currency }: { amount: number; currency: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <CreditCard className="size-3.5" aria-hidden />
      )}
      Pay <MoneyDisplay value={money(amount, currency as CurrencyCode)} />
    </Button>
  );
}
