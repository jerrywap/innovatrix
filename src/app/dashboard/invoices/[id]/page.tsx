import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { money, type CurrencyCode } from "@/lib/money";
import { requireOrgRoleOrForbid } from "@/lib/auth/dal";
import { loadInvoice, INVOICE_STATUS_COPY } from "@/features/invoices/invoice-view";
import { InvoiceDocument } from "@/features/invoices/components/invoice-document";
import { PayInvoice } from "@/features/invoices/components/pay-invoice";
import { offlinePaymentAvailability } from "@/services/payments/offline";
import { providersFor } from "@/services/payments/registry";

export const metadata: Metadata = { title: "Invoice" };

/**
 * An invoice, as the customer sees it — §63, §3.
 *
 * The document is the page and the page is the PDF, exactly as with a quote.
 * Everything that is an action or navigation carries `no-print`, so the saved
 * file is the invoice and nothing else.
 */
export default async function Page({ params }: PageProps<"/dashboard/invoices/[id]">) {
  const { id } = await params;
  const { organizationId } = await requireOrgRoleOrForbid(["owner", "admin", "billing"]);

  const invoice = await loadInvoice(id, { organizationId });
  if (!invoice) notFound();

  const [offline, providers] = await Promise.all([
    offlinePaymentAvailability(),
    providersFor(invoice.currency as CurrencyCode),
  ]);

  const copy = INVOICE_STATUS_COPY[invoice.effectiveStatus];

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print">
        <PageHeader
          title={`Invoice ${invoice.reference}`}
          {...(invoice.quote ? { description: `From quote ${invoice.quote.reference}` } : {})}
        />
      </div>

      <section className="no-print border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={invoice.effectiveStatus} />
          {invoice.payable && (
            <span className="text-[13px]">
              <MoneyDisplay
                value={money(invoice.outstanding, invoice.currency as CurrencyCode)}
              />{" "}
              outstanding
            </span>
          )}
        </div>
        <p className="text-[14px]">{copy.what}</p>
        <p className="text-muted-foreground text-[13px]">{copy.next}</p>
      </section>

      <InvoiceDocument invoice={invoice} />

      <PayInvoice
        invoiceId={invoice.id}
        outstanding={invoice.outstanding}
        currency={invoice.currency}
        payable={invoice.payable}
        online={providers.length > 0}
      />

      {invoice.payable && offline.available && (
        <section className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Paying by transfer
          </h2>
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {offline.instructions}
          </p>
          <p className="text-muted-foreground text-[12.5px]">
            {/* The reference is what makes a transfer reconcilable. Without it
                somebody matches payments to invoices by hand. */}
            Please quote <span className="font-mono">{invoice.reference}</span> as the payment
            reference. We&rsquo;ll mark this as paid once it reaches us.
          </p>
        </section>
      )}

      {invoice.payments.length > 0 && (
        <section className="no-print flex flex-col gap-2">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Payments</h2>
          <ul className="border-border divide-border divide-y rounded-xl border">
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="text-subtle font-mono text-[11.5px]">
                  {payment.reference}
                  {payment.paidAt ? ` · ${payment.paidAt}` : ""}
                </span>
                <span className="flex items-center gap-2.5">
                  <MoneyDisplay
                    value={money(payment.amount, payment.currency as CurrencyCode)}
                  />
                  <StatusBadge status={payment.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {invoice.quote && (
        <p className="no-print text-subtle text-[12.5px]">
          <Link
            href={`/dashboard/quotes/${invoice.quote.id}` as Route}
            className="underline underline-offset-4"
          >
            ← Back to quote {invoice.quote.reference}
          </Link>
        </p>
      )}
    </div>
  );
}
