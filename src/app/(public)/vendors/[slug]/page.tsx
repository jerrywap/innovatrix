import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BadgeCheck, ExternalLink, Globe } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { BreadcrumbJsonLd, type Crumb } from "@/components/json-ld";
import { serverEnv } from "@/config/env";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { formatDay } from "@/lib/dates";
import { pageMetadata } from "@/lib/seo";
import { getVendorProfile, type VendorProfile } from "@/services/marketplace/storefront";
import { searchMarketplace } from "@/services/marketplace";
import { MAX_LIMIT } from "@/services/marketplace/pipeline";
import { ProductCardTile } from "@/features/marketplace/components/product-card";

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
    title: `${vendor.displayName} on Innovatrix`,
    description:
      vendor.summary ??
      `Software from ${vendor.displayName}, sold and supported on Innovatrix.`,
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

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          {storefront.logoUrl && (
            <div className="border-border bg-surface relative size-16 shrink-0 overflow-hidden rounded-xl border">
              <Image
                src={storefront.logoUrl}
                alt={`${storefront.displayName} logo`}
                fill
                sizes="64px"
                className="object-contain"
              />
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.03em]">
              {storefront.displayName}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
              {/* Worded as identity verification and nothing more. "Verified vendor" would
                  imply we have checked their software, which we have not. */}
              {storefront.identityVerified && (
                <span className="flex items-center gap-1.5 text-[var(--signal)]">
                  <BadgeCheck className="size-4" aria-hidden />
                  Identity verified by Innovatrix
                </span>
              )}
              <span className="text-subtle flex items-center gap-1.5">
                <Globe className="size-3.5" aria-hidden />
                {storefront.country}
              </span>
              {storefront.sellingSince && (
                <span className="text-subtle">
                  Selling here since {formatDay(storefront.sellingSince)}
                </span>
              )}
              <span className="text-subtle">
                {storefront.productCount}{" "}
                {storefront.productCount === 1 ? "product" : "products"}
              </span>
            </div>

            {/* Nothing at all where there are no reviews — `StarRating` returns null for a
                null average, so an unreviewed vendor is not framed as a zero-star one. */}
            {storefront.rating && (
              <StarRating average={storefront.rating.average} count={storefront.rating.count} />
            )}
          </div>
        </div>

        {storefront.summary && (
          <p className="text-muted-foreground max-w-[68ch] text-[15px] leading-relaxed">
            {storefront.summary}
          </p>
        )}

        {storefront.websiteUrl && (
          <a
            href={storefront.websiteUrl}
            // `nofollow noopener` on a vendor-supplied URL: this page is indexable, and
            // passing ranking to a link a vendor typed is how a storefront becomes an SEO
            // product. `noreferrer` keeps our URLs out of their logs.
            rel="nofollow noopener noreferrer"
            target="_blank"
            className="flex w-fit items-center gap-1.5 text-[13px] underline underline-offset-4"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {new URL(storefront.websiteUrl).host}
          </a>
        )}
      </header>

      <section className="mt-10 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[19px] tracking-[-0.02em]">
            What {storefront.displayName} sells
          </h2>
          {/*
            The vendor filter, reachable from here — vendor ticket 11's "works from a chip and
            from the URL". This is where a vendor filter is *discovered*: the marketplace rail
            has no list of sellers (it would grow without bound), so following one from a
            storefront is the path, and the rail's chip is the way back out.
          */}
          <Link
            href={`/marketplace?vendor=${storefront.slug}` as never}
            className="text-muted-foreground hover:text-foreground text-[12.5px] underline underline-offset-4"
          >
            See these alongside everything else
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listing.products.map((card) => (
            <ProductCardTile key={card.id} card={card} />
          ))}
        </div>
      </section>
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
 * Innovatrix and is unchanged. This one describes the seller, and it is the node a product's
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
