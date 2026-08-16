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
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { listInvoicesForStaff } from "@/features/invoices/invoice-view";

export const metadata: Metadata = { title: "Invoices" };

/**
 * The invoice queue — §63.
 *
 * ## Unpaid, oldest first, is the default view
 *
 * Not "all invoices, newest first". This is a work list: the invoice that has
 * been outstanding longest is the one somebody needs to chase, and a paid
 * invoice needs nothing from anybody. `?status=all` is there for when somebody
 * is looking something up rather than working the queue.
 */
export default async function Page({ searchParams }: PageProps<"/staff/invoices">) {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("invoice.view_all");

  const params = await searchParams;
  const showAll = params.status === "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description={showAll ? "Every invoice." : "Outstanding invoices, oldest first."}
      />

      <nav className="flex gap-2" aria-label="Filter invoices">
        <Filter href="/staff/invoices" label="Outstanding" active={!showAll} />
        <Filter href="/staff/invoices?status=all" label="All" active={showAll} />
      </nav>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <InvoiceList showAll={showAll} />
      </Suspense>
    </div>
  );
}

function Filter({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "bg-foreground text-background rounded-full px-3 py-1 text-[12.5px]"
          : "border-border hover:bg-surface-muted rounded-full border px-3 py-1 text-[12.5px]"
      }
    >
      {label}
    </Link>
  );
}

async function InvoiceList({ showAll }: { showAll: boolean }) {
  const invoices = await listInvoicesForStaff(showAll ? {} : { status: "unpaid" });

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title={showAll ? "No invoices" : "Nothing outstanding"}
        description={
          showAll
            ? "Invoices raised from accepted quotes appear here."
            : "Every invoice is settled. Nothing to chase."
        }
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <Link
            href={`/staff/invoices/${invoice.id}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                {invoice.title}
                {invoice.overdue && (
                  <span className="rounded-full bg-[var(--danger)]/10 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--danger)] uppercase">
                    overdue
                  </span>
                )}
              </p>
              <p className="text-subtle font-mono text-[11.5px]">
                {invoice.reference}
                {invoice.organizationName ? ` · ${invoice.organizationName}` : ""}
                {invoice.dueAt ? ` · due ${invoice.dueAt}` : ""}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-right">
                <MoneyDisplay
                  value={money(invoice.outstanding, invoice.currency as CurrencyCode)}
                />
                {invoice.outstanding !== invoice.total && (
                  <span className="text-subtle block text-[10.5px]">
                    {/* Through `MoneyDisplay`, never arithmetic on minor units
                        — §84, and JPY has no hundredths to divide by. */}
                    of{" "}
                    <MoneyDisplay
                      value={money(invoice.total, invoice.currency as CurrencyCode)}
                    />
                  </span>
                )}
              </span>
              <StatusBadge status={invoice.effectiveStatus} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
