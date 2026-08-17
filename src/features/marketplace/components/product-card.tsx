import Image from "next/image";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money } from "@/lib/money";
import type { Route } from "next";
import type { ProductCard as Card } from "@/services/marketplace";

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
    <Link
      href={`/marketplace/${card.slug}` as Route}
      className="group border-border bg-surface focus-visible:ring-ring flex flex-col overflow-hidden rounded-xl border transition-colors hover:border-[var(--signal)]/40 focus-visible:ring-2 focus-visible:outline-none"
    >
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

      <div className="flex flex-1 flex-col gap-2.5 p-4">
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

        {/*
          Attribution — vendor ticket 04.

          Text, not a link: `/vendors/[slug]` is vendor ticket 11's route and
          `typedRoutes` will not compile a link to a route nobody has built. It becomes
          a link in the same commit that gives it somewhere to go.

          Absent for a first-party product, deliberately — "by Innovatrix" on a
          platform called Innovatrix tells a buyer nothing.
        */}
        {card.vendor && (
          <p className="text-subtle text-[12px]">
            by <span className="text-muted-foreground">{card.vendor.name}</span>
          </p>
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
              <MoneyDisplay
                value={money(card.price.amount, card.price.currency)}
                className="text-[15px] font-medium"
              />
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
    </Link>
  );
}
