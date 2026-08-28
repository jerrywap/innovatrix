import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import { CACHE_PROFILE, CATALOG_TAG, vendorTag } from "@/services/catalog/cache";
import { averageRating } from "@/services/reviews/review-service";
import {
  platformStorefrontDefaults,
  resolveStorefrontVisibility,
} from "@/services/vendors/storefront-visibility";

/**
 * The public vendor storefront — vendor ticket 11.
 *
 * A customer choosing between two third-party products needs somewhere to ask "who made this,
 * and what else have they made". Without it the marketplace is a catalogue of orphaned
 * artefacts, and the `seller` in every product's structured data is a lie the moment a vendor
 * product is published.
 *
 * ## This module is the *vendor*, not the grid
 *
 * The products on a storefront come from `searchMarketplace({ vendor: [slug] })` — the existing
 * pipeline, which the vendor facet from ticket 04 already supports. That is not laziness: the
 * price a card shows is **computed** by that pipeline (`activePrice` and `hasPrice`, in an
 * `$addFields`) and is not a stored field. A hand-rolled `find()` here — which is what the first
 * version of this file did — renders a grid of products with no prices, and nothing errors.
 *
 * One pipeline, one card shape, no drift. Eligibility ("at least one published product") is then
 * that search's `total`, so the question is asked once rather than twice.
 *
 * ## What is deliberately *not* here
 *
 * No sales volume, no revenue, no payout status, no verification *level* beyond the identity
 * badge, and no submission history. Those are the vendor's commercial and operational
 * information; a customer has no claim on them, and publishing them would make a storefront a
 * disclosure a vendor never agreed to.
 */

export interface VendorProfile {
  slug: string;
  displayName: string;
  summary?: string;
  websiteUrl?: string;
  logoUrl?: string;
  /** The storefront's cover band. Absent ⇒ the page draws its own. */
  coverUrl?: string;
  /**
   * Optional, because staff can switch `location` off.
   *
   * It was required, and making it optional is the honest consequence of that:
   * a country that may be withheld cannot be typed as always present, and the
   * `Organization` JSON-LD's `address` has to follow it rather than emit a
   * `PostalAddress` with nothing in it.
   */
  country?: string;
  /** Identity verification, and nothing more — vendor ticket 02's wording. */
  identityVerified: boolean;
  /** When they were verified, so "selling since" is a fact rather than an approximation. */
  sellingSince?: Date;
  /** `null` where there are no reviews. An empty five-star frame reads as zero. */
  rating: { average: number; count: number } | null;
}

/**
 * The vendor behind a storefront, or `null`.
 *
 * `null` for a vendor who does not exist, is not `verified`, or is deleted — and the caller
 * cannot tell which. That is deliberate: the reasons a vendor is absent are between us and them,
 * and a "this vendor is suspended" page would publish a decision they never agreed to us
 * publishing.
 *
 * Tagged with its own tag **and** `CATALOG_TAG`: a profile edit or a verification decision
 * invalidates one vendor (`vendorChanged`), and a publish invalidates the catalogue, which this
 * page needs because it lists products.
 */
export async function getVendorProfile(slug: string): Promise<VendorProfile | null> {
  "use cache";
  cacheTag(CATALOG_TAG, vendorTag(slug));
  cacheLife(CACHE_PROFILE.product);

  return loadVendorProfile(slug);
}

/**
 * The same thing, uncached.
 *
 * A `"use cache"` function cannot be called from a test — `cacheTag()` throws without the
 * `cacheComponents` config, which is why nothing else in this directory has an integration test
 * against a cached reader. Splitting the caching from the query is what makes the *rules* here
 * testable: who gets a storefront, and what it must never carry. The wrapper above is
 * deliberately thin, so there is no logic on the cached side the tests cannot reach.
 */
