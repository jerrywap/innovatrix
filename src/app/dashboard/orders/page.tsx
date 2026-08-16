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
import { requireOrg } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { orders } from "@/repositories/order.repository";

export const metadata: Metadata = { title: "Orders" };

/**
 * A customer's orders — §61.
 *
 * Scoped through `listForOrg`, which refuses to build a query without an
 * organisation id, so "another organisation's orders" is not a state this page
 * can reach even by mistake.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="What you've bought, and where each order got to."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <OrderList />
      </Suspense>
    </div>
  );
}

async function OrderList() {
  const { organizationId } = await requireOrg();
  await connectToDatabase();

  const page = await orders.listForOrg(organizationId, { sort: { createdAt: -1 }, limit: 50 });

  if (page.items.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Anything you buy from the marketplace shows up here."
        action={
          <Link
            href="/marketplace"
            className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px]"
          >
            Browse the marketplace
          </Link>
        }
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y overflow-hidden rounded-xl border">
      {page.items.map((order) => (
        <li key={String(order._id)}>
          <Link
            href={`/dashboard/orders/${order.reference}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[13px] font-medium">{order.reference}</span>
              <span className="text-subtle text-[12px]">
                {order.items.length} {order.items.length === 1 ? "item" : "items"}
                {order.items[0] ? ` · ${order.items[0].productName}` : ""}
              </span>
            </span>

            <span className="flex items-center gap-4">
              <StatusBadge status={order.status} />
              <MoneyDisplay
                value={money(order.total.amount, order.currency as CurrencyCode)}
                className="text-[13.5px] font-medium"
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
