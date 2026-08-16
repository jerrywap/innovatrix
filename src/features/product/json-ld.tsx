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
 * ## No `AggregateRating`
 *
 * There are no reviews in the MVP. Emitting a fabricated rating is a
 * structured-data policy violation with a manual-action penalty attached, and
 * "we'll fill it in later" is how that ships. Omitted.
 */
export function ProductJsonLd({
  product,
  currency,
  origin,
}: {
  product: ProductDetail;
  currency: StorefrontCurrency;
  origin: string;
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
            seller: { "@type": "Organization", name: "Innovatrix" },
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
