import type { Metadata, Route } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { BarList, type BarListRow } from "@/components/charts/bar-list";
import { ChartFrame } from "@/components/charts/chart-frame";
import { DonutChart } from "@/components/charts/donut-chart";
import { TimeChart } from "@/components/charts/time-chart";
import {
  formatValue,
  seriesColor,
  statusColor,
  type ChartSeries,
} from "@/components/charts/chart-types";
import { PageHeader } from "@/components/page-header";
import { statusLabel } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { formatDay, formatDayShort, formatMonth } from "@/lib/dates";
import type { RawSearchParams } from "@/lib/list-params";
import {
  adminAttention,
  catalogueAnalytics,
  commerceAnalytics,
  platformAnalytics,
} from "@/features/reporting/admin-analytics";
import { Figure, delta } from "@/features/reporting/components/figure";
import { RangeFilter } from "@/features/reporting/components/range-filter";
import {
  UNGROUPED,
  denseBuckets,
  fillSeries,
  parseRange,
  type Range,
} from "@/features/reporting/range";
import { seriesFrom } from "@/features/reporting/series";
import { productHref } from "@/config/catalogue";

export const metadata: Metadata = { title: "Analytics" };

/**
 * The platform's own figures — the screen `features/reporting/headline.ts` said
 * belonged somewhere else.
 *
 * ## Guarded above every boundary, with no `loading.tsx`
 *
 * `requirePermissionOrForbid` runs in this component's own body, before any JSX
 * is returned. Once bytes are on the wire the status line is committed, so a
 * refusal decided inside a `<Suspense>` — or under a `loading.tsx` over the
 * segment — renders a 403 body under `200 OK`. `loading-boundaries.test.ts`
 * enforces the absence of the file; the ordering here is the other half.
 *
 * ## `searchParams` is never awaited in this body
 *
 * It travels to each section as a promise. Awaiting it here would make the whole
 * route block before the shell could flush, which `admin/products` records
 * discovering, and it is also what makes the fallbacks below appear at all when
 * somebody changes the period: the header and the skeletons flush immediately and
 * the panels stream in behind them.
 *
 * ## Why the sections are separate boundaries
 *
 * Commerce, catalogue and platform are three independent sets of queries. As one
 * boundary, the slowest pipeline holds the other two hostage; as three, each
 * appears as it resolves. That also localises failure — a broken audit
 * aggregation should not blank the revenue chart.
 */
export default async function Page({ searchParams }: PageProps<"/admin/dashboard">) {
  await requirePermissionOrForbid("report.view");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="How the platform is trading, what the catalogue looks like, and whether anything is stuck."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-56 rounded-full" />}>
            <Controls searchParams={searchParams} />
          </Suspense>
        }
      />

      <Suspense fallback={null}>
        <Attention />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <Commerce searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <Catalogue searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <Platform searchParams={searchParams} />
      </Suspense>

      <NotMeasured />
    </div>
  );
}

/**
 * The clock, read once per section, and only inside a boundary.
 *
 * `await connection()` before `new Date()` is not defensive: Next 16 fails the
 * render outright with *"encountered the unstable value `new Date()` while
 * prerendering"*, which `headline.ts` hit six times and solved the same way.
 * `parseRange` then takes the clock as an argument, which is what keeps it
 * testable without a request.
 */
async function windowFor(searchParams: Promise<RawSearchParams>): Promise<{
  raw: RawSearchParams;
  range: Range;
  now: Date;
}> {
  await connection();
  const raw = await searchParams;
  const now = new Date();
  return { raw, range: parseRange(raw, now), now };
}

