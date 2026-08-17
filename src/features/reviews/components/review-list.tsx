import { MessageSquare, Pencil } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { formatDay } from "@/lib/dates";
import type { ReviewView } from "@/services/reviews/review-service";

/**
 * Published reviews, as a buyer reads them — vendor ticket 10.
 *
 * A Server Component. Every string here is **attacker-controlled text on a page the platform
 * wants indexed**, and it is rendered as JSX children — React escapes it, so a `<script>` in a
 * review body is text and not markup. There is no `dangerouslySetInnerHTML` on this path and
 * there must never be one: the review body is deliberately plain text rather than the
 * ProseMirror document a product description uses, precisely so that question does not arise.
 *
 * ## Three things next to each review, and each earns its place
 *
 * - **The version they used.** A two-star review of a version fixed a year ago is information
 *   about the past, and saying which version turns it from a warning into a fact.
 * - **"Edited".** A review rewritten after a vendor replied would otherwise make the reply
 *   look unhinged.
 * - **The vendor's response**, inline and clearly attributed. A seller's answer to a bad
 *   review is often more useful to the next buyer than the review.
 */
export function ReviewList({
  reviews,
  currentVersion,
}: {
  reviews: readonly ReviewView[];
  /** Used to mark a review of an older version, where we know the current one. */
  currentVersion?: string;
}) {
  if (reviews.length === 0) return null;

  return (
    <ul className="flex flex-col gap-4">
      {reviews.map((review) => {
        const stale = Boolean(
          currentVersion && review.versionAtReview && review.versionAtReview !== currentVersion,
        );

        return (
          <li
            key={review.id}
            className="border-border flex flex-col gap-2 rounded-xl border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StarRating average={review.rating} />
              <span className="text-subtle font-mono text-[11px]">
                {review.authorName} · {formatDay(review.createdAt)}
                {review.editedAt && " · edited"}
              </span>
            </div>

            {review.title && <p className="text-[14px] font-medium">{review.title}</p>}

            {/* Plain text, escaped by React, with newlines preserved. */}
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{review.body}</p>

            {review.versionAtReview && (
              <p className="text-subtle text-[11.5px]">
                Reviewed on v{review.versionAtReview}
                {stale && " — a later version is available"}
              </p>
            )}

            {review.vendorResponse && (
              <div className="border-border bg-surface-muted/40 mt-1 flex flex-col gap-1 rounded-lg border p-3">
                <p className="text-subtle flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase">
                  <MessageSquare className="size-3" aria-hidden />
                  Response from the seller
                  {review.vendorResponse.editedAt && (
                    <>
                      <Pencil className="size-3" aria-hidden />
                      <span className="sr-only">Edited</span>
                    </>
                  )}
                </p>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                  {review.vendorResponse.body}
                </p>
                <p className="text-subtle font-mono text-[11px]">
                  {formatDay(review.vendorResponse.at)}
                  {review.vendorResponse.editedAt &&
                    ` · edited ${formatDay(review.vendorResponse.editedAt)}`}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
