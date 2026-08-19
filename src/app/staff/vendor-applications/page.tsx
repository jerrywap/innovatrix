import type { Metadata } from "next";
import Link from "next/link";
import { Building } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requireAnyPermissionOrForbid } from "@/lib/auth/dal";
import { listByStatus } from "@/services/vendors/vendor-service";

export const metadata: Metadata = { title: "Vendors" };

/**
 * The vendor application queue — vendor ticket 01.
 *
 * ## Not a `QUEUES` key
 *
 * The ticket said to add one, and it cannot be done: `src/features/staff/queues.ts`
 * is hard-wired to `CustomerRequest` — `staffCounts` counts documents in it and
 * `QueueRow` carries `kind: "customization" | "custom_build"` and a
 * `RequestStatus`. Generalising `QueueDefinition` over a model and a row-mapper
 * would touch `QUEUES`, `staffCounts`, `queueRows`, `QueueRow`, `QueueTable` and
 * the `[key]` page, for two screens that need none of it. A dedicated route
 * modelled on `/staff/follow-ups` is the smaller change; the count still reaches
 * `/staff` through `StaffCounts`.
 *
 * ## No `loading.tsx`, ever
 *
 * This page refuses — `requireAnyPermissionOrForbid` calls `forbidden()` — and a
 * `loading.tsx` at or above a refusing route flushes the shell first, which
 * commits `200 OK` before the refusal is decided. Crawlers, monitors and `curl`
 * would all be told the request succeeded. `loading-boundaries.test.ts` enforces
 * this and names the offending pair; `/staff/follow-ups` has one precisely because
 * it never refuses.
 *
 * Ordered oldest-first: a vendor waiting on a decision cannot sell, and the
 * fairest order is the obvious one.
 */
export default async function Page() {
  await requireAnyPermissionOrForbid(["vendor.review", "vendor.verify"]);

  const rows = await listByStatus(["applied", "in_review", "verified", "suspended"]);

  const waiting = rows.filter((row) => row.status === "applied" || row.status === "in_review");
  const decided = rows.filter((row) => row.status !== "applied" && row.status !== "in_review");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Vendors"
        description="Applications to sell on CoSetup, and the vendors already here."
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          Waiting on us{waiting.length > 0 && ` (${waiting.length})`}
        </h2>

        {waiting.length === 0 ? (
          <EmptyState
            icon={Building}
            title="Nothing waiting"
            description="Every application has been decided."
          />
        ) : (
          <VendorTable rows={waiting} />
        )}
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Active vendors</h2>
          <VendorTable rows={decided} />
        </section>
      )}
    </div>
  );
}

function VendorTable({ rows }: { rows: Awaited<ReturnType<typeof listByStatus>> }) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-[13px]">
        <thead className="border-border bg-surface-muted/50 border-b">
          <tr className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            <th className="px-4 py-2.5 text-left font-normal">Vendor</th>
            <th className="px-4 py-2.5 text-left font-normal">Country</th>
            <th className="px-4 py-2.5 text-left font-normal">Applied</th>
            <th className="px-4 py-2.5 text-left font-normal">Identity</th>
            <th className="px-4 py-2.5 text-left font-normal">Business</th>
            <th className="px-4 py-2.5 text-left font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-2.5">
                <Link
                  href={`/staff/vendor-applications/${row.id}`}
                  className="underline underline-offset-4"
                >
                  {row.displayName}
                </Link>
              </td>
              <td className="text-muted-foreground px-4 py-2.5 font-mono text-[11.5px]">
                {row.country}
              </td>
              <td className="text-muted-foreground px-4 py-2.5">
                {formatDateTime(row.appliedAt)}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={row.identityStatus} />
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={row.businessStatus} />
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
