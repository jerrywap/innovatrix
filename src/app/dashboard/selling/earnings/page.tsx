import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Coins } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MoneyDisplay } from "@/components/money-display";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatDay } from "@/lib/dates";
import { money } from "@/lib/money";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";
import { LEDGER_ENTRY_KINDS, type LedgerEntryKind } from "@/lib/db/enums";
import { loadEarnings, parseKind } from "@/features/vendors/earnings-view";

export const metadata: Metadata = { title: "Earnings" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * What the vendor has earned — vendor ticket 08.
 *
 * ## Guard first, stream second
 *
 * `requireVendorOrForbid()` is awaited in this component's own body, before any JSX, so
 * the refusal is decided before the first flush and the 403 carries a 403. The ledger
 * read is inside a `<Suspense>` so the shell still streams. No `loading.tsx` anywhere
 * under `/dashboard/selling` — a boundary above a refusing page renders the refusal
 * under `200 OK`, and `loading-boundaries.test.ts` enforces both halves of this.
 *
 * ## Three figures, not one
 *
 * Pending, payable and paid, because a single "balance" is the number a vendor then has
 * to email us about. Pending money is the part that most needs explaining — it is theirs
 * but not yet payable — so the explanation is on the screen beside it rather than in a
 * help page.
 *
 * Grouped by currency and never summed across them. There is no rate to add GBP to NGN
 * at, and inventing one on a screen about somebody's income would be worse than showing
 * two rows.
 */
export default async function Page({ searchParams }: PageProps<"/dashboard/selling/earnings">) {
  // Guard before anything, including before the search params are read.
  const { vendorId } = await requireVendorOrForbid();

  const raw = await searchParams;
  const kind = parseKind(typeof raw.kind === "string" ? raw.kind : undefined);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Earnings"
        description="What you have earned, what is payable, and what we have paid."
      />
      <Suspense key={kind ?? "all"} fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
        <Earnings vendorId={vendorId} kind={kind} />
      </Suspense>
    </div>
  );
}

async function Earnings({ vendorId, kind }: { vendorId: string; kind?: LedgerEntryKind }) {
  const view = await loadEarnings(vendorId, kind ? { kind } : {});

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border bg-surface-muted/40 rounded-xl border p-5">
        <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Your rate
        </h2>
        <p className="font-display mt-1.5 text-[22px] tracking-[-0.02em]">
          You keep {formatVendorShare(view.rate.basisPoints)}
        </p>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Innovatrix takes {view.rate.label} of the price after any discount and before tax
          {view.rate.source === "vendor"
            ? " — this is a rate agreed with you, not our standard one."
            : "."}{" "}
          Every order records the rate it was charged at, so a change to this only affects
          orders placed after it.
        </p>
      </div>

      {view.balances.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Nothing earned yet"
          description="When somebody buys one of your products, what you earn appears here. It becomes payable a month later, once the refund window has passed."
        />
      ) : (
        <>
          {view.balances.map((balance) => (
            <section key={balance.currency} className="flex flex-col gap-2">
              {/*
                The currency heading appears only when there is more than one. A single
                currency is the normal case, and labelling it "GBP" above three figures
                that already carry the symbol is noise.
              */}
              {view.balances.length > 1 && (
                <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  {balance.currency}
                </h2>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Figure
                  label="Payable"
                  value={balance.cleared}
                  note="Clear of refunds and ready for the next payout run."
                  emphasis
                />
                <Figure
                  label="Pending"
                  value={balance.pending}
                  note={`Yours, but held for ${view.clearanceDays} days from the sale — a customer can ask for a refund within ${view.refundWindowDays}.`}
                />
                <Figure label="Paid out" value={balance.paid} note="Already sent to you." />
              </div>
            </section>
          ))}

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Every entry</h2>
            <p className="text-muted-foreground text-[13px]">
              Nothing here is ever edited or removed. A refund appears as its own negative line
              beside the sale it reverses, so this reads as a history rather than a snapshot.
            </p>

            <KindFilter current={view.kind} />

            {view.entries.length === 0 && (
              <p className="text-subtle text-[12.5px]">
                Nothing of that kind yet. The figures above are unaffected — they always count
                everything.
              </p>
            )}

            {view.entries.length > 0 && (
              <ul className="border-border divide-border divide-y rounded-xl border text-[13px]">
                {view.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="capitalize">{KIND_LABELS[entry.kind]}</span>
                        <StatusBadge status={entry.status} />
                      </span>
                      <span className="text-subtle font-mono text-[11px]">
                        {formatDateTime(entry.createdAt)}
                        {entry.orderReference ? ` · ${entry.orderReference}` : ""}
                        {entry.status === "pending" && entry.clearsAt
                          ? ` · payable ${formatDay(entry.clearsAt)}`
                          : ""}
                      </span>
                      {entry.note && (
                        <span className="text-muted-foreground">{entry.note}</span>
                      )}
                    </span>
                    <MoneyDisplay
                      value={money(entry.amount.amount, entry.amount.currency as never)}
                      className={
                        entry.amount.amount < 0 ? "text-[var(--danger)]" : "text-foreground"
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: ReturnType<typeof money>;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-border rounded-xl border p-4">
      <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{label}</p>
      <MoneyDisplay
        value={value}
        className={emphasis ? "mt-1.5 block text-[20px]" : "mt-1.5 block text-[17px]"}
      />
      <p className="text-muted-foreground mt-1.5 text-[12px]">{note}</p>
    </div>
  );
}

/**
 * The entry filter, as links rather than a `<select>`.
 *
 * Keeps the screen a Server Component and makes a filtered view linkable — the URL-state
 * convention, and the reason a vendor can send us "here is the refund I am asking about"
 * rather than describing where they clicked.
 *
 * `LEDGER_ENTRY_KINDS` drives it, so a fifth kind appears here without anybody remembering
 * to add it.
 */
function KindFilter({ current }: { current?: LedgerEntryKind }) {
  const base = "/dashboard/selling/earnings" as const;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip href={base} active={!current}>
        Everything
      </Chip>
      {LEDGER_ENTRY_KINDS.map((kind) => (
        <Chip key={kind} href={`${base}?kind=${kind}` as Route} active={current === kind}>
          {KIND_LABELS[kind] ?? kind}
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
        "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition",
        active
          ? "border-signal/30 bg-signal-soft text-signal-text"
          : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

const KIND_LABELS: Record<string, string> = {
  earning: "Sale",
  refund: "Refund",
  adjustment: "Adjustment",
  payout: "Payout",
};

/**
 * `3000` → `"70%"`.
 *
 * The vendor's share, not ours, because that is the number they care about — and stating
 * it in their terms is the difference between a screen that informs and one that has to
 * be decoded. Integer arithmetic on basis points, so no float rounds a percentage.
 */
function formatVendorShare(basisPoints: number): string {
  const share = (10_000 - basisPoints) / 100;
  return `${Number.isInteger(share) ? share : share.toFixed(2)}%`;
}
