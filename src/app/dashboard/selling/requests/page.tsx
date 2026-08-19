import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/dates";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { listForVendor } from "@/services/vendors/brief-service";

export const metadata: Metadata = { title: "Requests" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Customization work a vendor has been asked to price — vendor ticket 14.
 *
 * ## What a customer asked for, never who asked
 *
 * A customer wanting changes to a vendor's product is asking about code the vendor wrote, so the
 * vendor is who should scope and price it (decision W1). They are **not** told who is asking
 * (decision W2), and that is structural rather than a projection: the brief is a separate document
 * from the request, cut once by `brief-service.briefFrom()`, and a vendor is not a participant in
 * the customer's conversation at all. Nothing on this screen has a customer field to hide.
 *
 * ## Staff triage first
 *
 * Nothing appears here at submission (decision W3). A staff member reads the request and sends it,
 * so junk, abuse and off-topic asks never reach a vendor's inbox.
 *
 * `requireVendorOrForbid()` is awaited in this component's own body, before any JSX, so the refusal
 * is decided before the first flush; the list itself is inside `<Suspense>`. No `loading.tsx` at or
 * above this segment — that would put a boundary over a refusing page and render the 403 under
 * `200 OK`, which `loading-boundaries.test.ts` enforces.
 */
export default async function Page() {
  const context = await requireVendorOrForbid();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customization requests"
        description="Customers asking for changes to your software. Tell us what the work would cost and we handle the rest."
        breadcrumbs={[{ label: "Selling", href: "/dashboard/selling" }, { label: "Requests" }]}
      />

      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <Briefs vendorId={context.vendorId} />
      </Suspense>
    </div>
  );
}

async function Briefs({ vendorId }: { vendorId: string }) {
  const briefs = await listForVendor({ vendorId });

  if (briefs.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Nothing to price"
        description="When a customer asks for changes to one of your products, it appears here once we have read it."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {briefs.map((brief) => (
        <li key={brief.id} className="border-border rounded-xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/dashboard/selling/requests/${brief.id}` as Route}
                className="text-[14.5px] font-medium underline-offset-4 hover:underline"
              >
                {brief.title}
              </Link>
              <p className="text-muted-foreground text-[13px]">{brief.productName}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <StatusBadge status={brief.status} />
              <span className="text-subtle font-mono text-[11px]">
                {formatDateTime(brief.sentAt)}
              </span>
            </div>
          </div>

          <p className="text-subtle mt-3 text-[12.5px]">
            {brief.requirements.length}{" "}
            {brief.requirements.length === 1 ? "requirement" : "requirements"}
            {brief.desiredTimeline ? ` · they mentioned ${brief.desiredTimeline}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
