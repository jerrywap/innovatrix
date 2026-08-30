import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import {
  CATALOGUE_SURFACE,
  categoryLandingPath,
  type CatalogueScope,
} from "@/config/catalogue";
import { gradientFor } from "@/lib/gradient";
import { getTaxonomyIndex, type TaxonomyTerm } from "@/services/marketplace";
import {
  categoryBySlug,
  visibleChildren,
  visibleRoots,
} from "@/services/marketplace/taxonomy-tree";
import {
  categoryPreviews,
  termCounts,
  type CategoryPreview,
} from "@/services/marketplace/term-counts";

/**
 * Browsing by category — **one rail, showing one tier at a time.**
 *
 * ## Which tier
 *
 * | Where you are | The rail shows | Its title |
 * |---|---|---|
 * | the listing | the top tier | "Categories" |
 * | inside a category that has subcategories | those subcategories | the category's name |
 * | inside a category with none | the top tier, that one active | "Categories" |
 *
 * Two rails stacked was the first attempt and it was wrong twice over: it showed
 * the tier you had already chosen alongside the one you were choosing from, and
 * on a phone it took most of the screen before the first product. Drilling down
 * replaces rather than accumulates, and the title says where you are — so the
 * card answers "what is under this" instead of restating "here is everything".
 *
 * The **last row** matters: a category with nothing to drill into falls back to
 * the top tier rather than rendering an empty card. Nothing is ever a dead end,
 * and the useful move there is switching category, not staring at a heading.
 *
 * ## Where the shape comes from
 *
 * The hero's "Marketplace / Search & filter" panel (`home/components/hero-surface.tsx`)
 * — a `bg-surface` card holding rows that are `bg-background/60`. That inversion
 * is the whole effect: the *page* colour recessed into a lighter surface is what
 * makes a tile read as a slot rather than as another card stacked on the first.
 * It only works inside the card, which is why the card is here and the tiles are
 * not loose on the page.
 *
 * ## What is not here
 *
 * A term with no products, and a lone subcategory. Both live in `visibleRoots` /
 * `visibleChildren` so this card, the filter rail and the sitemap cannot disagree
 * about what exists — and both are argued there rather than here.
 */
