import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/dates";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { Product } from "@/lib/db/models/catalog";
import { vendorThread } from "@/services/messaging/messaging-service";
import { listForVendor, responsiveness, slaHoursFor } from "@/services/vendors/support-service";
import { VendorThreadPanel } from "@/features/support/components/thread-panel";

export const metadata: Metadata = { title: "Support" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The vendor's support inbox — vendor ticket 13.
 *
 * ## The vendor answers first
 *
 * They wrote the software. Routing every question through staff who have not seen the code helps
 * nobody, so a thread opens against the vendor with staff as observers, and escalation *adds* staff
 * rather than taking the thread away.
 *
 * ## What a vendor cannot see
 *
 * An `internal` message. §37's boundary gained a second edge here: `internal` now means staff-only,
 * and that includes hiding it from the vendor — a staff assessment of a vendor's responsiveness is
 * exactly the note that must not reach them. The guarantee is `vendorThread()`, which has no
 * audience parameter to get wrong, and `VendorMessage`, which has no field an internal message
 * could occupy.
 *
 * Any active member reads and answers, not just the owner (vendor ticket 03).
 */
export default async function Page() {
  const context = await requireVendorOrForbid();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Support"
        description="Questions from your customers. You answer these first — we watch rather than run them."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Threads vendorId={context.vendorId} userId={context.user.id} vendor={context.vendor} />
      </Suspense>
    </div>
  );
}

async function Threads({
  vendorId,
  userId,
  vendor,
}: {
  vendorId: string;
  userId: string;
  vendor: Parameters<typeof slaHoursFor>[0];
}) {
  const [threads, metrics] = await Promise.all([
    listForVendor({ vendorId }),
    responsiveness(vendorId),
  ]);

  const productIds = [...new Set(threads.map((row) => String(row.productId ?? "")))].filter(
    Boolean,
  );
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select({ name: 1 })
        .lean<Array<{ _id: unknown; name: string }>>()
    : [];
  const nameById = new Map(products.map((row) => [String(row._id), row.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border bg-surface-muted/40 flex flex-col gap-1.5 rounded-xl border p-5">
        <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Your response target
        </h2>
        <p className="text-[13.5px]">
          {slaHoursFor(vendor)} hours to a first reply. Customers are shown this before they
          open a thread, so it is a promise rather than a guideline.
        </p>
        <p className="text-muted-foreground text-[12.5px]">
          {metrics.medianHours === null
            ? "No answered threads yet."
            : `Your median first reply is ${metrics.medianHours} hours across ${metrics.threads} ${
                metrics.threads === 1 ? "thread" : "threads"
              }.`}
          {metrics.overdue > 0 &&
            ` ${metrics.overdue} ${metrics.overdue === 1 ? "thread is" : "threads are"} past the target.`}
        </p>
      </div>

      {threads.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No support threads"
          description="When a customer asks about something they bought from you, it appears here."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {threads.map((thread) => (
            <li
              key={String(thread._id)}
              className="border-border flex flex-col gap-3 rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium">
                  {nameById.get(String(thread.productId ?? "")) ?? "A product of yours"}
                </span>
                <span className="flex items-center gap-2">
                  {thread.dispute && <StatusBadge status={thread.dispute.status} />}
                  {thread.escalatedAt && !thread.dispute && (
                    <span className="text-subtle font-mono text-[10px] tracking-[0.14em] uppercase">
                      escalated
                    </span>
                  )}
                  <span className="text-subtle font-mono text-[11px]">
                    {thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : ""}
                  </span>
                </span>
              </div>

              {thread.dispute && (
                <div className="border-border rounded-lg border p-3 text-[13px]">
                  <p className="text-subtle font-mono text-[10.5px] tracking-[0.14em] uppercase">
                    Dispute · raised by the {thread.dispute.raisedByType}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{thread.dispute.detail}</p>
                  {thread.dispute.outcomeReason && (
                    <p className="mt-2 border-t pt-2">
                      <span className="text-subtle">Decided: </span>
                      {thread.dispute.outcomeReason}
                    </p>
                  )}
                </div>
              )}

              <Thread
                conversationId={String(thread._id)}
                organizationId={String(thread.organizationId)}
                entitlementId={String(thread.subjectId)}
                userId={userId}
              />

              <VendorThreadPanel
                conversationId={String(thread._id)}
                entitlementId={String(thread.subjectId)}
                hasOpenDispute={
                  thread.dispute
                    ? ["open", "under_review"].includes(thread.dispute.status)
                    : false
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The messages, as the vendor may read them.
 *
 * `vendorThread()` — the one function for this audience, with no parameter to get wrong. Each
 * message shows whether the customer can see it, because a vendor writing their next reply needs to
 * know which of their previous ones the buyer actually read.
 */
async function Thread({
  conversationId,
  organizationId,
  entitlementId,
  userId,
}: {
  conversationId: string;
  organizationId: string;
  entitlementId: string;
  userId: string;
}) {
  void conversationId;

  const messages = await vendorThread({
    organizationId,
    subjectType: "vendor_support",
    subjectId: entitlementId,
    viewerUserId: userId,
  });

  if (messages.length === 0) return null;

  return (
    <ul className="divide-border divide-y text-[13px]">
      {messages.map((message) => (
        <li key={message.id} className="flex flex-col gap-1 py-2">
          <span className="text-subtle font-mono text-[11px]">
            {message.senderName ?? message.senderType} ·{" "}
            {message.at.slice(0, 16).replace("T", " ")}
            {!message.visibleToCustomer && " · not visible to the customer"}
          </span>
          {/* Escaped by React. Customer-written text on a vendor's screen. */}
          <span className="whitespace-pre-wrap">{message.body}</span>
        </li>
      ))}
    </ul>
  );
}
