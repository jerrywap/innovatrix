import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StarRating } from "@/components/star-rating";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { Product } from "@/lib/db/models/catalog";
import { listReported, reportsFor } from "@/services/reviews/review-service";
import { ModerationPanel } from "@/features/reviews/components/moderation-panel";
import { productHref } from "@/config/catalogue";

export const metadata: Metadata = { title: "Reported reviews" };

// TODO: Cache Components adoption. Refactor this route so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The moderation queue — vendor ticket 10.
 *
 * ## Only reported reviews, most-reported first
 *
 * Not every review. A queue of everything customers write is a queue nobody works, and
 * pre-moderation was rejected in the ticket (decision **V7**) precisely because it puts a staff
 * member between every customer and their opinion. Reports are the signal that something needs
 * a person.
 *
 * ## The reports are shown, with who made them
 *
 * Three reports from three customers and three from one vendor's team are very different
 * situations, and a bare count cannot tell them apart. The reasons and the reporters are on the
 * row, so a brigading campaign looks like one.
 *
 * No `loading.tsx` under this route: `requirePermissionOrForbid` refuses, and a boundary above a
 * refusing page flushes the shell before the refusal is decided, committing `200 OK`.
 */
export default async function Page() {
  await requirePermissionOrForbid("review.moderate");

  const reviews = await listReported();

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <EmptyState
          icon={ShieldCheck}
          title="Nothing reported"
          description="Reviews are published as they are written and appear here only when somebody reports one."
        />
      </div>
    );
  }

  // One query for the product names and slugs rather than one per row.
  const productIds = [...new Set(reviews.map((review) => String(review.productId)))];
  const products = await Product.find({ _id: { $in: productIds } })
    .select({ name: 1, slug: 1 })
    .lean<Array<{ _id: unknown; name: string; slug: string }>>();
  const productById = new Map(products.map((product) => [String(product._id), product]));

  const reports = await Promise.all(
    reviews.map(async (review) => ({
      reviewId: String(review._id),
      rows: await reportsFor(String(review._id)),
    })),
  );
  const reportsByReview = new Map(reports.map((entry) => [entry.reviewId, entry.rows]));

  return (
    <div className="flex flex-col gap-6">
      <Header />

      <ul className="flex flex-col gap-4">
        {reviews.map((review) => {
          const product = productById.get(String(review.productId));
          const rows = reportsByReview.get(String(review._id)) ?? [];

          return (
            <li
              key={String(review._id)}
              className="border-border flex flex-col gap-3 rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-1">
                  {product ? (
                    <Link
                      href={`${productHref(product.slug)}#reviews` as Route}
                      className="text-[14px] underline underline-offset-4"
                    >
                      {product.name}
                    </Link>
                  ) : (
                    <span className="text-[14px]">Unknown product</span>
                  )}
                  <StarRating average={review.rating} />
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={review.status} />
                  <span className="text-subtle font-mono text-[11px]">
                    {review.reportCount} {review.reportCount === 1 ? "report" : "reports"}
                  </span>
                </span>
              </div>

              {review.title && <p className="text-[14px] font-medium">{review.title}</p>}
              {/* Escaped. This is the most attacker-controlled text in the platform. */}
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{review.body}</p>

              <p className="text-subtle font-mono text-[11px]">
                {formatDateTime(review.createdAt)}
                {review.versionAtReview && ` · on v${review.versionAtReview}`}
                {review.editedAt && " · edited"}
              </p>

              {review.moderationReason && (
                <p className="text-[12.5px]">
                  <span className="text-subtle">Previously: </span>
                  {review.moderationReason}
                </p>
              )}

              {rows.length > 0 && (
                <div className="border-border rounded-lg border p-3">
                  <h3 className="text-subtle mb-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
                    Why it was reported
                  </h3>
                  <ul className="divide-border divide-y text-[12.5px]">
                    {rows.map((report) => (
                      <li key={String(report._id)} className="flex flex-col gap-0.5 py-1.5">
                        <span>
                          {report.reason.replace("_", " ")}
                          {/* Whether it was the seller matters: a vendor reporting criticism of
                              their own product is a different signal from a customer doing it. */}
                          {report.reportedByVendorId && (
                            <span className="text-subtle"> · from the seller</span>
                          )}
                        </span>
                        {report.detail && (
                          <span className="text-muted-foreground">{report.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ModerationPanel reviewId={String(review._id)} status={review.status} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="Reported reviews"
      description="Reviews somebody asked us to look at. Hiding is reversible; removing is for a policy breach."
    />
  );
}