export async function CategoryBrowser({
  catalogue,
  active,
}: {
  catalogue: Extract<CatalogueScope, "script" | "template">;
  /**
   * The **deepest** category in the URL — a parent on `/marketplace/{parent}`, a
   * child on `/marketplace/{parent}/{child}`.
   *
   * One prop rather than two, because the tree already knows which tier a slug is
   * on. Passing both would let a page state a parent/child pair that disagrees
   * with the taxonomy.
   */
  active?: string;
}) {
  const [taxonomy, counts, previews] = await Promise.all([
    getTaxonomyIndex(catalogue),
    termCounts(catalogue),
    categoryPreviews(catalogue),
  ]);

  const owned = (term: TaxonomyTerm) =>
    catalogue === "template" ? term.catalogue === "template" : term.catalogue !== "template";

  const activeTerm = active ? categoryBySlug(taxonomy, active) : undefined;
  // The tier the rail drills *into*: this term's own children if it is a parent,
  // or its siblings if it is already a child.
  const openSlug = activeTerm?.parentSlug ?? activeTerm?.slug;
  const children = openSlug ? visibleChildren(taxonomy, openSlug, counts.category) : [];

  const drilling = children.length > 0;
  const terms = drilling ? children : visibleRoots(taxonomy, counts.category).filter(owned);
  if (terms.length < 2) return null;

  const listingPath = (catalogue === "template" ? "/templates" : "/marketplace") as Route;
  const openTerm = openSlug ? categoryBySlug(taxonomy, openSlug) : undefined;

  // Drilled in, the active tile is where you actually are. At the top tier it is
  // the branch you are on, so the row still says which one that is.
  const activeTile = drilling ? activeTerm?.slug : openSlug;
  const surface = CATALOGUE_SURFACE[catalogue];

  return (
    <nav
      aria-label="Categories"
      className="border-border bg-surface shadow-lift mt-6 rounded-[26px] border p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 px-1 pb-3.5">
        <span className="text-subtle truncate font-mono text-[10px] tracking-[0.16em] uppercase">
          {drilling && openTerm ? openTerm.name : "Categories"}
        </span>

        {/*
          The way back up, in the slot that used to hold a "12 of 30" tally.
          The tally was noise — it counted what is *hidden*, which is the one
          thing somebody browsing does not need — and this is the only control
          the card needs that a tile cannot be.
        */}
        {drilling && (
          <Link
            href={listingPath}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded font-mono text-[10px] tracking-[0.1em] uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft className="size-3" aria-hidden />
            All categories
          </Link>
        )}
      </div>

      {/*
        A snapping carousel, not a free scroller.

        `snap-x snap-mandatory` with `snap-start` on each tile is what stops a
        phone leaving a tile sliced down the middle. The width is the other half:
        `68vw` means the next tile always **peeks**, which is the only affordance
        saying there is more — a row ending flush at the edge reads as ending.
        Above `sm` there is room for several, so it returns to a fixed width.

        `scrollbar-on-hover` is the filter sidebar's treatment: the bar is there
        when you reach for it and not otherwise.
      */}
      <div className="scrollbar-on-hover -mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 sm:-mx-5 sm:scroll-px-5 sm:px-5">
        <ul className="flex w-max gap-2">
          {terms.map((term) => (
            <li key={term.slug} className="snap-start">
              <Tile
                href={categoryLandingPath(term) as Route}
                name={term.name}
                count={counts.category.get(term.slug)}
                noun={surface.countNoun}
                preview={categoryImage(term, previews.get(term.slug))}
                active={term.slug === activeTile}
              />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function Tile({
  href,
  name,
  count,
  noun,
  preview,
  active,
}: {
  href: Route;
  name: string;
  count?: number;
  noun: { one: string; many: string };
  preview?: CategoryPreview;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // `aria-current` rather than colour alone — the active tile has to be
      // announced, not only seen.
      {...(active ? { "aria-current": "page" as const } : {})}
      className={`flex w-[68vw] max-w-[240px] items-center gap-3 rounded-2xl border p-2.5 transition-colors sm:w-[210px] ${
        active
          ? "border-signal/45 bg-signal/10"
          : "border-border bg-background/60 hover:border-border-strong"
      }`}
    >
      {/*
        44px, the hero's tile size. `bg-surface-muted` is the ground under a
        transparent or still-loading image — the house convention is a reserved
        box with an explicit empty state, never a blur placeholder.
      */}
      <span className="border-border bg-surface-muted relative size-11 shrink-0 overflow-hidden rounded-xl border">
        {preview ? (
          <Image src={preview.url} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <span
            aria-hidden
            className={`block size-full bg-gradient-to-br ${gradientFor(name.toLowerCase())}`}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{name}</span>
        {count !== undefined && (
          <span className="text-subtle block truncate font-mono text-[10.5px]">
            {/* "258 software scripts", never "258 products" — somebody browsing a
                marketplace of two catalogues wants to know which one this is. */}
            {count} {count === 1 ? noun.one : noun.many}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * Which picture a category shows: **upload, then product, then gradient.**
 *
 * Three steps because each covers what the next cannot. An upload is the only way
 * to say "this specific image"; a product screenshot is the only source that
 * needs no editorial work and stays current on its own; and the gradient is what
 * stops a tile rendering as an empty box before either exists.
 *
 * Pure and exported so the order is asserted once rather than trusted.
 */
export function categoryImage(
  term: { name: string; imageUrl?: string },
  preview?: CategoryPreview,
): CategoryPreview | undefined {
  if (term.imageUrl) return { url: term.imageUrl, alt: "" };
  return preview;
}
