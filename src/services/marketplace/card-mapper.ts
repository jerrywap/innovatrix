import "server-only";
import { parseFacet } from "@/lib/db/models/catalog";
import type { TaxonomyKind } from "@/lib/db/enums";
import type { StorefrontCurrency } from "@/config/storefront";
import type { ProductCard, TaxonomyIndex } from "./index";

/**
 * One aggregation row → one card.
 *
 * Its own module because three callers need it — the marketplace grid, the
 * discovery rails and ticket 09's related-products strip. A second copy is how
 * the "price on request" rule ends up applying on two screens out of three.
 */

export interface RawCard {
  _id: unknown;
  slug: string;
  name: string;
  summary: string;
  facets?: string[];
  media?: Array<{ url?: string; storageKey?: string; alt?: string }>;
  activePrice?: { amount: number; currency: string; compareAtAmount?: number } | null;
  hasPrice?: boolean;
  customization?: { available?: boolean };
  isFeatured?: boolean;
}

export function toCard(
  row: RawCard,
  taxonomy: TaxonomyIndex,
  currency: StorefrontCurrency,
): ProductCard {
  const byKind = (kind: TaxonomyKind, prefix: string) => {
    const names = new Map(taxonomy[kind].map((term) => [term.slug, term.name]));
    return (
      (row.facets ?? [])
        .map(parseFacet)
        .filter((facet) => facet?.prefix === prefix)
        .map((facet) => ({ slug: facet!.slug, name: names.get(facet!.slug) ?? facet!.slug }))
        // A facet whose term was deactivated still renders — with its slug — so
        // a card never silently loses a chip. The rail is where terms disappear.
        .slice(0, 3)
    );
  };

  const image = (row.media ?? []).find((item) => item.url);

  return {
    id: String(row._id),
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    categories: byKind("category", "cat"),
    technologies: byKind("technology", "tech"),
    ...(image?.url ? { image: { url: image.url, alt: image.alt ?? row.name } } : {}),
    // `hasPrice` decides, not truthiness of the amount: a genuinely free
    // product priced at 0 must render "Free", not "Price on request".
    ...(row.hasPrice && row.activePrice
      ? {
          price: {
            amount: row.activePrice.amount,
            currency,
            ...(row.activePrice.compareAtAmount
              ? { compareAtAmount: row.activePrice.compareAtAmount }
              : {}),
          },
        }
      : {}),
    customisable: Boolean(row.customization?.available),
    isFeatured: Boolean(row.isFeatured),
  };
}

/** Same mapping, for a caller that already has raw aggregation rows in hand. */
export function toCardsForRelated(
  rows: ReadonlyArray<Record<string, unknown>>,
  taxonomy: TaxonomyIndex,
  currency: StorefrontCurrency,
): ProductCard[] {
  return rows.map((row) => toCard(row as unknown as RawCard, taxonomy, currency));
}