export async function loadVendorProfile(slug: string): Promise<VendorProfile | null> {
  await connectToDatabase();

  /*
   * Two reads, in parallel, and the second is the one worth explaining.
   *
   * Storefront visibility is resolved **here** rather than in the component, so
   * the public page and the vendor's own preview cannot disagree — they call
   * different wrappers around this function, and a rule applied in the view
   * would have to be applied twice. Doing it here also means a hidden field is
   * *absent* rather than flagged, so `VendorJsonLd` stops emitting it without a
   * line of its own: a structured-data node advertising a link the page does not
   * show is a mismatch, not an untidiness.
   */
  const [vendor, platform] = await Promise.all([
    Vendor.findOne({ slug, status: "verified", deletedAt: null })
      .select({
        slug: 1,
        displayName: 1,
        country: 1,
        profile: 1,
        storefrontVisibility: 1,
        verification: 1,
        verifiedAt: 1,
        ratingSum: 1,
        ratingCount: 1,
      })
      .lean<VendorDoc>(),
    platformStorefrontDefaults(),
  ]);

  if (!vendor) return null;

  const rating = averageRating(vendor.ratingSum, vendor.ratingCount);
  const shows = resolveStorefrontVisibility(vendor, platform);

  return {
    slug: vendor.slug,
    displayName: vendor.displayName,
    ...(shows.summary && vendor.profile?.summary ? { summary: vendor.profile.summary } : {}),
    ...(shows.website && vendor.profile?.websiteUrl
      ? { websiteUrl: vendor.profile.websiteUrl }
      : {}),
    ...(shows.logo && vendor.profile?.logoUrl ? { logoUrl: vendor.profile.logoUrl } : {}),
    ...(shows.cover && vendor.profile?.coverUrl ? { coverUrl: vendor.profile.coverUrl } : {}),
    ...(shows.location ? { country: vendor.country } : {}),
    // The identity level only. "Business verified" is about whether we may send them money,
    // which is none of a buyer's business and would read as a stronger claim than it is.
    identityVerified: vendor.verification.identity.status === "approved",
    ...(vendor.verifiedAt ? { sellingSince: vendor.verifiedAt } : {}),
    rating: rating === null ? null : { average: rating, count: vendor.ratingCount ?? 0 },
  };
}

/**
 * Slugs for the sitemap — verified vendors with at least one published product.
 *
 * The same two conditions the page applies, and they have to be the same: a sitemap listing a
 * URL that 404s is a contradiction a crawler resolves by trusting neither — the failure
 * `sitemap.test.ts` was written after `/about` and `/contact` were advertised for weeks.
 *
 * One aggregation rather than a query per vendor, because this file is fetched by crawlers.
 */
export async function storefrontSlugs(limit = 2_000): Promise<Array<{ slug: string }>> {
  await connectToDatabase();

  return Product.aggregate<{ slug: string }>([
    { $match: { status: "published", deletedAt: null, vendorSlug: { $exists: true } } },
    { $group: { _id: "$vendorSlug" } },
    // A published product carries a denormalised `vendorSlug`, but only a *verified* vendor gets
    // a page — so the status is confirmed against `vendors` rather than inferred from the
    // product. A suspended vendor's still-published products are vendor ticket 12's problem.
    {
      $lookup: {
        from: "vendors",
        localField: "_id",
        foreignField: "slug",
        as: "vendor",
        pipeline: [
          { $match: { status: "verified", deletedAt: null } },
          { $project: { _id: 1 } },
        ],
      },
    },
    { $match: { "vendor.0": { $exists: true } } },
    { $project: { _id: 0, slug: "$_id" } },
    { $limit: limit },
  ]);
}

/**
 * Slug → display name, for the marketplace's active-filter chip.
 *
 * A vendor is **not** a taxonomy, so `TaxonomyIndex` cannot resolve it and the filter rail has no
 * name to draw. This is the smallest thing that fixes it: one query for the slugs actually in the
 * URL, rather than a "Sellers" section listing every vendor on the platform — which would be a
 * rail that grows without bound and a query on every marketplace render.
 *
 * Discovery of a vendor filter therefore happens by *following* a vendor, from a card or a
 * storefront. What the chip provides is the way back out of a filtered view.
 */
export async function vendorNames(slugs: readonly string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();

  await connectToDatabase();
  const rows = await Vendor.find({ slug: { $in: slugs.slice(0, 20) } })
    .select({ slug: 1, displayName: 1 })
    .lean<Array<{ slug: string; displayName: string }>>();

  return new Map(rows.map((row) => [row.slug, row.displayName]));
}
