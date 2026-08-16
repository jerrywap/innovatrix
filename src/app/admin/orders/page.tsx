import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, type CurrencyCode } from "@/lib/money";
import { requireAnyPermissionOrForbid } from "@/lib/auth/dal";
import { listAdminOrders, type AdminOrderRow } from "@/features/payments/orders-view";

export const metadata: Metadata = { title: "Orders" };

/**
 * Every order, with the ones that need somebody first.
 *
 * An order paid by card needs no one. An order awaiting a bank transfer is a
 * task: check the account, match the reference, record it. So those lead, and
 * oldest-outstanding leads within them — the same reasoning as the staff queues.
 */
export default async function Page() {
  // Before the boundary below, so the refusal carries a 403 rather than
  // rendering under the 200 a streamed shell has already committed.
  await requireAnyPermissionOrForbid(["order.update_status", "order.cancel"]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Every order across the platform." />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Orders />
      </Suspense>
    </div>
  );
}

async function Orders() {
  const { awaitingTransfer, others } = await listAdminOrders();

  if (awaitingTransfer.length === 0 && others.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Orders from every customer will be listed here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {awaitingTransfer.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-[17px] tracking-[-0.02em]">
              Waiting for a bank transfer
            </h2>
            <p className="text-muted-foreground text-[13px]">
              Nothing is released to these customers until somebody records the payment.
            </p>
          </div>
          <Table rows={awaitingTransfer} showAge />
        </section>
      )}

      {others.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Everything else</h2>
          <Table rows={others} />
        </section>
      )}
    </div>
  );
}

function Table({ rows, showAge }: { rows: AdminOrderRow[]; showAge?: boolean }) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[44rem] text-left">
        <thead className="border-border bg-surface-muted border-b">
          <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            <th className="px-4 py-2.5 font-normal">Reference</th>
            <th className="px-4 py-2.5 font-normal">Customer</th>
            <th className="px-4 py-2.5 font-normal">Total</th>
            <th className="px-4 py-2.5 font-normal">How</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
            <th className="px-4 py-2.5 font-normal">{showAge ? "Waiting" : "Placed"}</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted">
              <td className="px-4 py-2.5">
                <Link
                  href={`/admin/orders/${row.reference}` as Route}
                  className="font-mono text-[12px] underline underline-offset-4"
                >
                  {row.reference}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-[13px]">{row.organizationName}</td>
              <td className="px-4 py-2.5 text-[13px]">
                <MoneyDisplay
                  value={money(row.total.amount, row.total.currency as CurrencyCode)}
                />
              </td>
              <td className="text-muted-foreground px-4 py-2.5 text-[12.5px]">
                {row.paymentMethod === "offline" ? "Transfer" : "Card"}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={
                    showAge && row.ageDays >= 5
                      ? "font-mono text-[12px] text-amber-700 dark:text-amber-400"
                      : "text-subtle font-mono text-[12px]"
                  }
                >
                  {showAge ? (row.ageDays === 0 ? "today" : `${row.ageDays}d`) : row.createdAt}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
