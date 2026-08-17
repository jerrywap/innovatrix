import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Banknote } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MoneyDisplay } from "@/components/money-display";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/lib/dates";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { latestSkipFor, listForVendor } from "@/services/payouts/payout-service";
import {
  PAYOUT_STATUS_COPY,
  SKIP_REASON_COPY,
  toPayoutRow,
} from "@/features/payouts/payout-view";

export const metadata: Metadata = { title: "Payouts" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * What we have paid, and what we did not — vendor ticket 09.
 *
 * Readable by **any** active member, owner or not. A member who cannot see whether a payout
 * arrived cannot answer "did we get paid"; what the two-role model protects is the payout
 * *account*, which lives on the owner-only settings screen.
 *
 * The skip notice is the part that would otherwise not exist anywhere. A vendor silently
 * excluded from three runs asks support, and support has no answer either — so the most recent
 * skip is shown with what would change it.
 */
export default async function Page() {
  const { vendorId } = await requireVendorOrForbid();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payouts"
        description="Every transfer we have made to you, and why a run may have passed you over."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Payouts vendorId={vendorId} />
      </Suspense>
    </div>
  );
}

async function Payouts({ vendorId }: { vendorId: string }) {
  const [payouts, skip] = await Promise.all([
    listForVendor({ vendorId }),
    latestSkipFor({ vendorId }),
  ]);

  const rows = payouts.map(toPayoutRow);
  const skipCopy = skip ? SKIP_REASON_COPY[skip.reason] : null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        Shown whether or not there are payouts, and only for the most recent period: an
        archive of every skip would be a wall of "below threshold" nobody reads, while the
        latest one is the answer to "why haven't I been paid".
      */}
      {skipCopy && (
        <div className="border-border bg-surface-muted/40 flex flex-col gap-1.5 rounded-xl border p-5">
          <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            The run on {formatDay(skip!.periodEnd)}
          </h2>
          <p className="text-[13.5px]">{skipCopy.what}</p>
          <p className="text-muted-foreground text-[13px]">{skipCopy.next}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No payouts yet"
          description="Once your earnings clear and pass the minimum, we prepare a transfer and it appears here with a statement."
        />
      ) : (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/dashboard/selling/payouts/${row.reference}` as Route}
                  className="font-mono text-[13px] underline underline-offset-4"
                >
                  {row.reference}
                </Link>
                <span className="flex items-center gap-2.5">
                  <MoneyDisplay value={row.amount} />
                  <StatusBadge status={row.status} />
                </span>
              </div>
              <p className="text-muted-foreground text-[12.5px]">
                {PAYOUT_STATUS_COPY[row.status]}
              </p>
              <p className="text-subtle font-mono text-[11px]">
                {formatDay(row.periodStart)} – {formatDay(row.periodEnd)} · {row.entryCount}{" "}
                {row.entryCount === 1 ? "entry" : "entries"}
                {row.externalReference ? ` · ${row.externalReference}` : ""}
              </p>
              {/* The bank's words, verbatim. A paraphrase would lose the detail that tells a
                  vendor which digit is wrong. */}
              {row.failureReason && row.status !== "paid" && (
                <p className="text-[12.5px] text-[var(--danger)]">{row.failureReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
