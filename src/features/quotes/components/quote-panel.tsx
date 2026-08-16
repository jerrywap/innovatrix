"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { Loader2, Receipt, Send } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { money, type CurrencyCode } from "@/lib/money";
import { issueQuoteAction } from "../actions";
import type { ListedQuote } from "../quote-view";

/**
 * Quotes on a request, from the staff side — §30, §51.
 *
 * ## Issue is separated from draft, and it looks it
 *
 * Saving a draft is reversible; issuing sends a number to a customer who may
 * act on it. So issuing is its own button, on its own row, and it only appears
 * for somebody holding `quote.issue` — the service refuses otherwise, and a
 * button that is going to be refused is worse than no button.
 */
export function QuotePanel({
  requestReference,
  quotes,
  canDraft,
  canIssue,
}: {
  requestReference: string;
  quotes: ListedQuote[];
  canDraft: boolean;
  canIssue: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
          <Receipt className="text-subtle size-4" aria-hidden />
          Quotes
        </h2>
        {canDraft && (
          <Link
            href={`/staff/requests/${requestReference}/quote/new` as Route}
            className="border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
          >
            {quotes.length === 0 ? "Write a quote" : "Write a revision"}
          </Link>
        )}
      </div>

      {quotes.length === 0 ? (
        <p className="text-subtle border-border rounded-xl border px-4 py-3 text-[12.5px]">
          Nothing quoted yet.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {quotes.map((quote) => (
            <li key={quote.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[13.5px]">{quote.title}</span>
                  <span className="text-subtle font-mono text-[11px]">
                    {quote.reference} v{quote.version} · valid until {quote.expiresAt}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <MoneyDisplay value={money(quote.total, quote.currency as CurrencyCode)} />
                  <StatusBadge status={quote.status} />
                </span>
              </div>

              {quote.status === "draft" && canIssue && (
                <IssueForm quoteId={quote.id} reference={requestReference} />
              )}
              {quote.status === "draft" && !canIssue && (
                <p className="text-subtle text-[12px]">
                  Somebody with permission to issue quotes needs to send this.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueForm({ quoteId, reference }: { quoteId: string; reference: string }) {
  const [state, submit] = useActionState(issueQuoteAction, null);

  return (
    <form action={submit} className="flex flex-col gap-1.5">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="reference" value={reference} />
      <Issue />
      {state?.ok === false && <p className="text-[12px] text-[var(--danger)]">{state.error}</p>}
    </form>
  );
}

function Issue() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Send className="size-3.5" aria-hidden />
      )}
      Send it to the customer
    </button>
  );
}
