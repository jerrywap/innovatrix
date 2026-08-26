import type { Metadata, Route } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import { DonutChart } from "@/components/charts/donut-chart";
import { TimeChart } from "@/components/charts/time-chart";
import { formatValue, seriesColor, statusColor } from "@/components/charts/chart-types";
import { PageHeader } from "@/components/page-header";
import { statusLabel } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { formatDayShort, formatMonth } from "@/lib/dates";
import type { RawSearchParams } from "@/lib/list-params";
import { QUEUES, staffCounts } from "@/features/staff/queues";
import { Figure } from "@/features/reporting/components/figure";
import { RangeFilter } from "@/features/reporting/components/range-filter";
import { pipelineAnalytics } from "@/features/reporting/staff-analytics";
import { denseBuckets, fillSeries, parseRange } from "@/features/reporting/range";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Where the work is, how old it is, and how long we are taking.
 *
 * `/staff` stays the queue board — it is the daily tool and §102's "lead with
 * what needs doing" is why it comes first. This is the screen for the other
 * question, the one nobody could answer before: not "what is waiting" but "is it
 * piling up, and are we getting quicker".
 *
 * Guarded with `requireStaffOrRedirect` rather than a permission, matching
 * `/staff` itself. Everything here is an aggregate of what the queues already
 * show a staff member one page over, so a separate permission would gate the
 * summary of data they can read row by row.
 *
 * No `loading.tsx` under this segment: `loading-boundaries.test.ts` forbids one
 * over any segment that can refuse, and the guard runs in this body before any
 * JSX so the redirect happens before a shell can flush.
 */
export default async function Page({ searchParams }: PageProps<"/staff/dashboard">) {
  await requireStaffOrRedirect();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="Arrivals, ageing, quoting and load — across the whole team."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-56 rounded-full" />}>
            <Controls searchParams={searchParams} />
          </Suspense>
        }
      />

      <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
        <Pipeline searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Queues />
      </Suspense>

      <NotMeasured />
    </div>
  );
}

async function windowFor(searchParams: Promise<RawSearchParams>) {
  // Before `new Date()`, or Next fails the render on the unstable value. See the
  // same guard in `features/reporting/headline.ts`.
  await connection();
  const raw = await searchParams;
  const now = new Date();
  return { raw, range: parseRange(raw, now), now };
}

