import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
import { CustomerRequest } from "@/lib/db/models/requests";
import { Entitlement } from "@/lib/db/models/commerce";

export const metadata: Metadata = { title: "Customers" };

/**
 * The way in to Customer 360 (§33).
 *
 * Ordered by most recently active rather than alphabetically: staff arrive here
 * looking for someone they were just dealing with, not browsing a directory.
 */
export default async function Page() {
  /*
   * The guard is here, not inside the boundary below.
   *
   * `forbidden()` sets a 403 on the response, and a response whose shell has
   * already streamed is committed at 200 — so a guard inside `<Suspense>`
   * renders the refusal under a success status. Awaiting it before returning
   * any JSX costs a session read and one indexed query, and the list still
   * streams.
   */
  await requirePermissionOrForbid("customer.view_all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone who has bought or asked for something."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <CustomerList />
      </Suspense>
    </div>
  );
}

async function CustomerList() {
  await connectToDatabase();

  const organizations = await Organization.find({ isPersonal: { $ne: true } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean<Array<{ _id: unknown; name: string; slug: string }>>();

  if (organizations.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No customers yet"
        description="Organizations appear here once somebody signs up."
      />
    );
  }

  const ids = organizations.map((org) => org._id);

  // Two grouped counts for the whole page rather than two per row — the same
  // N+1 the queue rows avoid, and felt worse here because the list is longer.
  const [requestCounts, softwareCounts] = await Promise.all([
    CustomerRequest.aggregate<{ _id: unknown; n: number }>([
      { $match: { organizationId: { $in: ids }, status: { $ne: "draft" } } },
      { $group: { _id: "$organizationId", n: { $sum: 1 } } },
    ]),
    Entitlement.aggregate<{ _id: unknown; n: number }>([
      { $match: { organizationId: { $in: ids }, status: "active" } },
      { $group: { _id: "$organizationId", n: { $sum: 1 } } },
    ]),
  ]);

  const requests = new Map(requestCounts.map((row) => [String(row._id), row.n]));
  const software = new Map(softwareCounts.map((row) => [String(row._id), row.n]));

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {organizations.map((org) => (
        <li key={String(org._id)}>
          <Link
            href={`/staff/customers/${String(org._id)}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="text-[14px] font-medium">{org.name}</span>
            <span className="text-subtle font-mono text-[11.5px]">
              {requests.get(String(org._id)) ?? 0} requests ·{" "}
              {software.get(String(org._id)) ?? 0} products
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
