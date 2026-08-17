import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { Product } from "@/lib/db/models/catalog";
import { Vendor } from "@/lib/db/models/vendors";
import { staffThread } from "@/services/messaging/messaging-service";
import { listDisputes } from "@/services/vendors/support-service";
import { ResolvePanel } from "@/features/support/components/resolve-panel";

export const metadata: Metadata = { title: "Disputes" };

// TODO: Cache Components adoption. Refactor this route so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The dispute queue — vendor ticket 13.
 *
 * ## Oldest first, and no filters
 *
 * A dispute is the one thing on this platform where both parties are waiting on *us*. Sorting by
 * age rather than by recency is the whole ordering decision: a dispute that arrived on Monday and
 * has been passed over four times is exactly the one a status filter would hide.
 *
 * ## Staff read everything, and that is the point of this screen
 *
 * `staffThread()` returns messages at every visibility, including the vendor's notes to us and our
 * own internal ones. Neither party sees this view: the customer's payload has no `vendor` or
 * `internal` message in it and the vendor's has no `internal` one, enforced in the query rather
 * than by this page choosing what to draw.
 *
 * No `loading.tsx` under this route — it refuses, and a boundary above a refusing page flushes the
 * shell before the refusal is decided.
 */
export default async function Page() {
  await requirePermissionOrForbid("vendor.review");

  const disputes = await listDisputes();

  if (disputes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <EmptyState
          icon={Scale}
          title="No open disputes"
          description="Either party can raise one, and it appears here the moment they do — nobody has to notice an escalation is due."
        />
      </div>
    );
  }

  const vendorIds = [...new Set(disputes.map((row) => String(row.vendorId ?? "")))].filter(
    Boolean,
  );
  const productIds = [...new Set(disputes.map((row) => String(row.productId ?? "")))].filter(
    Boolean,
  );

  const [vendors, products] = await Promise.all([
    vendorIds.length
      ? Vendor.find({ _id: { $in: vendorIds } })
          .select({ displayName: 1 })
          .lean<Array<{ _id: unknown; displayName: string }>>()
      : [],
    productIds.length
      ? Product.find({ _id: { $in: productIds } })
          .select({ name: 1 })
          .lean<Array<{ _id: unknown; name: string }>>()
      : [],
  ]);

  const vendorName = new Map(vendors.map((row) => [String(row._id), row.displayName]));
  const productName = new Map(products.map((row) => [String(row._id), row.name]));

  return (
    <div className="flex flex-col gap-6">
      <Header />

      <ul className="flex flex-col gap-4">
        {disputes.map((thread) => {
          const dispute = thread.dispute!;

          return (
            <li
              key={String(thread._id)}
              className="border-border flex flex-col gap-3 rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-medium">
                    {productName.get(String(thread.productId ?? "")) ?? "A product"}
                  </span>
                  <span className="text-subtle font-mono text-[11px]">
                    {vendorName.get(String(thread.vendorId ?? "")) ?? "Unknown vendor"} · raised
                    by the {dispute.raisedByType} · {formatDateTime(dispute.raisedAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={dispute.status} />
                  <span className="text-subtle font-mono text-[10.5px] tracking-[0.14em] uppercase">
                    {dispute.reason.replace(/_/g, " ")}
                  </span>
                </span>
              </div>

              {/* The claim, verbatim and escaped. Both parties' words appear on this screen. */}
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
                {dispute.detail}
              </p>

              <FullThread
                organizationId={String(thread.organizationId)}
                entitlementId={String(thread.subjectId)}
              />

              <ResolvePanel conversationId={String(thread._id)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Everything said, at every visibility.
 *
 * This is the only audience that sees all three, and a resolver deciding without the vendor's note
 * to us would be deciding on half the record.
 */
async function FullThread({
  organizationId,
  entitlementId,
}: {
  organizationId: string;
  entitlementId: string;
}) {
  const messages = await staffThread({
    organizationId,
    subjectType: "vendor_support",
    subjectId: entitlementId,
    viewerUserId: "",
  });

  if (messages.length === 0) return null;

  return (
    <ul className="divide-border divide-y text-[13px]">
      {messages.map((message) => (
        <li key={message.id} className="flex flex-col gap-1 py-2">
          <span className="text-subtle font-mono text-[11px]">
            {message.senderName ?? message.senderType} ·{" "}
            {message.at.slice(0, 16).replace("T", " ")}
            {message.visibility !== "customer" && ` · ${message.visibility} only`}
          </span>
          <span className="whitespace-pre-wrap">{message.body}</span>
        </li>
      ))}
    </ul>
  );
}

function Header() {
  return (
    <PageHeader
      title="Disputes"
      description="Both parties are waiting on us. Oldest first — a decision needs an outcome and a reason, and both sides read the reason."
    />
  );
}
