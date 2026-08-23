import Image from "next/image";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { FreeBadge } from "@/components/free-badge";
import { MoneyDisplay } from "@/components/money-display";
import { StarRating } from "@/components/star-rating";
import { money } from "@/lib/money";
import type { Route } from "next";
import type { ProductCard as Card } from "@/services/marketplace";
import { CATALOGUE_SURFACE } from "@/config/catalogue";

/**
 * One product in the grid.
 *
 * A **Server Component**. There is nothing interactive here — the whole card is
 * a link — so making it a client component would ship the price formatter, the
 * money type and every chip's markup to the browser for no behaviour.
 *
 * ## "Price on request" is a real state, not a fallback
 *
 * A product with no price in the viewer's currency is **not hidden**: hiding it
 * would give a visitor in Lagos a smaller catalogue from the same URL than one
 * in London, which breaks the linkability criterion in the least visible way
 * possible. It renders "Price on request" instead — and never `£0.00`, which is
 * what `activePrice?.amount ?? 0` would produce.
 *
 * A genuinely free product priced at `0` still renders as a price, because the
 * card branches on `price` being present rather than on the amount being
 * truthy.
 */
export function ProductCardTile({
  card,
  priority,
}: {
  card: Card;
  /** The first card is the LCP element on the grid — `priority` skips lazy-load. */
  priority?: boolean;
}) {
  return (
    /*
     * An `<article>` with an **overlay link**, not a `<Link>` wrapping everything.
     *
     * The card gained a second link in vendor ticket 11 — the vendor's name, pointing at their
     * storefront — and an `<a>` inside an `<a>` is invalid HTML that browsers resolve by
     * dropping one of them. The standard fix, and the one that keeps this a Server Component
     * (no `onClick`, no `stopPropagation`): the product link is absolutely positioned over the
     * whole card at `z-0`, and anything that needs to be clickable in its own right sits above
     * it. One tab stop per destination, and the whole card is still a click target.
     */
    <article className="group border-border bg-surface relative flex flex-col overflow-hidden rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-[var(--ring)] hover:border-[var(--signal)]/40">
      <Link
        /*
         * Through `CATALOGUE_SURFACE`, not a literal.
         *
         * Both catalogues resolve to `/marketplace` today, so this changes nothing
         * yet — which is the point of doing it now. When a template's detail page
         * moves, that is one table entry and a compiler walk rather than a hunt
         * through the 80-odd `/marketplace/` literals in the tree, and this card is
         * the highest-traffic one of them.
         */
        href={`${CATALOGUE_SURFACE[card.catalogue].productPath}/${card.slug}` as Route}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none"
      >
        {/* The accessible name for the overlay. The visible heading is not inside the link, so
            without this the link would announce as unlabelled. */}
        <span className="sr-only">{card.name}</span>
      </Link>

      <div className="bg-surface-muted relative aspect-[16/10] overflow-hidden">
        {card.image ? (
          <Image
            src={card.image.url}
            alt={card.image.alt}
            fill
            // Three columns at desktop, two at tablet, one on a phone. Without
            // this the browser downloads a full-width image for a 320px slot.
            sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            priority={priority}
          />
        ) : (
          <div className="text-subtle flex h-full items-center justify-center font-mono text-[10px] tracking-[0.16em] uppercase">
            No screenshot
          </div>
        )}

        {card.isFeatured && (
          <span className="bg-background/90 absolute top-2.5 left-2.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] uppercase backdrop-blur">
            Featured
          </span>
        )}
      </div>

      {/* `pointer-events-none` on the body, re-enabled on the vendor link: the overlay is what
          takes a click anywhere else, and without this the text would swallow it. */}
      <div className="pointer-events-none flex flex-1 flex-col gap-2.5 p-4">
        {/*
          The type — "Full Script" or "Website Template".

          Above the title rather than down with the category pills, because it is
          not another tag: the pills say what a thing is *about* and this says what
          it *is*, and a buyer needs the second one before the first means anything.
          A grid that mixes the two catalogues — search results, a saved list, a
          vendor storefront — is where a card has to answer it on its own.

          Same mono/uppercase idiom as "Featured" and "Adaptable", so it reads as
          metadata about the listing rather than as content of it.
        */}
        {/* One block with the title, at `gap-1`: the body's own `gap-2.5` would
            float the eyebrow midway between the image and the name and it would
            read as a caption on the screenshot instead of a label on the listing. */}
        <div className="flex flex-col gap-1">
          <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            {CATALOGUE_SURFACE[card.catalogue].label}
          </span>

          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-[15px] leading-tight tracking-[-0.01em]">
              {card.name}
            </h3>
            {card.customisable && (
              <span
                className="text-subtle flex shrink-0 items-center gap-1 font-mono text-[9.5px] tracking-[0.12em] uppercase"
                title="Can be adapted to your requirements"
              >
                <Sparkles className="size-3" aria-hidden />
                Adaptable
              </span>
            )}
          </div>
        </div>

        {/*
          Attribution — vendor ticket 04, now a link (vendor ticket 11).

          It was text until the storefront existed, because `typedRoutes` will not compile a
          link to a route nobody has built — which is the rule working rather than a limitation:
          the link arrived in the same commit as the page it points at.

          `stopPropagation` because the whole card is a link to the product. Without it, a click
          on the vendor name would navigate to the product instead, which is the most annoying
          possible outcome for somebody who deliberately aimed at the maker's name.

          Absent for a first-party product, deliberately — "by CoSetup" on a platform called
          CoSetup tells a buyer nothing.
        */}
        {card.vendor && (
          <p className="text-subtle pointer-events-auto relative z-10 w-fit text-[12px]">
            by{" "}
            <Link
              href={`/vendors/${card.vendor.slug}` as Route}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {card.vendor.name}
            </Link>
          </p>
        )}

        {/*
          Vendor ticket 10. Above the summary, because a buyer scanning a grid uses the
          rating to decide whether to read the summary at all — and nothing is drawn for an
          unreviewed product, so a new listing is not marked out as unloved.
        */}
        {card.rating && (
          <StarRating average={card.rating.average} count={card.rating.count} size="small" />
        )}

        <p className="text-muted-foreground line-clamp-2 text-[13px] leading-relaxed">
          {card.summary}
        </p>

        {(card.categories.length > 0 || card.technologies.length > 0) && (
          <ul className="flex flex-wrap gap-1.5">
            {card.categories.map((term) => (
              <li
                key={`cat-${term.slug}`}
                className="border-border rounded-full border px-2 py-0.5 text-[11px]"
              >
                {term.name}
              </li>
            ))}
            {card.technologies.map((term) => (
              <li
                key={`tech-${term.slug}`}
                className="text-subtle rounded-full px-2 py-0.5 font-mono text-[10.5px]"
              >
                {term.name}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-2">
          {card.price ? (
            <span className="flex items-baseline gap-2">
              {/*
                Zero is a proposition, not a number — see `FreeBadge`. The
                `compareAtAmount` beside it still renders, so a formerly-paid
                product now given away reads "Free  £299.00".
              */}
              {card.price.amount === 0 ? (
                <FreeBadge />
              ) : (
                <MoneyDisplay
                  value={money(card.price.amount, card.price.currency)}
                  className="text-[15px] font-medium"
                />
              )}
              {card.price.compareAtAmount !== undefined && (
                <MoneyDisplay
                  value={money(card.price.compareAtAmount, card.price.currency)}
                  className="text-subtle text-[12.5px] line-through"
                />
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-[13px]">Price on request</span>
          )}
        </div>
      </div>
    </article>
  );
}
