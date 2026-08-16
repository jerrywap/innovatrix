import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";
import type { QuoteView } from "../quote-view";

const KIND_LABEL: Record<string, string> = {
  development: "Development",
  service: "Service",
  licence: "Licence",
  third_party: "Third-party cost",
};

const TERMS_LABEL: Record<string, string> = {
  full_upfront: "Payable in full before work begins",
  deposit_balance: "Deposit up front, balance on completion",
  milestones: "Payable against agreed milestones",
};

/**
 * The quote itself — §51, and the thing that prints.
 *
 * ## This *is* the PDF
 *
 * Rather than generating a second document, the page carries a print
 * stylesheet and the browser's own Save-as-PDF produces the file. Three
 * consequences, all good:
 *
 * - It matches the screen exactly, because it *is* the screen. A generated PDF
 *   is a second layout that has to be kept in step, and the drift is silent.
 * - No dependency, no Chromium, no job queue to wait for.
 * - Re-rendering always produces the same document, because a quote version is
 *   immutable — a revision creates v2 and supersedes v1 rather than editing.
 *   That immutability is what makes storing a rendered artefact unnecessary.
 *
 * `pdfStorageKey` stays on the model for the day a branded, emailed attachment
 * is wanted (ticket 24), and is unused for now.
 *
 * ## Exclusions are as prominent as deliverables
 *
 * §51 makes exclusions a first-class field because they are what prevents a
 * dispute. Rendering them smaller, or in a collapsed section, would undo the
 * reason they exist.
 */
export function QuoteDocument({ quote }: { quote: QuoteView }) {
  const amount = (value: number) => money(value, quote.currency as CurrencyCode);

  return (
    <article className="quote-document border-border bg-surface flex flex-col gap-6 rounded-xl border p-6">
      <header className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Quotation
          </p>
          <h1 className="font-display mt-1 text-[22px] tracking-[-0.02em]">{quote.title}</h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            For {quote.organizationName}
            {quote.requestReference ? ` · against ${quote.requestReference}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px]">{quote.reference}</p>
          <p className="text-subtle font-mono text-[11px]">
            Version {quote.version}
            {quote.issuedAt ? ` · issued ${quote.issuedAt}` : ""}
          </p>
          <p
            className={
              quote.expired ? "text-[11px] text-[var(--danger)]" : "text-subtle text-[11px]"
            }
          >
            {quote.expired ? "Expired" : "Valid until"} {quote.expiresAt}
          </p>
        </div>
      </header>

      {quote.scope && (
        <Section title="Scope">
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{quote.scope}</p>
        </Section>
      )}

      {quote.deliverables.length > 0 && (
        <Section title="What you get">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px]">
            {quote.deliverables.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      )}

      {quote.exclusions.length > 0 && (
        // Same weight as deliverables, deliberately. §51 makes these
        // first-class because they are what prevents a dispute later.
        <Section title="What this doesn't include">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px]">
            {quote.exclusions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Price">
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
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-3 py-2 text-[13px]">
                    {item.description}
                    <span className="text-subtle block font-mono text-[10.5px]">
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[13px]">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-[13px]">
                    <MoneyDisplay value={amount(item.unitPrice.amount)} />
                  </td>
                  <td className="px-3 py-2 text-right text-[13px]">
                    <MoneyDisplay value={amount(item.lineTotal.amount)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-3 ml-auto flex w-full max-w-[18rem] flex-col gap-1 text-[13px]">
          <Row label="Subtotal" value={<MoneyDisplay value={amount(quote.subtotal)} />} />
          {quote.discount ? (
            <Row
              label="Discount"
              value={
                <>
                  −<MoneyDisplay value={amount(quote.discount)} />
                </>
              }
            />
          ) : null}
          {quote.tax ? (
            <Row
              label={`Tax${quote.tax.basisPoints ? ` (${quote.tax.basisPoints / 100}%)` : ""}`}
              value={<MoneyDisplay value={amount(quote.tax.amount)} />}
            />
          ) : null}
          <div className="border-border mt-1 flex items-baseline justify-between border-t pt-1.5">
            <dt className="text-[14px] font-medium">Total</dt>
            <dd className="text-[16px] font-medium">
              <MoneyDisplay value={amount(quote.total)} />
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Payment">
        <p className="text-[13.5px]">{TERMS_LABEL[quote.paymentTerms] ?? quote.paymentTerms}</p>
        {quote.deposit && (
          <p className="text-muted-foreground mt-1 text-[13px]">
            <MoneyDisplay value={amount(quote.deposit.amount)} /> ({quote.deposit.percent}%) to
            start, then <MoneyDisplay value={amount(quote.deposit.balance)} /> on completion.
          </p>
        )}
      </Section>

      {(quote.estimatedStart || quote.estimatedDurationDays) && (
        <Section title="Timing">
          <p className="text-[13.5px]">
            {quote.estimatedStart ? `Estimated start ${quote.estimatedStart}. ` : ""}
            {quote.estimatedDurationDays
              ? `Estimated ${quote.estimatedDurationDays} days of work.`
              : ""}
          </p>
          {/* §51 asks for explicit caveat language rather than a bare number
              that reads as a commitment. */}
          <p className="text-subtle mt-1 text-[12px]">
            These are estimates, not fixed dates. We&rsquo;ll agree a schedule with you before
            work starts.
          </p>
        </Section>
      )}

      {quote.notes && (
        <Section title="Notes">
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{quote.notes}</p>
        </Section>
      )}
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
