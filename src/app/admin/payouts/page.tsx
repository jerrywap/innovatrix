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
import { cn } from "@/lib/utils";
import { PAYOUT_STATUSES, type PayoutStatus } from "@/lib/db/enums";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { Vendor } from "@/lib/db/models/vendors";
import { listByStatus } from "@/services/payouts/payout-service";
import { toPayoutRow } from "@/features/payouts/payout-view";

export const metadata: Metadata = { title: "Payouts" };

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The payout queue — vendor ticket 09.
 *
 * ## Draft first, and it is not just an ordering choice
 *
 * A `draft` is money the platform owes and has not released. Anything else on this screen is
 * already in motion. Putting drafts at the top makes the *work* the first thing on the page,
 * which is what stops a batch sitting unapproved for a fortnight because nobody scrolled.
 *
 * The guard is `payout.view_all` and it is awaited in this component's own body, before any
 * JSX. There is deliberately no `loading.tsx` under `/admin/payouts` — a boundary above a
 * refusing page flushes the shell and commits `200 OK` before the refusal is decided.
 */
export default async function Page({ searchParams }: PageProps<"/admin/payouts">) {
  await requirePermissionOrForbid("payout.view_all");

  const raw = await searchParams;
  const status = parseStatus(typeof raw.status === "string" ? raw.status : undefined);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payouts"
        description="What we owe vendors, and what has left. Nothing here sends itself."
      />

      <StatusFilter current={status} />

      <Suspense
        key={status ?? "all"}
        fallback={<Skeleton className="h-64 w-full rounded-xl" />}
      >
        <Payouts status={status} />
      </Suspense>
    </div>
  );
}

async function Payouts({ status }: { status?: PayoutStatus }) {
  const payouts = await listByStatus(status);
  const rows = payouts.map(toPayoutRow);

  // One query for the names, not one per row — the same reason `CARD_PROJECTION` denormalises
  // a vendor name onto a product rather than looking it up per card.
  const vendorIds = [...new Set(rows.map((row) => row.vendorId))];
  const vendors = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } })
        .select({ displayName: 1 })
        .lean<Array<{ _id: unknown; displayName: string }>>()
    : [];
  const nameById = new Map(vendors.map((vendor) => [String(vendor._id), vendor.displayName]));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title={status ? `No ${status} payouts` : "No payouts yet"}
        description={
          status
            ? "Try a different status."
            : "The nightly batch drafts one per vendor whose cleared balance is over the threshold."
        }
        variant={status ? "no-results" : "empty"}
      />
    );
  }

  // Drafts first, then whatever the query asked for, oldest within each group: a vendor
  // waiting on money should not be behind one who arrived later.
  const ordered = [...rows].sort((a, b) => {
    const rank = (row: typeof a) =>
      row.status === "draft" ? 0 : row.status === "failed" ? 1 : 2;
    return rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {ordered.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={`/admin/payouts/${row.reference}` as Route}
              className="text-[13.5px] underline underline-offset-4"
            >
              {nameById.get(row.vendorId) ?? "Unknown vendor"}
            </Link>
            <span className="text-subtle font-mono text-[11px]">
              {row.reference} · {formatDay(row.periodStart)}–{formatDay(row.periodEnd)} ·{" "}
              {row.entryCount} {row.entryCount === 1 ? "entry" : "entries"} · {row.method}
            </span>
            {row.failureReason && row.status !== "paid" && (
              <span className="text-[12px] text-[var(--danger)]">{row.failureReason}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2.5">
            <MoneyDisplay value={row.amount} />
            <StatusBadge status={row.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Status as links, not a `<select>`.
 *
 * Keeps the screen a Server Component and makes each filter a shareable URL — the URL-state
 * convention, and how "the drafts waiting on you" becomes something somebody can bookmark.
 */
function StatusFilter({ current }: { current?: PayoutStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip href="/admin/payouts" active={!current}>
        All
      </Chip>
      {PAYOUT_STATUSES.map((status) => (
        <Chip
          key={status}
          href={`/admin/payouts?status=${status}` as Route}
          active={current === status}
        >
          {status}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: Route;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12.5px] font-medium capitalize transition",
        active
          ? "border-signal/30 bg-signal-soft text-signal-text"
          : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** Untrusted, like everything from a query string: an unknown value means "no filter". */
function parseStatus(raw: string | undefined): PayoutStatus | undefined {
  return (PAYOUT_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as PayoutStatus)
    : undefined;
}
