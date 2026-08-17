import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Landmark, Package } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { requireOrg } from "@/lib/auth/dal";
import type { Money } from "@/lib/money";
import { loadCustomerOrder } from "@/features/orders/order-view";
import { offlinePaymentAvailability } from "@/services/payments/offline";

export const metadata: Metadata = { title: "Order" };

/**
 * One order — §61, §14.
 *
 * ## This route did not exist
 *
 * `src/app/dashboard/orders/[reference]/` was an empty directory. The orders
 * list linked here, the checkout confirmation linked here, and the navigation
 * comments documented it — and every reference 404'd, for every customer. Both
 * links reached it through an `as Route` cast, which is exactly what stopped
 * `typedRoutes` from making that a compile error.
 *
 * ## Blocking, and no `loading.tsx`
 *
 * The 404 depends on the main query, so there is nothing to stream ahead of it
 * — AGENTS.md: "drop the `<Suspense>` instead of pretending". A `loading.tsx`
 * over this segment would flush the shell first and turn `notFound()` into a
 * 200.
 *
 * ## A miss is a 404, never a 403
 *
 * `loadCustomerOrder` filters on the session's organisation, so another
 * organisation's order is indistinguishable from one that does not exist. A 403
 * would confirm the reference is real, which is enough to enumerate.
 */
export default async function Page({ params }: PageProps<"/dashboard/orders/[reference]">) {
  const { reference } = await params;
  const { organizationId } = await requireOrg();

  const order = await loadCustomerOrder(reference, organizationId);
  if (!order) notFound();

  const transfer = order.awaitingPayment && order.paymentMethod === "offline";
  const offline = transfer ? await offlinePaymentAvailability() : { instructions: undefined };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={order.reference} description={`Placed ${order.placedAt}`} />

      <Link
        href={"/dashboard/orders" as Route}
        className="text-subtle w-fit text-[12.5px] underline underline-offset-4"
      >
        ← All orders
      </Link>

      <section className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={order.status} />
          {order.awaitingPayment && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-amber-700 uppercase dark:text-amber-400">
              not paid yet
            </span>
          )}
        </div>
        <MoneyDisplay value={order.total} className="text-[16px]" />
      </section>

      {/*
        The bank details, on the order rather than only on the confirmation page
        the customer saw once. A transfer is paid days later, from a different
        device, by somebody in accounts who was forwarded the reference.
      */}
      {transfer && offline.instructions && (
        <section className="border-border bg-surface-muted/50 flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="font-display flex items-center gap-2 text-[15px] tracking-[-0.02em]">
            <Landmark className="text-subtle size-4" aria-hidden />
            How to pay
          </h2>
          <p className="text-muted-foreground text-[13px] whitespace-pre-line">
            {offline.instructions}
          </p>
          <p className="text-subtle text-[12.5px]">
            Quote <strong className="font-medium">{order.reference}</strong> so we can match it.
            Nothing is released until the payment reaches us.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">What you ordered</h2>
        <ul className="border-border divide-border bg-surface divide-y rounded-xl border">
          {order.lines.map((line, index) => (
            <li key={`${line.productName}-${index}`} className="flex flex-col gap-1.5 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium">
                  {line.productName}
                  {line.quantity > 1 && (
                    <span className="text-subtle font-mono text-[12px]">
                      {" "}
                      × {line.quantity}
                    </span>
                  )}
                </span>
                <MoneyDisplay value={line.lineTotal} />
              </div>
              {line.packageName && (
                <span className="text-subtle text-[12.5px]">{line.packageName}</span>
              )}
              {line.addons.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {line.addons.map((addon) => (
                    <li
                      key={addon.name}
                      className="text-muted-foreground flex items-baseline justify-between gap-3 text-[12.5px]"
                    >
                      <span>+ {addon.name}</span>
                      <MoneyDisplay value={addon.price} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        {/* §61 — these are the frozen figures, not a recalculation. */}
        <dl className="border-border bg-surface flex flex-col gap-1.5 rounded-xl border p-4 text-[13px]">
          <Row term="Subtotal" value={order.subtotal} />
          {order.discount && (
            <Row
              term="Discount"
              value={{ amount: -order.discount.amount, currency: order.discount.currency }}
            />
          )}
          {order.tax && <Row term="Tax" value={order.tax} />}
          <div className="border-border mt-1.5 flex items-baseline justify-between border-t pt-2.5">
            <dt className="text-[14px] font-medium">Total</dt>
            <dd>
              <MoneyDisplay value={order.total} className="text-[15px] font-medium" />
            </dd>
          </div>
        </dl>
      </section>

      {order.entitlements.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">What this gave you</h2>
          <ul className="border-border divide-border bg-surface divide-y rounded-xl border">
            {order.entitlements.map((entitlement) => (
              <li key={entitlement.id}>
                <Link
                  href={`/dashboard/software/${entitlement.id}` as Route}
                  className="hover:bg-surface-muted flex items-center justify-between gap-3 px-4 py-3 transition-colors"
                >
                  <span className="flex items-center gap-2.5 text-[13.5px]">
                    <Package className="text-subtle size-4" aria-hidden />
                    {entitlement.productName}
                  </span>
                  <span className="text-subtle text-[12.5px]">Downloads and licence →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.payments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Payments</h2>
          <Timeline
            className="border-border bg-surface rounded-xl border p-5"
            entries={order.payments.map((payment) => ({
              id: payment.id,
              title: payment.reference,
              status: payment.status,
              at: new Date(payment.at),
            }))}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Billing details</h2>
        <div className="border-border bg-surface rounded-xl border p-4 text-[13px] leading-relaxed">
          {[
            order.billing.organizationName,
            order.billing.contactName,
            order.billing.line1,
            order.billing.line2,
            order.billing.city,
            order.billing.region,
            order.billing.postcode,
            order.billing.country,
          ]
            .filter(Boolean)
            .map((line) => (
              <p key={line}>{line}</p>
            ))}
          {order.billing.taxId && (
            <p className="text-subtle mt-1.5 font-mono text-[12px]">{order.billing.taxId}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ term, value }: { term: string; value: Money }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>
        <MoneyDisplay value={value} />
      </dd>
    </div>
  );
}
