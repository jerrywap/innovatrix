import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { listSubmissions } from "@/services/catalog/review-service";

export const metadata: Metadata = { title: "Submissions" };

/**
 * Products waiting on a reviewer — vendor ticket 05.
 *
 * ## Oldest first, and that is a decision
 *
 * A vendor waiting on a review has a product earning nothing, so the fairest order is
 * the obvious one. Not "resubmissions first" and not "smallest first": both are ways
 * of letting somebody wait indefinitely because their submission is inconvenient.
 *
 * ## Not a `QUEUES` key
 *
 * Same reason as `/staff/vendor-applications`: `src/features/staff/queues.ts` counts
 * and lists `CustomerRequest` for every entry, and `QueueRow` carries a
 * `RequestStatus`. A dedicated route is the smaller change; the count still reaches
 * `/staff` through `StaffCounts`.
 *
 * **No `loading.tsx`.** This page refuses, and a boundary above a refusing route
 * flushes the shell first — committing `200 OK` before the refusal is decided.
 */
export default async function Page() {
  await requirePermissionOrForbid("product.review");

  const rows = await listSubmissions();
  const waiting = rows.filter((row) => row.status === "submitted");
  const inHand = rows.filter((row) => row.status === "internal_review");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Submissions"
        description="Products vendors have handed over, oldest first."
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          Waiting for a reviewer{waiting.length > 0 && ` (${waiting.length})`}
        </h2>

        {waiting.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing waiting"
            description="Every submission has been picked up."
          />
        ) : (
          <SubmissionTable rows={waiting} />
        )}
      </section>

      {inHand.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Being reviewed</h2>
          <SubmissionTable rows={inHand} />
        </section>
      )}
    </div>
  );
}

function SubmissionTable({ rows }: { rows: Awaited<ReturnType<typeof listSubmissions>> }) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-[13px]">
        <thead className="border-border bg-surface-muted/50 border-b">
          <tr className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            <th className="px-4 py-2.5 text-left font-normal">Product</th>
            <th className="px-4 py-2.5 text-left font-normal">Seller</th>
            <th className="px-4 py-2.5 text-left font-normal">Submitted</th>
            <th className="px-4 py-2.5 text-left font-normal">Changed since approval</th>
            <th className="px-4 py-2.5 text-left font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-2.5">
                <Link
                  href={`/staff/vendor-submissions/${row.id}`}
                  className="underline underline-offset-4"
                >
                  {row.name}
                </Link>
                {row.resubmission && (
                  <span className="text-subtle ml-2 font-mono text-[10px] tracking-[0.1em] uppercase">
                    resubmitted
                  </span>
                )}
              </td>
              <td className="text-muted-foreground px-4 py-2.5">{row.vendorName}</td>
              <td className="text-muted-foreground px-4 py-2.5">
                {row.submittedAt ? formatDateTime(row.submittedAt) : "—"}
              </td>
              <td className="text-muted-foreground px-4 py-2.5">
                {/* The point of the diff: a resubmission is usually a small change, and
                    re-reviewing the whole product is how a queue falls behind. */}
                {row.changedSections.length > 0 ? row.changedSections.join(", ") : "—"}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
