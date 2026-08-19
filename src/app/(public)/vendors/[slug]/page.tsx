import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreadcrumbJsonLd, type Crumb } from "@/components/json-ld";
import { serverEnv } from "@/config/env";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { pageMetadata } from "@/lib/seo";
import { getVendorProfile, type VendorProfile } from "@/services/marketplace/storefront";
import { searchMarketplace } from "@/services/marketplace";
import { MAX_LIMIT } from "@/services/marketplace/pipeline";
import { StorefrontBody } from "@/features/storefront/components/storefront-body";

/**
 * A vendor's public storefront — vendor ticket 11.
 *
 * ## Plural, and not a sibling of the workspace
 *
 * `/vendors/[slug]` is public and indexable; the vendor's own workspace is `/dashboard/selling`.
 * The two differ by more than a character on purpose — an earlier draft put the workspace at
 * `/vendor`, one letter from this, which is a hazard for whoever writes the next link and would
 * have needed its own `robots.ts` disallow. Nesting the workspace under `/dashboard` means the
 * existing authenticated-area disallow already covers it and this route needs no rule at all.
 *
 * ## What is on it, and what is deliberately absent
 *
 * Who they are, how long they have been selling, what they have published, and what customers
 * rated them. **No** sales volume, revenue or payout status: that is the vendor's commercial
 * information and a buyer has no claim on it.
 *
 * ## Why a 404 rather than an "unavailable" page
 *
 * A storefront exists only for a verified vendor with at least one published product.
 * `getStorefront` returns `null` for all three failure modes — no such vendor, not verified,
 * nothing published — and the caller cannot tell which. The reasons a vendor is absent are
 * between us and them, and an "this vendor is suspended" page would publish a decision the
 * vendor never agreed to us publishing.
 *
 * The vendor themselves is not left staring at that 404: `/dashboard/selling/storefront` renders
 * the same `StorefrontBody` from behind their own guard, whatever state they are in. This route
 * stays public, indexable and strict.
 */
export async function generateMetadata({
  params,
}: PageProps<"/vendors/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const vendor = await getVendorProfile(slug);

  // The same "not found" metadata a missing product page produces. Nothing here confirms
  // whether the slug ever existed.
  if (!vendor) return { title: "Not found" };

  return pageMetadata({
    title: `${vendor.displayName} on CoSetup`,
    description:
      vendor.summary ?? `Software from ${vendor.displayName}, sold and supported on CoSetup.`,
    path: `/vendors/${slug}`,
    type: "website",
  });
}

export default async function Page({ params }: PageProps<"/vendors/[slug]">) {
  const { slug } = await params;

  /*
   * Two reads, both cached, and the grid comes from the marketplace pipeline.
   *
   * A card's price is computed by that pipeline rather than stored, so building the grid here
   * with a plain query would render products with no prices and error nowhere. Using
   * `searchMarketplace` also means the storefront's cards, the listing's cards and the rails'
   * cards are the same shape by construction.
   */
  const [vendor, listing] = await Promise.all([
    getVendorProfile(slug),
    searchMarketplace({
      vendor: [slug],
      currency: DEFAULT_CURRENCY,
      sort: "latest",
      page: 1,
      limit: MAX_LIMIT,
    }),
  ]);

  // Both halves of the eligibility rule: verified vendor, and something published. `total`
  // answers the second, so there is no second count query.
  if (!vendor || listing.total === 0) notFound();

  const storefront = { ...vendor, productCount: listing.total };
  const origin = serverEnv().APP_URL.replace(/\/$/, "");

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-10 lg:px-10 lg:py-14">
      {/*
        Both structured-data nodes are derived from the same values the page renders — the
        breadcrumb from the same array as the visible one. A `BreadcrumbList` that disagrees
        with the visible breadcrumb is a structured-data policy violation, not an untidiness.
      */}
      <VendorJsonLd storefront={storefront} origin={origin} />
      <BreadcrumbJsonLd crumbs={crumbsFor(storefront)} origin={origin} />

      <nav
        aria-label="Breadcrumb"
        className="text-subtle mb-6 flex flex-wrap gap-1.5 text-[12px]"
      >
        {crumbsFor(storefront).map((crumb, index, all) => (
          <span key={crumb.path} className="flex items-center gap-1.5">
            {index < all.length - 1 ? (
              <Link href={crumb.path as never} className="hover:text-foreground">
                {crumb.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">{crumb.name}</span>
            )}
            {index < all.length - 1 && <span aria-hidden>/</span>}
          </span>
        ))}
      </nav>

      <StorefrontBody
        vendor={vendor}
        products={listing.products}
        productCount={listing.total}
      />
    </div>
  );
}

/** One array, two consumers — the visible breadcrumb and the `BreadcrumbList`. */
function crumbsFor(storefront: VendorProfile): Crumb[] {
  return [
    { name: "Marketplace", path: "/marketplace" },
    { name: storefront.displayName, path: `/vendors/${storefront.slug}` },
  ];
}

/**
 * The vendor as an `Organization`.
 *
 * Distinct from the site-wide `Organization` node in the public layout, which describes
 * CoSetup and is unchanged. This one describes the seller, and it is the node a product's
 * `seller` reference is consistent with.
 *
 * `dangerouslySetInnerHTML` for the same reason `ProductJsonLd` needs it: a `<script>`'s
 * contents cannot be set by React children, and an escaped quote inside
 * `application/ld+json` is invalid JSON that Google silently drops. The input is a typed object
 * through `JSON.stringify`, with `<` escaped so a `</script>` in a vendor's name cannot end the
 * block early.
 */
function VendorJsonLd({ storefront, origin }: { storefront: VendorProfile; origin: string }) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: storefront.displayName,
    url: `${origin}/vendors/${storefront.slug}`,
    ...(storefront.summary ? { description: storefront.summary } : {}),
    ...(storefront.logoUrl ? { logo: storefront.logoUrl } : {}),
    ...(storefront.websiteUrl ? { sameAs: [storefront.websiteUrl] } : {}),
    address: { "@type": "PostalAddress", addressCountry: storefront.country },
    // Only where reviews exist. Emitting a rating for a vendor nobody has reviewed is the
    // fabrication ticket 27 refused to ship, and it carries a manual action.
    ...(storefront.rating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: storefront.rating.average,
            reviewCount: storefront.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
