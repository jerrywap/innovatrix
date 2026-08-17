import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlarmClock, Building, ClipboardCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/money-display";
import { asMoney, staffHeadline } from "@/features/reporting/headline";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { QUEUES, staffCounts } from "@/features/staff/queues";

export const metadata: Metadata = { title: "Staff" };

/**
 * §31 — arrive at work, not at a database.
 *
 * Every counter is a link into the queue it counts, and both read the same
 * `QUEUES` entry, so "dashboard counters match their queue lengths exactly"
 * holds by construction rather than by being tested into agreement.
 *
 * The zero case is deliberately quiet rather than hidden: a queue at zero still
 * renders, because its absence would read as a page that failed to load.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Today" description="What's waiting, oldest first." />
      {/*
        §31's headline row, above the queues rather than instead of them. The
        queue board is the action-oriented screen §102 asks for; this answers
        the question it does not — how much is sitting with *us*.
      */}
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
        <Headline />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Counters />
      </Suspense>
    </div>
  );
}

async function Counters() {
  const { user } = await requireStaffOrRedirect();
  const counts = await staffCounts(user.id);

  const urgent = QUEUES.filter(
    (queue) =>
      counts.queues[queue.key] > 0 &&
      (queue.key === "new-custom-build" ||
        queue.key === "new-customization" ||
        queue.key === "unassigned"),
  );

  return (
    <div className="flex flex-col gap-8">
      {urgent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Nobody has these yet</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {urgent.map((queue) => (
              <QueueCard
                key={queue.key}
                queue={queue}
                count={counts.queues[queue.key]}
                urgent
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Queues</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUEUES.map((queue) => (
            <QueueCard key={queue.key} queue={queue} count={counts.queues[queue.key]} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Elsewhere</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PlainCard
            href="/staff/quotes"
            icon={FileText}
            label="Quotes awaiting a response"
            count={counts.quotesAwaiting}
          />
          {/* §39 — overdue follow-ups are surfaced here, one click away. */}
          <PlainCard
            href="/staff/follow-ups"
            icon={AlarmClock}
            label="Overdue follow-ups"
            count={counts.overdueFollowUps}
            urgent={counts.overdueFollowUps > 0}
          />
          {/*
            Vendor ticket 01. Shown to everybody in this shell rather than gated on
            `vendor.review`: the count is not sensitive, and the destination refuses
            for itself. This card is one click away from a 403 for a staff member
            without the permission, which is the same deal every other card here
            offers.
          */}
          <PlainCard
            href="/staff/vendor-applications"
            icon={Building}
            label="Vendor applications waiting"
            count={counts.vendorApplications}
          />
          {/*
            Vendor ticket 05. Urgent when non-zero, unlike the applications card: a
            product waiting on a review is a vendor earning nothing, so the queue's own
            oldest-first ordering has a counterpart here.
          */}
          <PlainCard
            href="/staff/vendor-submissions"
            icon={ClipboardCheck}
            label="Submissions waiting for review"
            count={counts.vendorSubmissions}
            urgent={counts.vendorSubmissions > 0}
          />
        </div>
      </section>
    </div>
  );
}

function QueueCard({
  queue,
  count,
  urgent,
}: {
  queue: (typeof QUEUES)[number];
  count: number;
  urgent?: boolean;
}) {
  return (
    <Link
      href={`/staff/queue/${queue.key}` as Route}
      className={
        urgent
          ? "flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 hover:bg-amber-500/10"
          : "border-border bg-surface hover:bg-surface-muted flex flex-col gap-1 rounded-xl border p-4"
      }
    >
      <span className="text-muted-foreground text-[12.5px] font-medium">{queue.label}</span>
      <span className="font-display text-[26px] leading-none tracking-[-0.03em]">{count}</span>
      <span className="text-subtle text-[12px]">{queue.description}</span>
    </Link>
  );
}

function PlainCard({
  href,
  icon: Icon,
  label,
  count,
  urgent,
}: {
  href: Route;
  icon: typeof FileText;
  label: string;
  count: number;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        urgent
          ? "flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
          : "border-border bg-surface hover:bg-surface-muted flex items-center justify-between gap-3 rounded-xl border p-4"
      }
    >
      <span className="flex items-center gap-2.5 text-[13.5px]">
        <Icon className="text-subtle size-4" aria-hidden />
        {label}
      </span>
      <span className="font-display text-[20px] leading-none tracking-[-0.03em]">{count}</span>
    </Link>
  );
}

/**
 * §31 — whose move is it.
 *
 * "Waiting on us" against "waiting on the customer" is the distinction that
 * tells a busy week from a stuck one, and it is the first thing §31's example
 * dashboard puts on the screen. Outstanding invoice value is per currency for
 * the same reason revenue is on the admin side: there is no rate to add them at.
 */
async function Headline() {
  const figures = await staffHeadline();

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Waiting on us" value={String(figures.waitingOnUs)} />
      <Tile label="Waiting on the customer" value={String(figures.waitingOnCustomer)} />
      <Tile label="Quotes out" value={String(figures.quotesIssued)} />
      <Tile
        label="Invoices outstanding"
        value={String(figures.invoicesOutstanding)}
        detail={
          figures.outstandingValue.length > 0 ? (
            <span className="flex flex-wrap gap-x-2">
              {figures.outstandingValue.map((row) => (
                <MoneyDisplay key={row.currency} value={asMoney(row)} />
              ))}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </span>
      <span className="text-[18px] font-medium">{value}</span>
      {detail && <span className="text-subtle text-[12.5px]">{detail}</span>}
    </div>
  );
}
