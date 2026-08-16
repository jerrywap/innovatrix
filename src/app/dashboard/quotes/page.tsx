import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, type CurrencyCode } from "@/lib/money";
import { requireOrg } from "@/lib/auth/dal";
import { listQuotesForOrganization } from "@/features/quotes/quote-view";

export const metadata: Metadata = { title: "Quotes" };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="What we've quoted you, and what needs an answer."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <QuoteList />
      </Suspense>
    </div>
  );
}

async function QuoteList() {
  const { organizationId } = await requireOrg();
  const quotes = await listQuotesForOrganization(organizationId);

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No quotes yet"
        description="When we've scoped something you asked for, the quote appears here."
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {quotes.map((quote) => (
        <li key={quote.id}>
          <Link
            href={`/dashboard/quotes/${quote.id}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                {quote.title}
                {/* The one thing that makes this list operational rather than
                    a record: which of these is waiting on them. */}
                {quote.actionable && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-amber-700 uppercase dark:text-amber-400">
                    needs you
                  </span>
                )}
              </p>
              <p className="text-subtle font-mono text-[11.5px]">
                {quote.reference}
                {quote.version > 1 ? ` v${quote.version}` : ""}
                {` · valid until ${quote.expiresAt}`}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-3">
              <MoneyDisplay value={money(quote.total, quote.currency as CurrencyCode)} />
              <StatusBadge status={quote.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
