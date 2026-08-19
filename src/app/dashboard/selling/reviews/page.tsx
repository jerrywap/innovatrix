import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StarRating } from "@/components/star-rating";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/lib/dates";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { averageRating, listForVendor } from "@/services/reviews/review-service";
import { Vendor } from "@/lib/db/models/vendors";
import { VendorReviewPanel } from "@/features/reviews/components/vendor-review-panel";

export const metadata: Metadata = { title: "Reviews" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * What customers said, and the vendor's chance to answer — vendor ticket 10.
 *
 * Readable and answerable by **any** active member, not only the owner. Replying to a review is
 * support work, which is exactly what a member is invited to help with; what the two-role model
 * protects is the payout account.
 *
 * ## The vendor's own rating is shown, and cannot be touched
 *
 * It is derived from these reviews and stored as a sum and a count that only
 * `recomputeVendorRating` writes. There is no action that adjusts it, for anybody, including
 * staff — a vendor rating somebody can edit is a vendor rating nobody should believe, and
 * saying so on the screen is part of it meaning anything.
 *
 * Hidden reviews appear here, marked. A vendor who cannot see that a review was hidden would
 * keep asking us about a review the public can no longer read.
 */
export default async function Page() {
  const { vendorId } = await requireVendorOrForbid();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="What your customers said. You can reply publicly, and report anything that breaks the rules."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Reviews vendorId={vendorId} />
      </Suspense>
    </div>
  );
}

async function Reviews({ vendorId }: { vendorId: string }) {
  const [reviews, vendor] = await Promise.all([
    listForVendor(vendorId),
    Vendor.findById(vendorId)
      .select({ ratingSum: 1, ratingCount: 1 })
      .lean<{ ratingSum?: number; ratingCount?: number }>(),
  ]);

  const average = averageRating(vendor?.ratingSum, vendor?.ratingCount);

  return (
    <div className="flex flex-col gap-6">
      <div className="border-border bg-surface-muted/40 flex flex-col gap-1.5 rounded-xl border p-5">
        <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Your rating
        </h2>
        {average === null ? (
          <p className="text-[13.5px]">
            Nobody has reviewed your products yet. Your rating appears here once somebody does.
          </p>
        ) : (
          <>
            <StarRating average={average} count={vendor?.ratingCount ?? 0} />
            <p className="text-muted-foreground text-[12.5px]">
              The average across every published review of everything you sell. It is worked out
              from the reviews themselves — nobody can adjust it, including us.
            </p>
          </>
        )}
      </div>

      {reviews.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No reviews yet"
          description="Only customers who have bought a product can review it, so the first ones arrive after people have used what you sell."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="border-border flex flex-col gap-2.5 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StarRating average={review.rating} />
                <span className="flex items-center gap-2">
                  {/* Hidden is worth saying plainly. A vendor left guessing why a review
                      vanished from their product page will ask, and the answer is here. */}
                  {review.status !== "published" && <StatusBadge status={review.status} />}
                  <span className="text-subtle font-mono text-[11px]">
                    {review.authorName} · {formatDay(review.createdAt)}
                    {review.editedAt && " · edited"}
                  </span>
                </span>
              </div>

              {review.title && <p className="text-[14px] font-medium">{review.title}</p>}
              {/* Escaped by React. This is customer-written text on a vendor's screen. */}
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{review.body}</p>

              {review.versionAtReview && (
                <p className="text-subtle text-[11.5px]">On v{review.versionAtReview}</p>
              )}

              {review.vendorResponse && (
                <div className="border-border bg-surface-muted/40 rounded-lg border p-3">
                  <p className="text-subtle font-mono text-[10.5px] tracking-[0.14em] uppercase">
                    Your reply
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">
                    {review.vendorResponse.body}
                  </p>
                </div>
              )}

              <VendorReviewPanel
                reviewId={review.id}
                {...(review.vendorResponse
                  ? { existingResponse: review.vendorResponse.body }
                  : {})}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
