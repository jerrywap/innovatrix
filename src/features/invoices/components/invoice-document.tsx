import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";
import type { InvoiceView } from "../invoice-view";

const KIND_LABEL: Record<string, string> = {
  development: "Development",
  service: "Service",
  licence: "Licence",
  third_party: "Third-party cost",
};

const PORTION_LABEL: Record<string, string> = {
  full: "Invoice",
  deposit: "Deposit invoice",
  balance: "Balance invoice",
};

/**
 * The invoice itself — §63, and the thing that prints.
 *
 * Same approach as `QuoteDocument`: the page *is* the PDF, through the print
 * stylesheet in `globals.css`. An invoice is a better fit for it than a quote
 * even — its figures are snapshotted at creation and never change, so a
 * re-render months later produces byte-identical output.
 *
 * ## A deposit invoice shows the whole job and then what's due now
 *
 * The lines are the entire piece of work, because that is what the money is
 * for. Collapsing them into one "50% deposit" row would produce a document
 * nobody can reconcile against the quote they signed. What differs is the
 * summary: the job total, the portion being invoiced, and the amount payable.
 */
export function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const amount = (value: number) => money(value, invoice.currency as CurrencyCode);
  const partial = invoice.portion !== "full";

  return (
    <article className="quote-document border-border bg-surface flex flex-col gap-6 rounded-xl border p-6">
      <header className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            {PORTION_LABEL[invoice.portion] ?? "Invoice"}
          </p>
          <h1 className="font-display mt-1 text-[22px] tracking-[-0.02em]">
            {invoice.quote?.title ?? invoice.reference}
          </h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            For {invoice.organizationName}
            {invoice.quote ? ` · against ${invoice.quote.reference}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px]">{invoice.reference}</p>
          {invoice.issuedAt && (
            <p className="text-subtle font-mono text-[11px]">Issued {invoice.issuedAt}</p>
          )}
          {invoice.dueAt && (
            <p
              className={
                invoice.overdue ? "text-[11px] text-[var(--danger)]" : "text-subtle text-[11px]"
              }
            >
              {invoice.overdue ? "Was due" : "Due"} {invoice.dueAt}
            </p>
          )}
        </div>
      </header>

      <Section title="What this covers">
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[30rem] text-left">
            <thead className="border-border bg-surface-muted border-b">
              <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                <th className="px-3 py-2 font-normal">Item</th>
                <th className="px-3 py-2 font-normal">Qty</th>
                <th className="px-3 py-2 text-right font-normal">Unit</th>
                <th className="px-3 py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {invoice.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-3 py-2 text-[13px]">
                    {item.description}
                    <span className="text-subtle block font-mono text-[10.5px]">
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[13px]">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-[13px]">
                    <MoneyDisplay value={amount(item.unitPrice)} />
                  </td>
                  <td className="px-3 py-2 text-right text-[13px]">
                    <MoneyDisplay value={amount(item.lineTotal)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-3 ml-auto flex w-full max-w-[19rem] flex-col gap-1 text-[13px]">
          <Row label="Subtotal" value={<MoneyDisplay value={amount(invoice.subtotal)} />} />
          {invoice.tax ? (
            <Row
              label={`Tax${invoice.tax.basisPoints ? ` (${invoice.tax.basisPoints / 100}%)` : ""}`}
              value={<MoneyDisplay value={amount(invoice.tax.amount)} />}
            />
          ) : null}

          {/*
            On a deposit or balance invoice the line totals above are the whole
            job, so the figure that matters is stated separately rather than
            left to be inferred from a table that adds up to something else.
          */}
          <div className="border-border mt-1 flex items-baseline justify-between border-t pt-1.5">
            <dt className="text-[14px] font-medium">
              {partial ? `This ${invoice.portion}` : "Total"}
            </dt>
            <dd className="text-[16px] font-medium">
              <MoneyDisplay value={amount(invoice.total)} />
            </dd>
          </div>

          {invoice.amountPaid > 0 && (
            <>
              <Row
                label="Paid"
                value={
                  <>
                    −<MoneyDisplay value={amount(invoice.amountPaid)} />
                  </>
                }
              />
              <div className="border-border flex items-baseline justify-between border-t pt-1.5">
                <dt className="text-[14px] font-medium">Outstanding</dt>
                <dd className="text-[16px] font-medium">
                  <MoneyDisplay value={amount(invoice.outstanding)} />
                </dd>
              </div>
            </>
          )}
        </dl>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
