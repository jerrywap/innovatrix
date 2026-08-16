import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { formatPlain, money, type CurrencyCode } from "@/lib/money";
import { can, requireAnyPermissionOrForbid } from "@/lib/auth/dal";
import { loadAdminOrder } from "@/features/payments/orders-view";
import { RecordPayment } from "@/features/payments/components/record-payment";

export const metadata: Metadata = { title: "Order" };

/**
 * One order, and the button that releases it.
 *
 * ## Recording a payment is shown only when it would do something
 *
 * Not on a paid order, not to somebody without the permission. A control that
 * appears and then refuses teaches people to distrust the screen — and this one
 * creates licences, so it is worth being precise about.
 */
export default async function Page({ params }: PageProps<"/admin/orders/[reference]">) {
  const { reference } = await params;
  await requireAnyPermissionOrForbid(["order.update_status", "order.cancel"]);

  const order = await loadAdminOrder(reference);
  if (!order) notFound();

  const [mayRecord, mayViewEvidence] = await Promise.all([
    can("payment.record_manual"),
    can("payment.view_all"),
  ]);

  const unpaid = order.status === "awaiting_payment" || order.status === "draft";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order.reference}
        description={`${order.organizationName} · placed ${order.createdAt}`}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <StatusBadge status={order.status} />
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
          {order.paymentMethod === "offline" ? "paying by transfer" : "paying by card"}
        </span>
      </div>

      {unpaid && mayRecord && (
        <RecordPayment
          orderReference={order.reference}
          // Major units, through `formatPlain` — never `/ 100`, which is wrong
          // for a zero-exponent currency and is a float besides (§84).
          total={formatPlain(money(order.total.amount, order.total.currency as CurrencyCode))}
          currency={order.total.currency}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[16px] tracking-[-0.02em]">What they ordered</h2>
        <div className="border-border overflow-hidden rounded-xl border">
          <ul className="divide-border divide-y">
            {order.items.map((item) => (
              <li
                key={item.lineId}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px]">{item.productName}</span>
                  {item.licencePackageName && (
                    <span className="text-subtle text-[12px]">{item.licencePackageName}</span>
                  )}
                </span>
                <MoneyDisplay
                  value={money(item.lineTotal.amount, item.lineTotal.currency as CurrencyCode)}
                />
              </li>
            ))}
          </ul>
          <div className="border-border bg-surface-muted flex items-baseline justify-between border-t px-4 py-2.5">
            <span className="text-[13px] font-medium">Total</span>
            <span className="text-[15px] font-medium">
              <MoneyDisplay
                value={money(order.total.amount, order.total.currency as CurrencyCode)}
              />
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Payments</h2>
        {order.payments.length === 0 ? (
          <p className="text-subtle border-border rounded-xl border px-4 py-3 text-[12.5px]">
            Nothing recorded against this order yet.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-xl border">
            {order.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[12px]">{payment.reference}</span>
                  <span className="text-subtle text-[11.5px]">
                    {payment.provider}
                    {payment.recordedByName ? ` · recorded by ${payment.recordedByName}` : ""}
                    {` · ${payment.at}`}
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
                        {payment.evidenceFilename ?? "Evidence"}
                      </a>
                    ) : (
                      <span className="text-subtle flex items-center gap-1 text-[12px]">
                        <Paperclip className="size-3.5" aria-hidden />
                        Evidence on file
                      </span>
                    ))}
                  <MoneyDisplay
                    value={money(
                      payment.amount.amount,
                      payment.amount.currency as CurrencyCode,
                    )}
                  />
                  <StatusBadge status={payment.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
