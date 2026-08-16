import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { formatPlain, money, type CurrencyCode } from "@/lib/money";
import { can, requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadInvoice } from "@/features/invoices/invoice-view";
import { InvoiceDocument } from "@/features/invoices/components/invoice-document";
import { RecordInvoicePayment } from "@/features/invoices/components/record-invoice-payment";
import { RaiseBalance } from "@/features/invoices/components/raise-balance";

export const metadata: Metadata = { title: "Invoice" };

/**
 * One invoice, as staff see it — §63.
 *
 * ## No organisation scope on the read, and that is the point
 *
 * `loadInvoice` is called without an `organizationId` here, which is exactly
 * what `invoice.view_all` means. The permission is the scope; passing the
 * caller's own organisation would make this page useless and passing one from
 * the URL would make it a vulnerability.
 */
export default async function Page({ params }: PageProps<"/staff/invoices/[id]">) {
  const { id } = await params;
  await requirePermissionOrForbid("invoice.view_all");

  const invoice = await loadInvoice(id, {});
  if (!invoice) notFound();

  const [mayRecord, mayViewEvidence] = await Promise.all([
    can("payment.record_manual"),
    can("payment.view_all"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={invoice.reference}
        description={`${invoice.organizationName}${invoice.issuedAt ? ` · issued ${invoice.issuedAt}` : ""}`}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge status={invoice.effectiveStatus} />
        {invoice.portion !== "full" && (
          <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            {invoice.portion}
          </span>
        )}
        {invoice.outstanding > 0 && (
          <span className="text-[13px]">
            <MoneyDisplay
              value={money(invoice.outstanding, invoice.currency as CurrencyCode)}
            />{" "}
            outstanding
          </span>
        )}
      </div>

      {invoice.payable && mayRecord && (
        <RecordInvoicePayment
          invoiceId={invoice.id}
          // Major units through `formatPlain` — never `/ 100`, which is wrong
          // for a zero-exponent currency and is a float besides (§84).
          outstanding={formatPlain(
            money(invoice.outstanding, invoice.currency as CurrencyCode),
          )}
          currency={invoice.currency}
        />
      )}

      {invoice.balanceRaisable && invoice.quote && mayRecord && (
        <RaiseBalance quoteId={invoice.quote.id} />
      )}

      <InvoiceDocument invoice={invoice} />

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Payments</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-subtle border-border rounded-xl border px-4 py-3 text-[12.5px]">
            Nothing recorded against this invoice yet.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-xl border">
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[12px]">{payment.reference}</span>
                  <span className="text-subtle text-[11.5px]">
                    {payment.provider}
                    {payment.paidAt ? ` · ${payment.paidAt}` : ""}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                  {payment.hasEvidence &&
                    (mayViewEvidence ? (
                      // A route, never a direct object URL: the bucket serves
                      // any known key unsigned and this is somebody's banking.
                      <a
                        href={`/api/payment-evidence/${payment.id}`}
                        className="text-subtle hover:text-foreground flex items-center gap-1 text-[12px] underline underline-offset-4"
                      >
                        <Paperclip className="size-3.5" aria-hidden />
                        Evidence
                      </a>
                    ) : (
                      <span className="text-subtle flex items-center gap-1 text-[12px]">
                        <Paperclip className="size-3.5" aria-hidden />
                        Evidence on file
                      </span>
                    ))}
                  <MoneyDisplay
                    value={money(payment.amount, payment.currency as CurrencyCode)}
                  />
                  <StatusBadge status={payment.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invoice.quote?.requestReference && (
        <p className="text-subtle text-[12.5px]">
          <Link
            href={`/staff/requests/${invoice.quote.requestReference}` as Route}
            className="underline underline-offset-4"
          >
            ← {invoice.quote.reference} v{invoice.quote.version} on{" "}
            {invoice.quote.requestReference}
          </Link>
        </p>
      )}
    </div>
  );
}
