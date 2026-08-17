"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CURRENCY_CODES } from "@/lib/money";
import { recordAdjustmentAction } from "../money-actions";

/**
 * A manual ledger entry — vendor ticket 08.
 *
 * ## Why this form exists at all
 *
 * A ledger with no adjustment path grows a spreadsheet beside it, and then the spreadsheet
 * is the real ledger and the collection is a partial copy. Goodwill credits, chargeback
 * fees and corrections all happen, and each one is money that has to be *somewhere*.
 *
 * ## Signed, and labelled as signed
 *
 * A negative number is a deduction. The alternative — a "credit or debit" selector beside
 * a positive amount — reads fine and produces wrong entries, because the sign then lives
 * in a control somebody can leave on its default. One field, one sign, stated on the
 * screen.
 *
 * There is no "delete" here and never will be: a wrong adjustment is corrected by an
 * opposite one, which is what makes the balance's history readable.
 */
export function AdjustmentForm({
  vendorId,
  defaultCurrency,
}: {
  vendorId: string;
  defaultCurrency: string;
}) {
  const [state, submit] = useActionState(recordAdjustmentAction, null);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="vendorId" value={vendorId} />

      <div className="flex flex-wrap gap-3">
        <label className="flex max-w-36 flex-col gap-1.5">
          <span className="text-[13px] font-medium">Amount</span>
          <Input
            name="amount"
            type="number"
            step={0.01}
            required
            placeholder="-25.00"
            className="font-mono tabular-nums"
          />
        </label>

        <label className="flex max-w-28 flex-col gap-1.5">
          <span className="text-[13px] font-medium">Currency</span>
          <select
            name="currency"
            defaultValue={defaultCurrency}
            className="border-border bg-background h-9 rounded-lg border px-2 font-mono text-[13px]"
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Why</span>
        <textarea
          name="note"
          rows={2}
          required
          maxLength={500}
          placeholder="Chargeback fee on order ORD-2026-0114."
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
        />
        <span className="text-subtle text-[12px]">
          A positive amount credits the vendor; a negative one deducts. The vendor sees this
          note on their earnings screen, and it is the only explanation they will get — so write
          it for them rather than for us.
        </span>
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Recorded.</p>}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Record adjustment
    </Button>
  );
}
