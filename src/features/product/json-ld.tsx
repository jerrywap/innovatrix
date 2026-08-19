import { formatPlain } from "@/lib/money";
import type { StorefrontCurrency } from "@/config/storefront";
import type { ProductDetail } from "@/services/marketplace/detail";

/**
 * `Product` + `Offer` structured data — §93.
 *
 * ## The one sanctioned `dangerouslySetInnerHTML` on a public page
 *
 * `rich-text.tsx` records that as a review finding, so this needs its reason
 * stated rather than assumed. There is no alternative: a `<script>` element's
 * contents cannot be set by React children — JSX escapes them, and an escaped
 * `&quot;` inside `application/ld+json` is invalid JSON that Google silently
 * drops.
 *
 * The input is a **typed object**, never a string, and goes through
 * `JSON.stringify`. The one remaining injection vector is `</script>` appearing
 * inside a product name or description, which `escapeForScript` handles.
 *
 * Raised for ticket 26 as a named allowlist entry rather than as an argument at
 * review time.
 *
 * ## `AggregateRating`, now that there is something to aggregate
 *
 * Ticket 27 omitted it: "there are no reviews in the MVP; emitting a fabricated rating is a
 * structured-data policy violation with a manual-action penalty attached". That reasoning
 * expired with vendor ticket 10, and the *rule* it protected has not changed — the block is
 * emitted **only** where real published reviews exist. A product with none emits neither
 * `aggregateRating` nor `review`, which is the same policy now satisfiable rather than a
 * blanket omission.
 *
 * `product.rating` is absent rather than zeroed for an unreviewed product precisely so this
 * stays a presence check rather than a `> 0` test somebody can get wrong.
 */
export function ProductJsonLd({
  product,
  currency,
  origin,
  reviews,
}: {
  product: ProductDetail;
  currency: StorefrontCurrency;
  origin: string;
  /** Published reviews, if the page loaded any — vendor ticket 10. */
  reviews?: ReadonlyArray<{
    rating: number;
    authorName: string;
    body: string;
    title?: string;
    createdAt: Date;
  }>;
}) {
  const url = `${origin}/marketplace/${product.slug}`;
  const price = product.prices.find((row) => row.currency === currency) ?? product.prices[0];
  const current = product.versions.find((version) => version.isCurrent);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: product.name,
    description: product.seo.description ?? product.summary,
    url,
    applicationCategory: product.taxonomy.categories[0]?.name ?? "BusinessApplication",
    ...(product.media.length > 0 ? { image: product.media.map((item) => item.url) } : {}),
    ...(current
      ? {
          softwareVersion: current.version,
          ...(current.releasedAt ? { datePublished: current.releasedAt } : {}),
        }
      : {}),
    ...(product.requirements ? { softwareRequirements: product.requirements } : {}),
    ...(product.taxonomy.technologies.length > 0
      ? { keywords: product.taxonomy.technologies.map((term) => term.name).join(", ") }
      : {}),
    ...(product.rating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            // schema.org wants the number, not a formatted string. One decimal place,
            // derived from two integers — see `averageRating`.
            ratingValue: product.rating.average,
            reviewCount: product.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    // Individual reviews, where the caller passed any. Five at most: the aggregate is what
    // search engines use, and a page of forty serialised reviews in a script tag is weight
    // for nothing.
    ...(reviews && reviews.length > 0
      ? {
          review: reviews.slice(0, 5).map((entry) => ({
            "@type": "Review",
            reviewRating: {
              "@type": "Rating",
              ratingValue: entry.rating,
              bestRating: 5,
              worstRating: 1,
            },
            // The same shortened name the page shows. A full name in structured data would
            // publish more than the visible page does, which is the wrong way round.
            author: { "@type": "Person", name: entry.authorName },
            datePublished: entry.createdAt,
            reviewBody: entry.body,
            ...(entry.title ? { name: entry.title } : {}),
          })),
        }
      : {}),
    ...(price
      ? {
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: price.currency,
            // `formatPlain`, not a second money formatter and never `toFixed`:
            // schema.org wants a bare decimal, and JPY has no decimal places at
            // all. One code path for money, everywhere.
            price: formatPlain({ amount: price.amount, currency: price.currency }),
            availability: "https://schema.org/InStock",
            /*
             * The **actual** seller — vendor ticket 11.
             *
             * This said `name: "CoSetup"` unconditionally, which became a false statement
             * in machine-readable structured data the moment a vendor product was published —
             * and structured data is the one place a false statement is read literally.
             *
             * A vendor product names the vendor and links to their storefront, whose own
             * `Organization` node carries the same identity. A first-party product still names
             * the platform, because it still is the seller. The site-wide `Organization` and
             * `WebSite` nodes in the public layout are untouched: they describe the *site*,
             * not the seller of any given item.
             */
            seller: product.vendor
              ? {
                  "@type": "Organization",
                  name: product.vendor.name,
                  url: `${origin}/vendors/${product.vendor.slug}`,
                }
              : { "@type": "Organization", name: "CoSetup" },
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      // See the block comment: JSX escaping produces invalid JSON here.
      dangerouslySetInnerHTML={{ __html: escapeForScript(JSON.stringify(data)) }}
    />
  );
}

/**
 * `</script>` inside a product name would end the block early and turn the rest
 * of the JSON into markup. Escaping `<` is the standard fix and stays valid
 * JSON — `<` parses back to `<`.
 */
function escapeForScript(json: string): string {
  return json.replace(/</g, "\\u003c");
}
