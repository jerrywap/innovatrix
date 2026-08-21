import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, Clock } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { TransferInstructions } from "@/features/checkout/components/transfer-instructions";
import { offlinePaymentAvailability } from "@/services/payments/offline";
import { money, type CurrencyCode } from "@/lib/money";
import { isReference } from "@/lib/references";
import { requireOrg, requireUser } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Order, type OrderDoc } from "@/lib/db/models/commerce";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

/**
 * Order confirmation — §13.
 *
 * ## It shows what the order *is*, not what we hope it is
 *
 * An order reaches this page in one of two states: `paid` (the webhook has
 * confirmed) or `awaiting_payment` (it has not, yet). Both render, and the copy
 * differs, because telling somebody "thank you, your order is confirmed" over
 * an unconfirmed payment is the exact failure §13 is written to prevent.
 *
 * ## Everything happens in the page component, and there is no `<Suspense>`
 *
 * `notFound()` sets a 404, and a response whose shell has already streamed is
 * committed at 200 — so deciding it inside a boundary served the not-found body
 * under a success status. There is nothing to stream ahead of it either: the
 * page *is* the order, so the lookup that decides the 404 is also the lookup
 * that produces every word on the screen. Blocking is the correct behaviour
 * here, not a regression. See `loading-boundaries.test.ts`.
 */
