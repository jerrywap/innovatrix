import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { BadgeCheck, ExternalLink, Globe } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { formatDay } from "@/lib/dates";
import type { ProductCard } from "@/services/marketplace";
import type { VendorProfile } from "@/services/marketplace/storefront";
import { ProductCardTile } from "@/features/marketplace/components/product-card";

/**
 * What a storefront looks like — vendor ticket 11, extracted for the preview.
 *
 * ## Why it moved out of the page
 *
 * `/vendors/[slug]` answers **404** for a verified vendor with nothing published, and that is
 * deliberate: an empty storefront in the index is a thin page, and a site full of them costs every
 * other page a little ranking. But it left the vendor with no way to see their own — the "View your
 * storefront" button on their dashboard led to that 404, which reads as their storefront being
 * broken rather than as not being live yet.
 *
 * So the presentation lives here and two routes use it: the public page, and a preview under
 * `/dashboard/selling` that a vendor can always open. One component, so the preview cannot drift
 * from the thing it is previewing — which is the only way a preview is worth having.
 *
 * The **structured data stays on the public page**. A preview must not emit an `Organization` node
 * or a `BreadcrumbList`: it lives behind the authenticated-area disallow, and JSON-LD on a page
 * crawlers cannot reach is at best noise.
 */
export function StorefrontBody({
  vendor,
  products,
  productCount,
  /** Rendered above the header, for the preview. */
  notice,
}: {
  vendor: VendorProfile;
  products: readonly ProductCard[];
  productCount: number;
  notice?: React.ReactNode;
}) {
  return (
    <>
      {notice}

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          {vendor.logoUrl && (
            <div className="border-border bg-surface relative size-16 shrink-0 overflow-hidden rounded-xl border">
              <Image
                src={vendor.logoUrl}
                alt={`${vendor.displayName} logo`}
                fill
                sizes="64px"
                className="object-contain"
              />
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.03em]">
              {vendor.displayName}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
              {/* Worded as identity verification and nothing more. "Verified vendor" would imply
                  we have checked their software, which we have not. */}
              {vendor.identityVerified && (
                <span className="flex items-center gap-1.5 text-[var(--signal)]">
                  <BadgeCheck className="size-4" aria-hidden />
                  Identity verified by Innovatrix
                </span>
              )}
              <span className="text-subtle flex items-center gap-1.5">
                <Globe className="size-3.5" aria-hidden />
                {vendor.country}
              </span>
              {vendor.sellingSince && (
                <span className="text-subtle">
                  Selling here since {formatDay(vendor.sellingSince)}
                </span>
              )}
              <span className="text-subtle">
                {productCount} {productCount === 1 ? "product" : "products"}
              </span>
            </div>

            {/* Nothing at all where there are no reviews — `StarRating` returns null for a null
                average, so an unreviewed vendor is not framed as a zero-star one. */}
            {vendor.rating && (
              <StarRating average={vendor.rating.average} count={vendor.rating.count} />
            )}
          </div>
        </div>

        {vendor.summary && (
          <p className="text-muted-foreground max-w-[68ch] text-[15px] leading-relaxed">
            {vendor.summary}
          </p>
        )}

        {vendor.websiteUrl && (
          <a
            href={vendor.websiteUrl}
            // `nofollow noopener` on a vendor-supplied URL: the public page is indexable, and
            // passing ranking to a link a vendor typed is how a storefront becomes an SEO product.
            // `noreferrer` keeps our URLs out of their logs.
            rel="nofollow noopener noreferrer"
            target="_blank"
            className="flex w-fit items-center gap-1.5 text-[13px] underline underline-offset-4"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {new URL(vendor.websiteUrl).host}
          </a>
        )}
      </header>

      <section className="mt-10 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[19px] tracking-[-0.02em]">
            What {vendor.displayName} sells
          </h2>
          {products.length > 0 && (
            <Link
              href={`/marketplace?vendor=${vendor.slug}` as Route}
              className="text-muted-foreground hover:text-foreground text-[12.5px] underline underline-offset-4"
            >
              See these alongside everything else
            </Link>
          )}
        </div>

        {products.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-[13.5px]">
            Nothing published yet. A product appears here as soon as it goes on sale — drafts
            and products still in review are not shown to customers.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((card) => (
              <ProductCardTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
