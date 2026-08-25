import "server-only";
import { parseFacet } from "@/lib/db/models/catalog";
import type { ProductCatalogue, TaxonomyKind } from "@/lib/db/enums";
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
  /** Absent on a row written before the field existed — read as `script`. */
  catalogue?: ProductCatalogue;
  facets?: string[];
  media?: Array<{ kind?: string; url?: string; storageKey?: string; alt?: string }>;
  activePrice?: { amount: number; currency: string; compareAtAmount?: number } | null;
  hasPrice?: boolean;
  customization?: { available?: boolean };
  isFeatured?: boolean;
  /** Vendor ticket 04 — denormalised onto `Product` and projected, never looked up. */
  vendorSlug?: string;
  vendorName?: string;
  /** Vendor ticket 10 — two integers, projected; the average is derived below. */
  ratingSum?: number;
  ratingCount?: number;
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

  /*
   * `kind` is checked here as well as in the projection.
   *
   * Belt and braces, and cheap: `CARD_PROJECTION` filters to screenshots, and this
   * mapper also serves `getCardsBySlug`, which reuses the pipeline via `.slice(1)`
   * and is the sort of call site that grows its own projection one day. A video URL
   * reaching `next/image` is a broken card image, which nothing in the suite would
   * notice.
   */
  const image = (row.media ?? []).find(
    (item) => item.url && (item.kind === undefined || item.kind === "screenshot"),
  );

  return {
    id: String(row._id),
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    // Defaulted rather than optional on the card: every product is in exactly one
    // catalogue, so a card with no type is a card that cannot render its own
    // label. The fallback matches the schema default and the backfill.
    catalogue: row.catalogue ?? "script",
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
    // Projected onto the row rather than looked up: `CARD_PROJECTION` carries
    // `vendorName`/`vendorSlug` precisely so a card can attribute itself without a
    // query per row. Both or neither — a name with no slug could not be linked later.
    ...(row.vendorName && row.vendorSlug
      ? { vendor: { slug: row.vendorSlug, name: row.vendorName } }
      : {}),
    // Vendor ticket 10. Derived here from two integers rather than read as a stored float —
    // one rounding, in one place, and nothing in the database that can disagree with the
    // reviews behind it.
    ...(row.ratingCount && row.ratingSum
      ? {
          rating: {
            average: Math.round((row.ratingSum / row.ratingCount) * 10) / 10,
            count: row.ratingCount,
          },
        }
      : {}),
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
