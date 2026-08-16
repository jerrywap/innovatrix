import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, type CurrencyCode } from "@/lib/money";
import { requireOrgRoleOrForbid } from "@/lib/auth/dal";
import { listInvoicesForOrganization } from "@/features/invoices/invoice-view";

export const metadata: Metadata = { title: "Invoices" };

export default async function Page() {
  /*
   * The guard is here, not inside the Suspense boundary below.
   *
   * `forbidden()` sets a 403 on the response, and a response whose shell has
   * already streamed is committed at 200 — the refusal would render as a body
   * under a success status. So the check happens before anything is sent, and
   * only the query is deferred.
   *
   * The nav hides this from a technical contact; this is what makes that a
   * control rather than a courtesy (§89).
   */
  const { organizationId } = await requireOrgRoleOrForbid(["owner", "admin", "billing"]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" description="What's owed, what's paid, and when it's due." />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <InvoiceList organizationId={organizationId} />
      </Suspense>
    </div>
  );
}

async function InvoiceList({ organizationId }: { organizationId: string }) {
  const invoices = await listInvoicesForOrganization(organizationId);

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No invoices yet"
        description="Invoices are raised when you accept a quote or place an order."
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <Link
            href={`/dashboard/invoices/${invoice.id}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                {invoice.title}
                {invoice.portion !== "full" && (
                  <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                    {invoice.portion}
                  </span>
                )}
              </p>
              <p className="text-subtle font-mono text-[11.5px]">
                {invoice.reference}
                {invoice.dueAt
                  ? ` · ${invoice.overdue ? "was due" : "due"} ${invoice.dueAt}`
                  : ""}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-3">
              {/* The outstanding figure, not the total — on a part-paid invoice
                  the total is not the number they need. */}
              <MoneyDisplay
                value={money(
                  invoice.payable ? invoice.outstanding : invoice.total,
                  invoice.currency as CurrencyCode,
                )}
              />
              <StatusBadge status={invoice.effectiveStatus} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