export default async function Page({ params }: PageProps<"/orders/[reference]/confirmation">) {
  const { reference } = await params;
  const normalised = reference.trim().toUpperCase();
  if (!isReference(normalised)) notFound();

  await requireUser();
  const { organizationId } = await requireOrg();

  await connectToDatabase();
  const order = await Order.findOne({
    reference: normalised,
    // Scoped, so a guessed reference belonging to another organisation is a
    // 404 rather than somebody else's invoice.
    organizationId: toObjectId(organizationId),
  }).lean<OrderDoc>();

  if (!order) notFound();

  const currency = order.currency as CurrencyCode;
  const paid = order.status === "paid" || order.status === "fulfilled";

  /*
   * An unpaid order means two very different things, and the old copy said the
   * online one for both: "nothing more is needed from you". For a transfer,
   * something very much is — that is the entire arrangement. `paymentMethod`
   * exists so this page can tell them apart rather than guess from the absence
   * of a payment.
   */
  const awaitingTransfer = !paid && order.paymentMethod === "offline";

  /*
   * A £0 order. Paid, but paid with nothing — so "we've emailed you a receipt"
   * is the wrong sentence in the same way "nothing more is needed from you" was
   * wrong for a transfer. There is no receipt for a free thing.
   */
  const free = paid && order.total.amount === 0;
  const offline = awaitingTransfer ? await offlinePaymentAvailability() : null;

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-5 py-12 lg:px-10">
      <header className="flex flex-col items-center gap-3 text-center">
        {paid ? (
          <CircleCheck className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Clock className="size-8 text-amber-600 dark:text-amber-400" aria-hidden />
        )}

        <h1 className="font-display text-[26px] tracking-[-0.02em]">
          {free
            ? "It's yours — enjoy"
            : paid
              ? "Thank you — your order is confirmed"
              : "Your order is placed"}
        </h1>

        <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-relaxed">
          {free
            ? "Nothing to pay. Your download and licence key are in My Software, ready now."
            : paid
              ? "We've emailed you a receipt. Your downloads and licence keys are in My Software."
              : awaitingTransfer
                ? "Send the payment using the details below and we'll release your software as soon as it lands."
                : "We're still waiting for your payment provider to confirm. Nothing more is needed from you — we'll email you the moment it clears."}
        </p>

        <p className="text-subtle font-mono text-[12px]">{order.reference}</p>
      </header>

      {awaitingTransfer && offline?.instructions && (
        <TransferInstructions
          reference={order.reference}
          total={order.total}
          instructions={offline.instructions}
        />
      )}

      <section className="border-border bg-surface rounded-xl border">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            What you ordered
          </h2>
          <StatusBadge status={order.status} />
        </div>

        <ul className="divide-border divide-y">
          {order.items.map((item) => (
            <li
              key={item.lineId}
              className="flex items-baseline justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px]">{item.productName}</span>
                <span className="text-subtle text-[12px]">
                  {item.addonName ??
                    [item.licencePackageName, item.versionNumber && `v${item.versionNumber}`]
                      .filter(Boolean)
                      .join(" · ")}
                  {item.quantity > 1 ? ` · ×${item.quantity}` : ""}
                </span>
              </span>
              <MoneyDisplay
                value={money(item.lineTotal.amount, currency)}
                className="text-[13.5px]"
              />
            </li>
          ))}
        </ul>

        <dl className="border-border flex flex-col gap-1.5 border-t px-4 py-3 text-[13px]">
          <Row label="Subtotal" amount={order.subtotal.amount} currency={currency} />
          {order.discount && order.discount.amount > 0 && (
            <Row
              label={order.discount.code ? `Discount (${order.discount.code})` : "Discount"}
              amount={-order.discount.amount}
              currency={currency}
            />
          )}
          {order.tax && order.tax.amount > 0 && (
            <Row
              label={`Tax${order.tax.basisPoints ? ` (${order.tax.basisPoints / 100}%)` : ""}`}
              amount={order.tax.amount}
              currency={currency}
            />
          )}
          <div className="border-border mt-1.5 flex items-baseline justify-between border-t pt-2.5">
            <dt className="text-[14px] font-medium">Total</dt>
            <dd>
              <MoneyDisplay
                value={money(order.total.amount, currency)}
                className="font-display text-[18px] tracking-[-0.02em]"
              />
            </dd>
          </div>
        </dl>
      </section>

      {/*
        Told per payment method. This used to say "we confirm your payment with
        the provider — usually seconds" to a customer paying by bank transfer,
        directly under the transfer instructions telling them it takes days.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[16px] tracking-[-0.02em]">What happens next</h2>
        <ol className="text-muted-foreground flex flex-col gap-1.5 text-[13.5px]">
          {awaitingTransfer ? (
            <>
              <li>1. You send the transfer, quoting {order.reference}.</li>
              <li>2. We match it against your order — usually the next working day.</li>
              <li>3. Your licence keys and downloads appear in My Software.</li>
            </>
          ) : (
            <>
              <li>1. We confirm your payment with the provider — usually seconds.</li>
              <li>2. Your licence keys and downloads appear in My Software.</li>
              <li>3. A receipt lands in your inbox.</li>
            </>
          )}
        </ol>
      </section>

      {/*
        The primary action follows what actually happened.

        It used to be an unconditional "Go to My Software", which for an unpaid
        transfer is a guaranteed empty page: there is no entitlement until the
        money arrives. The order is the only screen with anything on it — and it
        is the one that carries the bank details.
      */}
      <div className="flex flex-wrap gap-3">
        {paid ? (
          <>
            <Link
              href="/dashboard/software"
              className="bg-foreground text-background rounded-full px-5 py-2.5 text-[13.5px] font-medium"
            >
              Go to My Software
            </Link>
            <Link
              href={`/dashboard/orders/${order.reference}` as Route}
              className="border-border hover:bg-surface-muted rounded-full border px-5 py-2.5 text-[13.5px]"
            >
              View this order
            </Link>
          </>
        ) : (
          <>
            <Link
              href={`/dashboard/orders/${order.reference}` as Route}
              className="bg-foreground text-background rounded-full px-5 py-2.5 text-[13.5px] font-medium"
            >
              View this order
            </Link>
            <Link
              href="/marketplace"
              className="border-border hover:bg-surface-muted rounded-full border px-5 py-2.5 text-[13.5px]"
            >
              Keep browsing
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: CurrencyCode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {amount < 0 ? "−" : ""}
        <MoneyDisplay value={money(Math.abs(amount), currency)} />
      </dd>
    </div>
  );
}
