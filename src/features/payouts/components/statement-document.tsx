import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, formatDay } from "@/lib/dates";
import type { Statement } from "@/services/payouts/statement";
import { BRAND } from "@/config/brand";

/**
 * The self-billed statement — vendor ticket 09, and the thing that prints.
 *
 * Same approach as `InvoiceDocument` and `QuoteDocument`: the page *is* the document, through
 * the print stylesheet in `globals.css`. There is no PDF pipeline in the platform and ticket 25
 * declined to add headless Chromium for one — and a second layout to keep in step with this
 * one would drift silently.
 *
 * What makes that safe rather than merely cheap is that every input is immutable: a paid
 * payout's `entryIds` never change, ledger entries are append-only, and the order lines behind
 * them were frozen at checkout. Re-rendering next year produces the same document.
 *
 * ## It says who issued it
 *
 * "Issued by {legal entity} on behalf of {vendor}" is on its face, because the platform is
 * merchant of record and the vendor never invoiced the customer. A document that looked like a
 * vendor invoice would misrepresent who charged whom — which matters to a tax authority rather
 * than only to us.
 *
 * The **legal** name, not the brand, and this is the one place that distinction is not
 * pedantry: a self-billed statement is a tax document, and the entity that took the customer's
 * money is what a tax authority needs to see. `BRAND.name` appears on the rest of the site.
 */
export function StatementDocument({ statement }: { statement: Statement }) {
  return (
    <article className="quote-document border-border bg-surface flex flex-col gap-6 rounded-xl border p-6">
      <header className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Self-billed payout statement
          </p>
          <h1 className="font-display mt-1 text-[22px] tracking-[-0.02em]">
            {statement.vendor.displayName}
          </h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Issued by {BRAND.legalName} (trading as {BRAND.name}) on behalf of{" "}
            {statement.vendor.displayName}, who did not invoice the customer — {BRAND.legalName}{" "}
            is the seller of record.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[13px]">{statement.reference}</p>
          <p className="text-subtle font-mono text-[11px]">
            {formatDay(statement.periodStart)} – {formatDay(statement.periodEnd)}
          </p>
          {statement.paidAt && (
            <p className="text-subtle font-mono text-[11px]">
              Paid {formatDateTime(statement.paidAt)}
            </p>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[34rem] text-left">
            <thead className="border-border bg-surface-muted border-b">
              <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                <th className="px-3 py-2 font-normal">Item</th>
                <th className="px-3 py-2 font-normal">Order</th>
                <th className="px-3 py-2 text-right font-normal">Sale</th>
                <th className="px-3 py-2 text-right font-normal">Commission</th>
                <th className="px-3 py-2 text-right font-normal">You earn</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y text-[13px]">
              {statement.lines.map((line) => (
                <tr key={line.entryId}>
                  <td className="px-3 py-2">
                    {line.productName ?? LINE_LABELS[line.kind] ?? line.kind}
                    {line.note && (
                      <span className="text-subtle block text-[11.5px]">{line.note}</span>
                    )}
                  </td>
                  <td className="text-subtle px-3 py-2 font-mono text-[11.5px]">
                    {line.orderReference ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MoneyDisplay value={line.gross ?? null} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MoneyDisplay value={line.commission ?? null} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MoneyDisplay value={line.net} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-border bg-surface-muted border-t text-[13px]">
              <tr>
                <td className="px-3 py-2 font-medium" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyDisplay value={statement.totals.gross} />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyDisplay value={statement.totals.commission} />
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  <MoneyDisplay value={statement.amount} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-4 text-[13px] sm:grid-cols-2">
        <div>
          <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            This payout
          </h2>
          <dl className="mt-1.5 flex flex-col gap-1">
            <Row label="Status">
              <StatusBadge status={statement.status} />
            </Row>
            <Row label="Method">{statement.method}</Row>
            {statement.externalReference && (
              <Row label="Bank reference">
                <span className="font-mono text-[12.5px]">{statement.externalReference}</span>
              </Row>
            )}
          </dl>
        </div>

        {statement.vendor.account && (
          <div>
            <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              Paid to
            </h2>
            <dl className="mt-1.5 flex flex-col gap-1">
              {statement.vendor.account.accountName && (
                <Row label="Account">{statement.vendor.account.accountName}</Row>
              )}
              {statement.vendor.account.bankName && (
                <Row label="Bank">{statement.vendor.account.bankName}</Row>
              )}
              {/* Masked, even here. The last four digits confirm which account; the whole
                  number on a printable page is a document somebody leaves on a desk. */}
              {statement.vendor.account.masked && (
                <Row label="Number">
                  <span className="font-mono">{statement.vendor.account.masked}</span>
                </Row>
              )}
            </dl>
          </div>
        )}
      </section>

      <footer className="border-border flex flex-col gap-1.5 border-t pt-4">
        <p className="text-muted-foreground text-[12.5px]">{statement.taxNote}</p>
        <p className="text-subtle text-[12px]">
          {statement.final
            ? "This statement is final. The earnings it settles cannot change, so it will read the same whenever you open it."
            : "This payout has not been sent yet, so the figures below can still change if a sale is refunded."}
        </p>
      </footer>
    </article>
  );
}

const LINE_LABELS: Record<string, string> = {
  earning: "Sale",
  refund: "Refund",
  adjustment: "Adjustment",
  payout: "Payout",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="text-subtle min-w-24 text-[12px]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
