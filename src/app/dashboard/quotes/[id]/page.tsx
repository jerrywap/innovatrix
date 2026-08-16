import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { money, type CurrencyCode } from "@/lib/money";
import { requireOrg } from "@/lib/auth/dal";
import { loadQuote, QUOTE_STATUS_COPY } from "@/features/quotes/quote-view";
import { QuoteDocument } from "@/features/quotes/components/quote-document";
import { QuoteAnswer } from "@/features/quotes/components/answer";
import { recordFirstView } from "@/services/quotes/quote-service";

export const metadata: Metadata = { title: "Quote" };

/**
 * A quote, as the customer sees it — §51, §3.
 *
 * The document is the page, and the page is the PDF: `QuoteDocument` prints
 * through the stylesheet in `globals.css`, so what they save is exactly what
 * they read. Everything that is navigation or an action carries `no-print`.
 */
export default async function Page({ params }: PageProps<"/dashboard/quotes/[id]">) {
  const { id } = await params;
  const { organizationId } = await requireOrg();

  const quote = await loadQuote(id, { organizationId });
  if (!quote) notFound();

  // §51's audit trail. Fire-and-forget: failing to record a view must never
  // stop somebody reading their own quote.
  if (quote.status === "issued") {
    void recordFirstView(quote.id).catch(() => {});
  }

  const copy = QUOTE_STATUS_COPY[quote.status];

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print">
        <PageHeader
          title={`Quote ${quote.reference}`}
          description={quote.version > 1 ? `Version ${quote.version}` : undefined}
        />
      </div>

      <section className="no-print border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={quote.status} />
          {quote.expired && quote.status === "issued" && (
            <span className="rounded-full bg-[var(--danger)]/10 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--danger)] uppercase">
              expired
            </span>
          )}
        </div>
        <p className="text-[14px]">
          {/*
            An issued-but-lapsed quote reads as `issued` until the ticket-25
            sweep runs. The copy follows the date, the same way `actionable`
            does, so the customer is never told to accept something the server
            would refuse.
          */}
          {quote.expired && quote.status === "issued"
            ? QUOTE_STATUS_COPY.expired.what
            : copy.what}
        </p>
        <p className="text-muted-foreground text-[13px]">
          {quote.expired && quote.status === "issued"
            ? QUOTE_STATUS_COPY.expired.next
            : copy.next}
        </p>
      </section>

      <QuoteDocument quote={quote} />

      <QuoteAnswer
        quoteId={quote.id}
        total={quote.total}
        currency={quote.currency}
        {...(quote.deposit ? { depositAmount: quote.deposit.amount } : {})}
        actionable={quote.actionable}
      />

      {quote.history.length > 0 && (
        <section className="no-print flex flex-col gap-2">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Earlier versions</h2>
          <ul className="border-border divide-border divide-y rounded-xl border">
            {quote.history.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <Link
                  href={`/dashboard/quotes/${version.id}` as Route}
                  className="text-[13px] underline underline-offset-4"
                >
                  Version {version.version}
                </Link>
                <span className="flex items-center gap-2.5">
                  <MoneyDisplay value={money(version.total, quote.currency as CurrencyCode)} />
                  <StatusBadge status={version.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {quote.requestReference && (
        <p className="no-print text-subtle text-[12.5px]">
          <Link
            href={`/dashboard/requests/${quote.requestReference}` as Route}
            className="underline underline-offset-4"
          >
            ← Back to {quote.requestReference}
          </Link>
        </p>
      )}
    </div>
  );
}