async function Controls({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { raw, range } = await windowFor(searchParams);
  return <RangeFilter pathname="/staff/dashboard" searchParams={raw} current={range.key} />;
}

/* ────────────────────────────────────────────── the pipeline */

async function Pipeline({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { range, now } = await windowFor(searchParams);
  const data = await pipelineAnalytics(range, now);
  const buckets = denseBuckets(range);
  const label = range.granularity === "month" ? formatMonth : formatDayShort;

  const arrivalSeries = [
    { key: "custom_build", label: "Custom build", color: seriesColor(0) },
    { key: "customization", label: "Customisation", color: seriesColor(3) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {data.unassigned > 0 && (
        <Link
          href="/staff/queue/unassigned"
          className="border-border hover:bg-surface-muted flex items-start gap-2.5 rounded-xl border p-4 text-[13.5px] transition"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          <span>
            {data.unassigned === 1
              ? "One open request has nobody on it."
              : `${data.unassigned} open requests have nobody on them.`}
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Arrived"
          value={String(data.arrivalsTotal)}
          detail={`in the last ${range.label.toLowerCase()}`}
          spark={fillSeries(
            buckets,
            data.arrivals,
            arrivalSeries.map((one) => one.key),
            label,
          ).map((row) => (row.values.custom_build ?? 0) + (row.values.customization ?? 0))}
        />
        <Figure
          label="Open now"
          value={String(data.openTotal)}
          detail="somebody has to move these"
        />
        <Figure
          label="Request to quote"
          value={data.timeToQuote ? `${data.timeToQuote.median} days` : "—"}
          detail={
            data.timeToQuote
              ? `median · ${data.timeToQuote.p90} days at the 90th, over ${data.timeToQuote.sample}`
              : "no quotes issued in this period"
          }
        />
        <Figure
          label="Quotes accepted"
          value={
            data.acceptanceBasisPoints === null
              ? "—"
              : formatValue(data.acceptanceBasisPoints, "percent")
          }
          detail={
            data.acceptanceBasisPoints === null
              ? "nothing decided yet"
              : "of quotes that got an answer"
          }
          href="/staff/quotes"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="submitted"
          title="Requests arriving"
          legend={arrivalSeries}
          empty={data.arrivals.length === 0}
        >
          <TimeChart
            points={fillSeries(
              buckets,
              data.arrivals,
              arrivalSeries.map((one) => one.key),
              label,
            )}
            series={arrivalSeries}
            mark="bar"
            stacked
          />
        </ChartFrame>

        <ChartFrame
          eyebrow="open requests"
          title="How long since anything moved"
          hint="By last activity, not by arrival — a request touched yesterday is not stale."
          empty={data.openAge.length === 0}
          emptyMessage="Nothing open."
        >
          <BarList
            rows={data.openAge.map((band) => ({
              key: band.label,
              label: band.label,
              value: band.count,
              display: String(band.count),
              color:
                band.from >= 15
                  ? "var(--danger)"
                  : band.from >= 8
                    ? "var(--warning)"
                    : "var(--chart-1)",
              urgent: band.from >= 15,
            }))}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="decided and outstanding"
          title="Quote outcomes"
          hint="Quotes still out are shown but not counted in the acceptance rate — they have not been turned down."
          empty={data.quotesByStatus.length === 0}
          action={{ href: "/staff/quotes", label: "Quotes" }}
        >
          <div className="flex flex-wrap items-center gap-6">
            <DonutChart
              slices={data.quotesByStatus.map((row) => ({
                key: row.key,
                label: statusLabel(row.key),
                value: row.count,
                color: statusColor(row.key),
              }))}
              totalLabel="quotes"
            />
            <div className="min-w-[13rem] flex-1">
              <BarList
                rows={data.quotesByStatus.map((row) => ({
                  key: row.key,
                  label: statusLabel(row.key),
                  value: row.count,
                  display: String(row.count),
                  color: statusColor(row.key),
                }))}
              />
            </div>
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="open requests per person"
          title="Who is carrying what"
          hint="Only people currently holding something."
          empty={data.workload.length === 0}
          footnote="There is no per-person queue to open, so only your own row links anywhere. Reassignment happens in the request itself or in bulk from a queue."
        >
          <BarList
            rows={data.workload.map((row) => ({
              key: row.userId,
              label: row.name,
              value: row.open,
              display: String(row.open),
            }))}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="owed to us"
          title="Invoice ageing"
          hint="Net of part payments, per currency."
          empty={data.invoiceAge.length === 0}
          emptyMessage="Nothing outstanding."
          action={{ href: "/staff/invoices", label: "Invoices" }}
        >
          <div className="flex flex-col gap-4">
            {data.invoiceAge.map((entry) => (
              <div key={entry.currency}>
                <p className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  {entry.currency}
                </p>
                <BarList
                  rows={entry.bands.map((band) => ({
                    key: `${entry.currency}-${band.label}`,
                    label: band.label,
                    value: band.amount,
                    display: formatValue(band.amount, "money", entry.currency),
                    color: band.label.startsWith("Not yet")
                      ? "var(--chart-3)"
                      : band.label.startsWith("Over 90")
                        ? "var(--danger)"
                        : "var(--warning)",
                  }))}
                />
              </div>
            ))}
          </div>
        </ChartFrame>

        <ChartFrame
          eyebrow="quoting"
          title="Quotes issued over time"
          empty={data.quotesOverTime.length === 0}
        >
          <div className="flex flex-col gap-4">
            <TimeChart
              points={fillSeries(
                buckets,
                data.quotesOverTime,
                [...new Set(data.quotesOverTime.map((row) => row.key).filter(isPresent))],
                label,
              )}
              series={[
                ...new Set(data.quotesOverTime.map((row) => row.key).filter(isPresent)),
              ].map((key) => ({ key, label: statusLabel(key), color: statusColor(key) }))}
              mark="bar"
              stacked
              height={180}
            />
            <div className="border-border flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-[12.5px]">
              <Link
                href="/staff/follow-ups?scope=overdue"
                className="underline underline-offset-4"
              >
                {data.followUps.overdue} overdue follow-ups
              </Link>
              <span className="text-muted-foreground">{data.followUps.open} open in total</span>
            </div>
          </div>
        </ChartFrame>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────── the queues, now */

/**
 * Queue depth as it stands, from `staffCounts` — not re-derived.
 *
 * `features/staff/queues.ts` holds one filter per queue and the counter and the
 * queue page both use it, which is a ticket-20 acceptance criterion. Writing a
 * second set of filters here would let this dashboard and the page it links to
 * disagree about the same number, which is the specific failure that criterion
 * exists to prevent.
 *
 * There is no depth-over-time chart above it, because nothing records what the
 * queue looked like yesterday. Arrivals are historical; depth is not, and the
 * difference is real rather than a gap to paper over.
 */
async function Queues() {
  const { user } = await requireStaffOrRedirect();
  const counts = await staffCounts(user.id);

  const rows = QUEUES.map((queue) => ({
    key: queue.key,
    label: queue.label,
    value: counts.queues[queue.key],
    display: String(counts.queues[queue.key]),
    detail: queue.description,
    href: `/staff/queue/${queue.key}` as Route,
    urgent:
      counts.queues[queue.key] > 0 &&
      (queue.key === "unassigned" ||
        queue.key === "new-custom-build" ||
        queue.key === "new-customization"),
  })).filter((row) => row.value > 0);

  return (
    <ChartFrame
      eyebrow="right now"
      title="Queue depth"
      hint="Empty queues are left out. Each bar opens the queue it counts."
      empty={rows.length === 0}
      emptyMessage="Every queue is clear."
      action={{ href: "/staff", label: "Queue board" }}
    >
      <BarList rows={rows} />
    </ChartFrame>
  );
}

function NotMeasured() {
  return (
    <section className="border-border bg-surface-muted/30 rounded-xl border p-4">
      <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        Not measured
      </p>
      <h2 className="font-display mt-1 text-[15.5px] tracking-[-0.02em]">
        Only two moments in a request&rsquo;s life are timestamped
      </h2>
      <p className="text-muted-foreground mt-1.5 max-w-[52rem] text-[13px] leading-relaxed">
        A request records when it was submitted, and a quote records when it was issued and
        answered &mdash; so &ldquo;request to quote&rdquo; above is a real measurement. Nothing
        records when a request entered review, or how long it sat with a technical analyst, so
        time-in-stage is not shown. It could be built from the activity trail; it cannot be
        inferred from the request, because{" "}
        <span className="font-mono text-[12px]">updatedAt</span> moves for an internal note as
        readily as for real progress.
      </p>
    </section>
  );
}

function isPresent(value: string | null): value is string {
  return value !== null;
}
