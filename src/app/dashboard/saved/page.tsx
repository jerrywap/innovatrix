import type { Metadata } from "next";
import { Bookmark } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { CURRENCY_COOKIE, toStorefrontCurrency } from "@/config/storefront";
import { getCardsBySlug } from "@/services/marketplace";
import { listSavedProductIds } from "@/services/marketplace/saved";
import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { cookies } from "next/headers";
import Link from "next/link";

export const metadata: Metadata = { title: "Saved" };

/**
 * Saved products — §6's "Save for Later".
 *
 * ## Saves are resolved to slugs before the cards are read
 *
 * `SavedProduct` stores a product id, and the card reader takes slugs — which
 * looks like a needless hop until you notice what it buys: the card query is
 * the *same cached read* the marketplace grid uses, tagged and invalidated the
 * same way. A second by-id reader would be a second projection to keep in step,
 * and the one that drifts is always the one nobody looks at.
 *
 * ## A save can outlive its product
 *
 * Unpublishing does not delete anyone's bookmark, and it should not — the
 * product may come back. So the list quietly shows fewer cards than there are
 * saves, rather than rendering a dead tile.
 */
export default async function Page() {
  const user = await requireUser();
  const jar = await cookies();
  const currency = toStorefrontCurrency(jar.get(CURRENCY_COOKIE)?.value);

  const savedIds = await listSavedProductIds(user.id);

  await connectToDatabase();
  const rows = await Product.find({ _id: { $in: savedIds } })
    .select({ slug: 1 })
    .lean<Array<{ _id: unknown; slug: string }>>();

  // Preserve save order — `$in` returns index order, which here is arbitrary.
  const slugById = new Map(rows.map((row) => [String(row._id), row.slug]));
  const slugs = savedIds
    .map((id) => slugById.get(id))
    .filter((slug): slug is string => Boolean(slug));

  const cards = await getCardsBySlug(slugs, currency);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Saved"
        description="Products you've kept for later. Only you can see this list."
      />

      {cards.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Use the bookmark on any product in the marketplace and it will appear here."
          action={
            <Link
              href="/marketplace"
              className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px]"
            >
              Browse the marketplace
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <ProductCardTile key={card.id} card={card} />
            ))}
          </div>

          {cards.length < savedIds.length && (
            <p className="text-subtle text-[12.5px]">
              {savedIds.length - cards.length} saved{" "}
              {savedIds.length - cards.length === 1 ? "product is" : "products are"} no longer
              listed. Your bookmark is kept in case they return.
            </p>
          )}
        </>
      )}
    </div>
  );
}