async function Controls({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { raw, range } = await windowFor(searchParams);
  return <RangeFilter pathname="/admin/dashboard" searchParams={raw} current={range.key} />;
}

/* ────────────────────────────────────────────── what needs doing */

/**
 * §102 — a dashboard leads with what needs doing, not with a number.
 *
 * Renders nothing at all when there is nothing. A permanent "0 items need
 * attention" panel is a fixture that teaches a reader to skip the top of the
 * page, which is exactly where the important thing appears on the day there is
 * one. `analytics-service.ts` made the same call for vendors.
 */
async function Attention() {
  const items = await adminAttention();
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.kind}>
          <Link
            href={item.href}
            className="border-border hover:bg-surface-muted flex items-start gap-2.5 rounded-xl border p-4 text-[13.5px] transition"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
              aria-hidden
            />
            <span>{item.message}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────── commerce */

async function Commerce({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { range, now } = await windowFor(searchParams);
  const data = await commerceAnalytics(range, now);
  const buckets = denseBuckets(range);

  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        title="Commerce"
        note={`Settled money, ${range.label.toLowerCase()} to ${formatDay(now)}`}
      />

      {/*
        One chart per currency, side by side — never one line with two currencies
        on it, and never a combined total. `money.ts` refuses to add £ to $ and
        there is no FX rate on the platform, so a single revenue figure would be a
        number nobody could reconcile against the orders behind it.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.revenue.length === 0 ? (
          <ChartFrame
            title="Revenue"
            eyebrow="settled"
            empty
            emptyMessage="No settled orders in this period."
          />
        ) : (
          data.revenue.map((entry) => {
            const points = fillSeries(buckets, entry.rows, [UNGROUPED], labeller(range));
            return (
              <ChartFrame
                key={entry.currency}
                eyebrow={`revenue · ${entry.currency}`}
                title={formatMoney(entry.total, entry.currency)}
                hint={`${entry.orders} paid ${entry.orders === 1 ? "order" : "orders"}${deltaText(entry.total, entry.previous)}`}
                action={{ href: "/admin/orders", label: "Orders" }}
              >
                <TimeChart
                  points={points}
                  series={[{ key: UNGROUPED, label: entry.currency, color: seriesColor(0) }]}
                  mark="area"
                  valueFormat="money"
                  currency={entry.currency}
                />
              </ChartFrame>
            );
          })
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="this period"
          title="Orders by status"
          empty={data.ordersByStatus.length === 0}
          action={{ href: "/admin/orders", label: "All orders" }}
        >
          <div className="flex flex-wrap items-center gap-6">
            <DonutChart
              slices={data.ordersByStatus.map((row) => ({
                key: row.key,
                label: statusLabel(row.key),
                value: row.count,
                color: statusColor(row.key),
              }))}
              totalLabel="orders"
            />
            <div className="min-w-[13rem] flex-1">
              <BarList
                rows={data.ordersByStatus.map((row) => ({
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
          eyebrow={
            data.paymentSuccessBasisPoints === null
              ? "no attempts resolved"
              : `${formatValue(data.paymentSuccessBasisPoints, "percent")} succeeded`
          }
          title="Payment outcomes"
          hint="Of attempts that reached an outcome. Pending transfers are not counted as failures."
          legend={statusSeries(data.paymentsOverTime)}
          empty={data.paymentsOverTime.length === 0}
          action={{ href: "/admin/payments", label: "Payments" }}
        >
          <PaymentChart rows={data.paymentsOverTime} range={range} buckets={buckets} />
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="licence units sold"
          title="Best sellers"
          hint="Counted from the order lines themselves, not from a stored total."
          empty={data.topProducts.length === 0}
        >
          <BarList
            rows={data.topProducts.map((row) => ({
              key: row.productId,
              label: row.name,
              value: row.units,
              display: `${row.units}`,
              href: productHref(row.slug) as Route,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          eyebrow="unpaid, all time"
          title="Outstanding invoices"
          hint="Net of part payments, per currency. Not limited to the period — an old unpaid invoice is the one worth seeing."
          empty={data.outstanding.length === 0}
          emptyMessage="Nothing outstanding."
          action={{ href: "/staff/invoices", label: "Invoices" }}
        >
          <div className="flex flex-col gap-4">
            <BarList
              rows={data.outstanding.map((row) => ({
                key: row.currency,
                label: row.currency,
                value: row.amount,
                display: formatMoney(row.amount, row.currency),
                detail: `${row.invoices} ${row.invoices === 1 ? "invoice" : "invoices"}`,
              }))}
            />
            {data.outstandingAge.length > 0 && (
              <div className="border-border border-t pt-3">
                <p className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  Past due
                </p>
                <BarList
                  rows={data.outstandingAge.map((band) => ({
                    key: band.label,
                    label: band.label,
                    value: band.count,
                    display: String(band.count),
                    color: band.from >= 31 ? "var(--danger)" : "var(--warning)",
                  }))}
                />
              </div>
            )}
          </div>
        </ChartFrame>
      </div>
    </section>
  );
}

/**
 * Payment statuses stacked over time.
 *
 * A stack rather than lines, because the question is "what proportion of
 * attempts went through" and lines make the reader add them up. Colours come
 * from `statusColor`, so `failed` is the same red here as on every badge.
 */
function PaymentChart({
  rows,
  range,
  buckets,
}: {
  rows: Parameters<typeof seriesFrom>[0];
  range: Range;
  buckets: Date[];
}) {
  const series = statusSeries(rows);
  return (
    <TimeChart
      points={fillSeries(
        buckets,
        rows,
        series.map((one) => one.key),
        labeller(range),
      )}
      series={series}
      mark="bar"
      stacked
    />
  );
}

/* ────────────────────────────────────────────── catalogue */

async function Catalogue({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { range } = await windowFor(searchParams);
  const data = await catalogueAnalytics(range);
  const buckets = denseBuckets(range);

  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        title="Catalogue and demand"
        note="What we sell, and what people came looking for"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="New customers"
          value={String(data.newOrganizationsTotal)}
          detail={`in the last ${range.label.toLowerCase()}`}
          delta={delta(
            data.newOrganizationsTotal,
            data.newOrganizationsPrevious,
            "on the period before",
          )}
          spark={fillSeries(buckets, data.newOrganizations, [UNGROUPED], labeller(range)).map(
            (row) => row.values[UNGROUPED] ?? 0,
          )}
          href="/staff/customers"
        />
        <Figure
          label="Published"
          value={String(
            data.productsByStatus.find((row) => row.key === "published")?.count ?? 0,
          )}
          detail="live on the marketplace"
          href="/admin/products"
        />
        <Figure
          label="Awaiting review"
          value={String(
            data.productsByStatus.find((row) => row.key === "submitted")?.count ?? 0,
          )}
          detail="submitted, not yet decided"
          href="/staff/vendor-submissions"
        />
        <Figure
          label="Vendors"
          value={String(data.vendorsByStatus.find((row) => row.key === "verified")?.count ?? 0)}
          detail={`${data.vendorsByStatus.filter((row) => row.key === "applied" || row.key === "in_review").reduce((sum, row) => sum + row.count, 0)} in the pipeline`}
          href="/staff/vendor-applications"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="published catalogue"
          title="By category"
          hint="Counted off the same facets the marketplace filters on."
          empty={data.categories.length === 0}
        >
          <BarList
            rows={data.categories.map((row) => ({
              key: row.slug,
              label: row.name,
              value: row.products,
              display: String(row.products),
              href: `/marketplace?category=${row.slug}` as Route,
            }))}
          />
        </ChartFrame>

        <ChartFrame
          eyebrow="all statuses"
          title="Catalogue pipeline"
          empty={data.productsByStatus.length === 0}
          action={{ href: "/admin/products", label: "Products" }}
        >
          <BarList
            rows={data.productsByStatus.map((row) => ({
              key: row.key,
              label: statusLabel(row.key),
              value: row.count,
              display: String(row.count),
              color: statusColor(row.key),
              href: `/admin/products?status=${row.key}` as Route,
            }))}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow="going live"
          title="Published over time"
          empty={data.publishedOverTime.length === 0}
        >
          <TimeChart
            points={fillSeries(buckets, data.publishedOverTime, [UNGROUPED], labeller(range))}
            series={[{ key: UNGROUPED, label: "Published", color: seriesColor(1) }]}
            mark="bar"
            height={180}
          />
        </ChartFrame>

        <ChartFrame
          eyebrow="most asked for"
          title="Searches"
          empty={data.searches.length === 0}
          emptyMessage="Nobody has searched yet."
          footnote="The search log records the term and how often it was asked, but not whether anything came back — so the most useful question, which searches found nothing, cannot be answered from it."
        >
          <BarList
            rows={data.searches.map((row) => ({
              key: row.term,
              label: row.term,
              value: row.count,
              display: String(row.count),
              href: `/marketplace?q=${encodeURIComponent(row.term)}` as Route,
            }))}
          />
        </ChartFrame>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────── platform */

async function Platform({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { range } = await windowFor(searchParams);
  const data = await platformAnalytics(range);
  const buckets = denseBuckets(range);

  const jobRows: BarListRow[] = data.jobsByName.slice(0, 10).map((row) => ({
    key: row.name,
    label: row.name,
    value: row.succeeded + row.failed + row.dead,
    display: String(row.succeeded + row.failed + row.dead),
    ...(row.dead > 0 ? { detail: `${row.dead} dead`, color: "var(--danger)" } : {}),
    ...(row.dead > 0 ? { urgent: true } : {}),
    href: "/admin/jobs" as Route,
  }));

  return (
    <section className="flex flex-col gap-4">
      <SectionHead
        title="Platform health"
        note="Background work, activity, and what the assistants cost"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          eyebrow={data.deadJobs > 0 ? `${data.deadJobs} dead` : "all clear"}
          title="Background jobs"
          empty={jobRows.length === 0}
          action={{ href: "/admin/jobs", label: "Queue" }}
          footnote="Succeeded jobs are deleted seven days after they finish, so these totals are a rolling week and not the platform's whole history. Dead and failed jobs are not expired and do accumulate."
        >
          <BarList rows={jobRows} />
        </ChartFrame>

        <ChartFrame
          eyebrow="recorded actions"
          title="Audit activity"
          empty={data.auditOverTime.length === 0}
          action={{ href: "/admin/audit", label: "Audit log" }}
        >
          <div className="flex flex-col gap-4">
            <TimeChart
              points={fillSeries(buckets, data.auditOverTime, [UNGROUPED], labeller(range))}
              series={[{ key: UNGROUPED, label: "Entries", color: seriesColor(2) }]}
              mark="bar"
              height={160}
            />
            <div className="border-border border-t pt-3">
              <BarList
                rows={data.auditActions.slice(0, 6).map((row) => ({
                  key: row.key,
                  label: row.key,
                  value: row.count,
                  display: String(row.count),
                  href: `/admin/audit?action=${encodeURIComponent(row.key)}` as Route,
                }))}
              />
            </div>
          </div>
        </ChartFrame>
      </div>

      <ChartFrame
        eyebrow="assistant spend"
        title={`${(data.aiSpendMicros / 1_000_000).toFixed(2)} USD`}
        hint={`Across ${data.aiConversations} ${data.aiConversations === 1 ? "conversation" : "conversations"} in this period.`}
        empty={data.aiSpendOverTime.length === 0}
        emptyMessage="No assistant usage in this period."
        action={{ href: "/admin/settings/ai", label: "Assistant settings" }}
        footnote="Provider cost as reported per turn, accumulated on each conversation. It is a usage figure rather than an invoice, and it is not platform revenue — so it is deliberately not rendered as one of our currencies."
      >
        <TimeChart
          points={fillSeries(buckets, data.aiSpendOverTime, [UNGROUPED], labeller(range))}
          series={[{ key: UNGROUPED, label: "Micros", color: seriesColor(3) }]}
          mark="area"
          height={160}
        />
      </ChartFrame>
    </section>
  );
}

/* ────────────────────────────────────────────── what this does not say */

/**
 * The honest gap, stated on the screen.
 *
 * `services/vendors/analytics-service.ts` set the precedent — it returns
 * `traffic: null` and its ticket is explicit that the alternative is worse: *"It
 * does not stub a number that looks real."* A conversion rate is the figure most
 * expected on a screen like this and the one we are least able to produce, so
 * saying that plainly is the only version that does not mislead.
 */
function NotMeasured() {
  return (
    <section className="border-border bg-surface-muted/30 rounded-xl border p-4">
      <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        Not measured
      </p>
      <h2 className="font-display mt-1 text-[15.5px] tracking-[-0.02em]">
        There is no traffic or conversion data here
      </h2>
      <p className="text-muted-foreground mt-1.5 max-w-[52rem] text-[13px] leading-relaxed">
        Nothing on the platform counts a page view, so views, view-to-purchase conversion and
        funnel drop-off cannot be shown. Counting them is a real piece of work &mdash; a write
        on the busiest public page, a daily aggregate, and a position to take on what is stored
        about a visitor &mdash; and until that exists, a number here would be a guess presented
        as a measurement.
      </p>
    </section>
  );
}

/* ────────────────────────────────────────────── shared bits */

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-display text-[17px] tracking-[-0.02em]">{title}</h2>
      <p className="text-subtle text-[12px]">{note}</p>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/**
 * Axis labels, built on the server.
 *
 * A monthly bucket needs its year and a daily one does not — "14 Aug" repeated
 * across a 90-day window is fine, but across twelve months it is ambiguous.
 * Both formatters live in `lib/dates.ts`, which is the only file
 * `dates.enforcement.test.ts` lets construct an `Intl.DateTimeFormat`.
 */
function labeller(range: Range): (bucket: Date) => string {
  return range.granularity === "month" ? formatMonth : formatDayShort;
}

function formatMoney(minor: number, currency: string): string {
  // `formatValue` already falls back to a plain number for a currency it does
  // not recognise, so there is nothing to guard here.
  return formatValue(minor, "money", currency);
}

function deltaText(current: number, previous: number): string {
  if (previous === 0) return "";
  const change = Math.round(((current - previous) / previous) * 100);
  return ` · ${change > 0 ? "+" : ""}${change}% on the period before`;
}

function statusSeries(rows: ReadonlyArray<{ key: string | null }>): ChartSeries[] {
  const keys = [
    ...new Set(rows.map((row) => row.key).filter((key): key is string => key !== null)),
  ];
  return keys.map((key) => ({ key, label: statusLabel(key), color: statusColor(key) }));
}
