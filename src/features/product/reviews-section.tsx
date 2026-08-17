import { cache } from "react";
import { MessageSquareOff } from "lucide-react";
import { RatingDistribution, StarRating } from "@/components/star-rating";
import type { ProductDetail } from "@/services/marketplace/detail";
import { listForProduct } from "@/services/reviews/review-service";
import { ReviewList } from "@/features/reviews/components/review-list";

/**
 * Reviews on the product page — vendor ticket 10.
 *
 * ## Not inside the cached detail read
 *
 * `getProductDetail` is a `"use cache"` read tagged with the product's slug. Reviews are
 * loaded here instead, in a `<Suspense>`d Server Component, for two reasons: a review write
 * would otherwise have to invalidate the whole product page cache to change one list, and the
 * aggregate a buyer scans (stars, count, distribution) *is* in that cached read because it
 * lives on the product document. Fast path cached, long list streamed.
 *
 * ## Purchase-gating shows up as an absence
 *
 * There is no "write a review" button here for anybody. A review is written from **My
 * Software**, because that is the only place the platform knows you own the thing — and a
 * button that leads to "you cannot review this" is worse than no button. The empty state says
 * where reviews come from, which doubles as the explanation of why they are trustworthy.
 */

/**
 * One query per request, shared by the visible list and the structured data.
 *
 * React's `cache()` rather than trusting the two call sites not to duplicate: the JSON-LD sits
 * at the top of the page and the list near the bottom, so they cannot share a variable, and
 * without this a product page would run the same indexed query twice for the same rows.
 */
const loadReviews = cache((productId: string) => listForProduct(productId, { limit: 20 }));

export async function ReviewsSection({ product }: { product: ProductDetail }) {
  const reviews = await loadReviews(product.id);

  return (
    <section id="reviews" className="flex flex-col gap-5">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">What buyers say</h2>

      {product.rating ? (
        <div className="border-border grid gap-5 rounded-xl border p-5 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-1">
            <span className="font-display text-[34px] leading-none tracking-[-0.03em]">
              {product.rating.average.toFixed(1)}
            </span>
            <StarRating average={product.rating.average} />
            <span className="text-subtle text-[12px]">
              {product.rating.count} {product.rating.count === 1 ? "review" : "reviews"}, all
              from verified purchases
            </span>
          </div>
          <RatingDistribution
            distribution={product.rating.distribution}
            count={product.rating.count}
          />
        </div>
      ) : (
        <div className="border-border text-muted-foreground flex items-start gap-2.5 rounded-xl border p-5 text-[13.5px]">
          <MessageSquareOff className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            No reviews yet. Only customers who have bought this can review it, so the first one
            arrives after somebody has used it.
          </span>
        </div>
      )}

      <ReviewList
        reviews={reviews}
        {...(product.versions.find((version) => version.isCurrent)?.version
          ? { currentVersion: product.versions.find((version) => version.isCurrent)!.version }
          : {})}
      />
    </section>
  );
}

/**
 * The same reviews, for the JSON-LD.
 *
 * A separate export because the structured data sits at the top of the page and the visible
 * list near the bottom, so they cannot share a variable. `loadReviews` is `cache()`d, so this
 * is the same rows the list renders and the same single query.
 *
 * Five at most: the aggregate is what a search engine uses, and forty serialised reviews in a
 * script tag is page weight for nothing.
 */
export async function reviewsForJsonLd(productId: string) {
  const reviews = (await loadReviews(productId)).slice(0, 5);
  return reviews.map((review) => ({
    rating: review.rating,
    authorName: review.authorName,
    body: review.body,
    ...(review.title ? { title: review.title } : {}),
    createdAt: review.createdAt,
  }));
}
