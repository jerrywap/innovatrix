import "server-only";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { getRelatedProducts, type ProductDetail } from "@/services/marketplace/detail";
import { ProductCardTile } from "@/features/marketplace/components/product-card";

/**
 * Same category or industry — §5.10.
 *
 * Renders nothing rather than an empty heading when there is no neighbour: a
 * "Related products" title above a blank space reads as a broken page, and a
 * product with no siblings is a normal state in a young catalogue.
 */
export async function RelatedProducts({ product }: { product: ProductDetail }) {
  const currency = await resolveStorefrontCurrency();

  const related = await getRelatedProducts(product, currency, 3);
  if (related.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">Related products</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((card) => (
          <ProductCardTile key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
