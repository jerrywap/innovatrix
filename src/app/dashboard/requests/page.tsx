import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ClipboardList, Sparkles, Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/dal";
import { listRequestsForOrganization } from "@/features/requests/request-view";

export const metadata: Metadata = { title: "Requests" };

/**
 * What the customer has asked us to build — §11, ticket 19.
 *
 * Scoped by `requireOrg()`; `listRequestsForOrganization` takes the id as a
 * required argument, so a request belonging to another organisation is not a
 * state this page can reach.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Requests"
        description="Custom work you've asked us to scope or build."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <RequestList />
      </Suspense>
    </div>
  );
}

async function RequestList() {
  const { organizationId } = await requireOrg();
  const requests = await listRequestsForOrganization(organizationId);

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No requests yet"
        description="Describe what you need and we'll scope it, then send you a quote."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/custom-software">
                <Sparkles className="size-3.5" aria-hidden />
                Describe something new
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/marketplace">
                <Store className="size-3.5" aria-hidden />
                Browse what exists
              </Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {requests.map((request) => (
        <li key={request.id}>
          <Link
            href={`/dashboard/requests/${request.reference}` as Route}
            className="hover:bg-surface-muted flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                {request.title}
                {/* §32's "waiting for customer" made visible where it matters
                    most — on the customer's own list, so a stalled request is
                    obviously their move rather than ours. */}
                {request.waitingOn === "customer" && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-amber-700 uppercase dark:text-amber-400">
                    needs you
                  </span>
                )}
              </p>
              <p className="text-subtle font-mono text-[11.5px]">
                {request.reference}
                {request.productName ? ` · ${request.productName}` : ""}
                {` · ${request.createdAt}`}
              </p>
            </div>
            <StatusBadge status={request.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
