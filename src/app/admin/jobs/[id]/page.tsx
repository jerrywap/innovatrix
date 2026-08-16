import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadJob } from "@/features/jobs/jobs-view";
import { CancelJob, RetryJob } from "@/features/jobs/components/job-controls";

export const metadata: Metadata = { title: "Job" };

/**
 * One job: what it was asked to do, how many times it tried, and why it stopped.
 *
 * ## No `<Suspense>`, deliberately
 *
 * The 404 depends on the only query this page makes, so there is nothing to
 * stream ahead of it — a boundary here would flush a shell and commit a 200
 * before `notFound()` had been decided. See `loading-boundaries.test.ts`.
 *
 * ## The payload is shown raw
 *
 * It is the input that produced the failure, and the person reading this screen
 * is debugging. A prettified summary would hide the field that is wrong, which
 * is the field they are looking for.
 */
export default async function Page({ params }: PageProps<"/admin/jobs/[id]">) {
  await requirePermissionOrForbid("system.manage_jobs");

  const { id } = await params;
  const job = await loadJob(id);
  if (!job) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={job.name}
        description={`${job.status} · attempt ${job.attempts} of ${job.maxAttempts} · created ${job.createdAt}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        {job.status === "dead" && <RetryJob jobId={job.id} />}
        {(job.status === "pending" || job.status === "failed") && <CancelJob jobId={job.id} />}
        <Link href="/admin/jobs" className="text-[13px] underline underline-offset-4">
          Back to jobs
        </Link>
      </div>

      <dl className="border-border bg-surface grid gap-x-8 gap-y-3 rounded-xl border p-4 sm:grid-cols-2">
        <Field label="Runs at" value={job.runAt} />
        <Field label="Worker" value={job.lockedBy ?? "—"} />
        <Field label="Attempts" value={`${job.attempts} / ${job.maxAttempts}`} />
        <Field label="Status" value={job.status} />
      </dl>

      {job.lastError && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Last error</h2>
          <pre className="border-border bg-surface-muted overflow-x-auto rounded-xl border p-4 font-mono text-[12px] whitespace-pre-wrap">
            {job.lastError}
          </pre>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Payload</h2>
        <pre className="border-border bg-surface-muted overflow-x-auto rounded-xl border p-4 font-mono text-[12px]">
          {JSON.stringify(job.payload, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
        {label}
      </dt>
      <dd className="font-mono text-[12.5px]">{value}</dd>
    </div>
  );
}
