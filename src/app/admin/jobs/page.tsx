import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadJobsOverview, type JobRow } from "@/features/jobs/jobs-view";
import { CancelJob, RetryJob, RunQueueNow } from "@/features/jobs/components/job-controls";

export const metadata: Metadata = { title: "Jobs" };

/**
 * Background work, its schedule and its failures — §86, §95.
 *
 * ## Dead-lettered first
 *
 * The page is ordered by who has to do something about it. A dead job needs a
 * person; an in-flight job needs nothing; a name-by-name breakdown is reference
 * material. Putting the depth chart at the top would be prettier and would bury
 * the only section that is ever urgent.
 */
export default async function Page() {
  // Before the boundary, so a refusal carries a 403 rather than rendering under
  // the 200 a streamed shell has already committed.
  await requirePermissionOrForbid("system.manage_jobs");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" description="Background work, its schedule and its failures." />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  const overview = await loadJobsOverview();
  const { totals } = overview;
  const everRan = Object.values(totals).some((count) => count > 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Dead" value={totals.dead} tone={totals.dead > 0 ? "bad" : "plain"} />
          <Stat
            label="Failed"
            value={totals.failed}
            tone={totals.failed > 0 ? "warn" : "plain"}
          />
          <Stat label="Pending" value={totals.pending} />
          <Stat label="In flight" value={totals.processing} />
          <Stat
            label="Oldest wait"
            value={
              overview.oldestPendingMinutes === null ? "—" : `${overview.oldestPendingMinutes}m`
            }
            tone={
              overview.oldestPendingMinutes !== null && overview.oldestPendingMinutes > 30
                ? "warn"
                : "plain"
            }
          />
        </div>
        <RunQueueNow />
      </section>

      {overview.dead.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-[17px] tracking-[-0.02em]">Dead-lettered</h2>
            <p className="text-muted-foreground text-[13px]">
              These ran out of attempts and will not run again. Nothing else is waiting on them.
            </p>
          </div>
          <Table rows={overview.dead} actions="retry" />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">By job</h2>
        {overview.byName.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No jobs registered"
            description="Scheduled and queued background jobs will be listed here."
          />
        ) : (
          <div className="border-border overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[44rem] text-left">
              <thead className="border-border bg-surface-muted border-b">
                <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  <th className="px-4 py-2.5 font-normal">Job</th>
                  <th className="px-4 py-2.5 font-normal">Schedule</th>
                  <th className="px-4 py-2.5 font-normal">Pending</th>
                  <th className="px-4 py-2.5 font-normal">In flight</th>
                  <th className="px-4 py-2.5 font-normal">Failed</th>
                  <th className="px-4 py-2.5 font-normal">Dead</th>
                  <th className="px-4 py-2.5 font-normal">Done</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {overview.byName.map((row) => (
                  <tr key={row.name} className="hover:bg-surface-muted">
                    <td className="px-4 py-2.5 font-mono text-[12px]">
                      {row.name}
                      {!row.registered && (
                        <span
                          className="ml-2 text-[11px] text-red-600 dark:text-red-400"
                          title="Rows exist for this name but no handler is registered — a job from a newer deploy, or a name that was removed."
                        >
                          no handler
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-[12.5px]">
                      {row.everyMinutes ? cadence(row.everyMinutes) : "on demand"}
                    </td>
                    <Count value={row.pending} />
                    <Count value={row.processing} />
                    <Count value={row.failed} tone="warn" />
                    <Count value={row.dead} tone="bad" />
                    <Count value={row.succeeded} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overview.inFlight.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">In flight</h2>
          <Table rows={overview.inFlight} showWorker />
        </section>
      )}

      {everRan && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Most recent</h2>
          <Table rows={overview.recent} actions="cancel" />
        </section>
      )}
    </div>
  );
}

function Table({
  rows,
  actions,
  showWorker,
}: {
  rows: JobRow[];
  actions?: "retry" | "cancel";
  showWorker?: boolean;
}) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[52rem] text-left">
        <thead className="border-border bg-surface-muted border-b">
          <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            <th className="px-4 py-2.5 font-normal">Job</th>
            <th className="px-4 py-2.5 font-normal">Status</th>
            <th className="px-4 py-2.5 font-normal">Tries</th>
            <th className="px-4 py-2.5 font-normal">{showWorker ? "Worker" : "Runs at"}</th>
            <th className="px-4 py-2.5 font-normal">Last error</th>
            {actions && <th className="px-4 py-2.5 font-normal">Action</th>}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-muted align-top">
              <td className="px-4 py-2.5">
                <Link
                  href={`/admin/jobs/${row.id}` as Route}
                  className="font-mono text-[12px] underline underline-offset-4"
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11.5px]">{row.status}</td>
              <td className="text-subtle px-4 py-2.5 font-mono text-[12px]">
                {row.attempts}/{row.maxAttempts}
              </td>
              <td className="text-subtle px-4 py-2.5 font-mono text-[11.5px]">
                {showWorker ? (row.lockedBy ?? "—") : row.runAt}
              </td>
              <td className="text-muted-foreground max-w-[24rem] px-4 py-2.5 text-[12.5px]">
                {row.lastError ?? "—"}
              </td>
              {actions === "retry" && (
                <td className="px-4 py-2.5">
                  <RetryJob jobId={row.id} />
                </td>
              )}
              {actions === "cancel" && (
                <td className="px-4 py-2.5">
                  {row.status === "pending" || row.status === "failed" ? (
                    <CancelJob jobId={row.id} />
                  ) : (
                    <span className="text-subtle text-[12px]">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  tone?: "plain" | "warn" | "bad";
}) {
  const colour =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "";

  return (
    <div className="border-border bg-surface rounded-xl border px-3.5 py-2">
      <div className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
        {label}
      </div>
      <div className={`font-display text-[19px] tracking-[-0.02em] ${colour}`}>{value}</div>
    </div>
  );
}

function Count({ value, tone }: { value: number; tone?: "warn" | "bad" }) {
  const colour =
    value === 0
      ? "text-subtle"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : tone === "warn"
          ? "text-amber-700 dark:text-amber-400"
          : "";

  return <td className={`px-4 py-2.5 font-mono text-[12px] ${colour}`}>{value}</td>;
}

function cadence(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "daily" : `every ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "hourly" : `every ${hours} hours`;
  }
  return `every ${minutes} min`;
}
