"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveQuoteDraftAction } from "../actions";
import { toDateInputValue } from "@/lib/dates";

const KINDS = [
  ["development", "Development"],
  ["service", "Service"],
  ["licence", "Licence"],
  ["third_party", "Third-party cost"],
] as const;

/**
 * Writing a quote — §51.
 *
 * ## The requirements sit beside it, not behind it
 *
 * §51: *"Show the requirements alongside the builder so the quote is written
 * against what was actually agreed."* The page puts them in the next column;
 * this form assumes they are visible and does not repeat them.
 *
 * ## Totals are not calculated here
 *
 * A running total in the browser would be a second implementation of
 * `computeTotals`, and the two would eventually disagree about rounding. The
 * server prices the draft and the staff member previews the result — one
 * arithmetic, and the one that ends up in the contract.
 *
 * ## Scope, deliverables and exclusions are three fields
 *
 * §51 makes exclusions first-class because they are what prevents a dispute.
 * One prose box would let somebody skip them without noticing they had.
 */
export function QuoteBuilder({
  requestId,
  reference,
  organizationId,
  currency,
  defaultTitle,
  vendorQuote,
}: {
  requestId: string;
  reference: string;
  organizationId: string;
  currency: string;
  defaultTitle: string;
  /**
   * Vendor ticket 14 — a vendor has priced this, and their figure prefills the first line.
   *
   * Prefilled rather than locked. The vendor's number is what *they* are owed and it is fixed on the
   * brief; what the customer is quoted is staff's call, and any excess is platform margin. A read-only
   * field would imply the two are the same, and a staff member wanting margin would work around it by
   * adding a second line — which is worse, because then neither number means what it says.
   *
   * Only `briefId` is posted. Everything about the money is re-read from the brief on the server.
   */
  vendorQuote?: {
    briefId: string;
    vendorName: string;
    /** Decimal, for the input. The server converts from the brief, not from this. */
    amountDecimal: string;
    effort: string;
  };
}) {
  const [state, submit] = useActionState(saveQuoteDraftAction, null);
  const [rows, setRows] = useState([0]);
  const [nextRow, setNextRow] = useState(1);
  const [terms, setTerms] = useState<"full_upfront" | "deposit_balance" | "milestones">(
    "full_upfront",
  );

  /*
   * §51's 30-day default, computed in a `useState` initialiser rather than
   * inline in the JSX. `Date.now()` during render is impure — React's
   * `purity` rule flags it, and the practical hazard is a value that differs
   * between the server render and hydration.
   */
  const [defaultExpiry] = useState(() =>
    toDateInputValue(new Date(Date.now() + 30 * 86_400_000)),
  );

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="currency" value={currency} />
      {vendorQuote && <input type="hidden" name="briefId" value={vendorQuote.briefId} />}

      {vendorQuote && (
        <p className="rounded-lg border border-[var(--signal)]/40 bg-[var(--signal)]/5 px-3 py-2.5 text-[13px]">
          {vendorQuote.vendorName} priced this at{" "}
          <span className="font-mono">
            {vendorQuote.amountDecimal} {currency}
          </span>{" "}
          — {vendorQuote.effort}. That figure is what they are owed, and it is prefilled below.
          Quote higher if we are adding to it; the difference is ours.
        </p>
      )}

      <Field label="Title">
        <Input name="title" defaultValue={defaultTitle} maxLength={200} required />
      </Field>

      <Field label="Scope" hint="What the work is, in a paragraph or two.">
        <textarea
          name="scope"
          rows={4}
          maxLength={4000}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </Field>

      <Field label="What they get" hint="One per line.">
        <textarea
          name="deliverables"
          rows={4}
          maxLength={4000}
          placeholder={"Shift scheduling\nTimesheets\nPayroll export"}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </Field>

      <Field
        label="What this doesn't include"
        hint="One per line. These are what prevent an argument later — worth being specific."
      >
        <textarea
          name="exclusions"
          rows={3}
          maxLength={4000}
          placeholder={"Payroll processing itself\nData migration from the old system"}
          className="border-border bg-background rounded-lg border border-dashed px-3 py-2 text-[13px]"
        />
      </Field>

      {/* ── lines ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="text-[13.5px] font-medium">Lines</span>

        {rows.map((row, index) => (
          <div
            key={row}
            className="border-border bg-surface grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_6rem_2rem]"
          >
            <div className="flex flex-col gap-1.5">
              <Input
                name={`items[${index}][description]`}
                placeholder="Build the rota module"
                maxLength={300}
                required
                aria-label={`Line ${index + 1} description`}
                {...(index === 0 && vendorQuote
                  ? { defaultValue: `${defaultTitle} — built by the vendor` }
                  : {})}
              />
              <select
                name={`items[${index}][kind]`}
                // `third_party` for a vendor's work, which is what it is: the platform is reselling
                // somebody else's development. The category already existed in `QUOTE_ITEM_KINDS`.
                defaultValue={index === 0 && vendorQuote ? "third_party" : "development"}
                className="border-border bg-background rounded-lg border px-2.5 py-1.5 text-[12.5px]"
                aria-label={`Line ${index + 1} kind`}
              >
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <Input
              name={`items[${index}][unitPrice]`}
              placeholder="8000.00"
              inputMode="decimal"
              required
              aria-label={`Line ${index + 1} unit price in ${currency}`}
              {...(index === 0 && vendorQuote
                ? { defaultValue: vendorQuote.amountDecimal }
                : {})}
            />
            <Input
              name={`items[${index}][quantity]`}
              type="number"
              min="1"
              max="9999"
              defaultValue="1"
              aria-label={`Line ${index + 1} quantity`}
            />

            <button
              type="button"
              onClick={() => setRows((current) => current.filter((r) => r !== row))}
              disabled={rows.length === 1}
              className="text-subtle hover:text-foreground self-start p-1.5 disabled:opacity-30"
            >
              <Trash2 className="size-3.5" aria-hidden />
              <span className="sr-only">Remove line {index + 1}</span>
            </button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRows((current) => [...current, nextRow]);
            setNextRow((n) => n + 1);
          }}
          className="w-fit"
        >
          <Plus className="size-3.5" aria-hidden />
          Add a line
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Discount (${currency})`} hint="Optional, off the subtotal.">
          <Input name="discount" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label="Tax" hint="Basis points — 2000 is 20%.">
          <Input name="taxBasisPoints" type="number" min="0" max="10000" placeholder="2000" />
        </Field>
      </div>

      <Field label="Payment terms">
        <select
          name="paymentTerms"
          value={terms}
          onChange={(event) => setTerms(event.target.value as typeof terms)}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        >
          <option value="full_upfront">In full, before work begins</option>
          <option value="deposit_balance">Deposit, then balance on completion</option>
          <option value="milestones">Against milestones</option>
        </select>
      </Field>

      {terms === "deposit_balance" && (
        <Field label="Deposit" hint="Percent of the total.">
          <Input name="depositPercent" type="number" min="1" max="99" defaultValue="50" />
        </Field>
      )}

      {terms === "milestones" && (
        // §51 records milestone terms for MVP; tracking them is post-MVP, and
        // saying so here beats a staff member expecting a schedule to appear.
        <p className="text-subtle text-[12px]">
          Recorded on the quote. Milestone tracking itself comes later — describe the schedule
          in the notes for now.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Estimated start">
          <Input name="estimatedStart" type="date" />
        </Field>
        <Field label="Estimated days">
          <Input name="estimatedDurationDays" type="number" min="1" max="3650" />
        </Field>
        <Field label="Valid until" hint="Default 30 days.">
          <Input name="expiresAt" type="date" required defaultValue={defaultExpiry} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          name="notes"
          rows={3}
          maxLength={4000}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </Field>

      {state?.ok === false && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Save />
        <span className="text-subtle text-[12px]">
          Saved as a draft. You&rsquo;ll see exactly what the customer sees before it goes
          anywhere.
        </span>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13.5px] font-medium">{label}</span>
      {hint && <span className="text-subtle text-[12px]">{hint}</span>}
      {children}
    </label>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save draft
    </Button>
  );
}
