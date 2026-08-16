import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { money, type CurrencyCode } from "@/lib/money";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadCustomer360 } from "@/features/staff/customer-360";
import { FollowUpForm } from "@/features/staff/components/follow-up-form";

export const metadata: Metadata = { title: "Customer" };

/**
 * §33 — everything about one customer, on one page.
 *
 * The test of this screen is a phone call: someone rings, and the person who
 * answers should not have to say "let me just check another system". Counters,
 * what they own, what they have asked for, what they owe, and one interleaved
 * timeline underneath it all.
 */
export default async function Page({ params }: PageProps<"/staff/customers/[organizationId]">) {
  const { organizationId } = await params;
  await requirePermissionOrForbid("customer.view_all");

  const view = await loadCustomer360(organizationId);
  if (!view) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={view.organization.name}
        description={
          view.primaryContact
            ? `${view.primaryContact.name} · ${view.primaryContact.email} · customer since ${view.organization.since}`
            : `Customer since ${view.organization.since}`
        }
      />

      <FollowUpForm
        organizationId={view.organization.id}
        subjectType="organization"
        subjectId={view.organization.id}
        returnTo={`/staff/customers/${view.organization.id}`}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Counter label="Open requests" value={view.counts.openRequests} />
        <Counter label="Owned software" value={view.counts.ownedProducts} />
        <Counter label="Pending quotes" value={view.counts.pendingQuotes} />
        <Counter label="Unpaid invoices" value={view.counts.unpaidInvoices} />
        <Counter label="Orders" value={view.counts.orders} />
        <Counter label="Downloads" value={view.counts.downloads} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Requests">
          {view.requests.length === 0 ? (
            <Empty>Nothing asked for yet.</Empty>
          ) : (
            <ul className="divide-border divide-y">
              {view.requests.map((request) => (
                <li
                  key={request.reference}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <Link
                    href={`/staff/requests/${request.reference}` as Route}
                    className="min-w-0"
                  >
                    <p className="truncate text-[13px]">{request.title}</p>
                    <p className="text-subtle font-mono text-[11px]">
                      {request.reference} · {request.at}
                    </p>
                  </Link>
                  <StatusBadge status={request.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Orders">
          {view.orders.length === 0 ? (
            <Empty>Nothing bought yet.</Empty>
          ) : (
            <ul className="divide-border divide-y">
              {view.orders.map((order) => (
                <li
                  key={order.reference}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px]">{order.reference}</span>
                    <span className="text-subtle font-mono text-[11px]">{order.at}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    {order.total && (
                      <MoneyDisplay
                        value={money(order.total.amount, order.total.currency as CurrencyCode)}
                      />
                    )}
                    <StatusBadge status={order.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Software they own">
          {view.software.length === 0 ? (
            <Empty>No entitlements.</Empty>
          ) : (
            <ul className="divide-border divide-y">
              {view.software.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="truncate text-[13px]">{item.productName}</span>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Everything, in order">
          {view.timeline.length === 0 ? (
            <Empty>Nothing has happened yet.</Empty>
          ) : (
            <ul className="divide-border divide-y">
              {view.timeline.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px]">{entry.message}</span>
                    <span className="text-subtle shrink-0 font-mono text-[10.5px]">
                      {entry.at}
                    </span>
                  </span>
                  {entry.internal && (
                    <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                      internal
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-surface flex flex-col gap-1 rounded-xl border p-3.5">
      <span className="text-muted-foreground text-[12px] font-medium">{label}</span>
      <span className="font-display text-[22px] leading-none tracking-[-0.03em]">{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-display text-[16px] tracking-[-0.02em]">{title}</h2>
      <div className="border-border overflow-hidden rounded-xl border">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-subtle px-4 py-3 text-[12.5px]">{children}</p>;
}
