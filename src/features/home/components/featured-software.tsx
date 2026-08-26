import Link from "next/link";
import type { Route } from "next";
import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { getRail, getTaxonomyIndex } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { Band, SectionHead } from "@/components/band";

/**
 * "Ready-to-use applications & scripts" — the marketplace, made tangible.
 *
 * ## Third band, not seventh
 *
 * The brief's core principle is "show the marketplace before explaining the
 * company", and real named products now appear one scroll below the hero instead
 * of after three bands of positioning.
 *
 * ## The chips are links, not tabs
 *
 * The brief asks for tabs or chips — Featured, Free, and some real categories.
 * These are `<Link>`s into `/marketplace` with the filter applied, which is
 * strictly better than client-side tabs here: no JavaScript, crawlable, every
 * destination is a real filtered grid the visitor can then refine, and the Back
 * button works. A tab that re-fetched into this band would also need its own
 * loading state for a result the grid already renders properly.
 *
 * Categories come from the taxonomy, so a chip cannot name a shelf that is empty.
 */
export async function FeaturedSoftware() {
  const currency = await resolveStorefrontCurrency();
  const [cards, taxonomy] = await Promise.all([
    getRail("featured", currency, 8, "script"),
    getTaxonomyIndex("script"),
  ]);

  // An empty catalogue is a real state — a fresh install, or every product
  // unpublished. Rendering the heading over nothing looks broken.
  if (cards.length === 0) return null;

  const categories = taxonomy.category.slice(0, 4);

  return (
    <Band id="software" tone="muted">
      <SectionHead
        eyebrow="Applications & scripts"
        title="Built already. Yours today."
        lede="Complete, working software with the source included. Install it as it stands, or have us adapt it to how you actually work."
        action={{ href: "/marketplace", label: "Browse all software" }}
      />

      <div className="mt-8 flex flex-wrap gap-1.5">
        <Chip href={`/marketplace?free=true&currency=${currency}` as Route}>Free</Chip>
        {categories.map((term) => (
          <Chip key={term.slug} href={`/marketplace/category/${term.slug}` as Route}>
            {term.name}
          </Chip>
        ))}
      </div>

      {/*
        Four on a phone, eight from `sm` up.

        Eight is two tidy rows on a desktop grid and eight full-width screens on
        a phone — enough scrolling that the bands below it stop being discovered.
        Trimmed in CSS rather than by fetching fewer, because the count that is
        right depends on the viewport and the query runs on the server, where the
        viewport is unknown. One request, one grid, one source of truth.
      */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*:nth-child(n+5)]:hidden sm:[&>*:nth-child(n+5)]:block">
        {cards.map((card, index) => (
          // `priority` on the first only: it is the band's LCP candidate, and
          // marking all eight would make the browser fetch eight images at once
          // and slow the one that matters.
          <ProductCardTile key={card.id} card={card} priority={index === 0} />
        ))}
      </div>
    </Band>
  );
}

function Chip({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground rounded-full border px-3.5 py-1.5 text-[12.5px] transition"
    >
      {children}
    </Link>
  );
}

/** Eight card-shaped blanks, sized to the real thing so nothing shifts. */
export function SoftwareSkeleton() {
  return (
    <Band tone="muted">
      <div className="bg-surface-muted h-[38px] w-[220px] animate-pulse rounded-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="bg-surface-muted h-[300px] animate-pulse rounded-xl" />
        ))}
      </div>
    </Band>
  );
}
