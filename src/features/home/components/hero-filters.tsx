import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, SlidersHorizontal, Sparkles } from "lucide-react";
import { getTaxonomyIndex } from "@/services/marketplace";
import { marketplaceHref } from "@/services/marketplace/query";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { CATALOGUE_SURFACE } from "@/config/catalogue";
import { PANEL_TERMS_PER_DIMENSION } from "../data";

/**
 * The filter panel behind the hero search — a launcher for the marketplace.
 *
 * ## Every control is a link, and that is the whole design
 *
 * `FilterRail` is a Server Component made of `<a>` elements on purpose: filtering
 * works before hydration, Back does what Back should do, and a copied URL
 * reproduces the result set by construction. None of that survives being rewritten
 * as client state, so it is not rewritten here either. This component knows nothing
 * about open/closed — `HeroSearch` owns that and receives this as `children`, the
 * same split `FilterDrawer` uses.
 *
 * One click applies one filter and goes. That is a deliberate limit: composing
 * several filters before navigating would mean holding selections in React state,
 * which costs the properties above and cannot show honest counts either. The
 * destination has the full rail for refining, and it is one link away.
 *
 * ## No counts
 *
 * Facet counts come out of the aggregation's `$facet` stage, so they need a product
 * query this page does not run. `FilterRail` renders count-free when
 * `countableDimensions` is empty and so does this — a number here would be invented,
 * which is the one thing the landing-page work has been refusing throughout.
 *
 * ## No catalogue toggle
 *
 * The catalogue is a *path*, not a parameter: `parseMarketplaceQuery` reads it from
 * `options` and ignores `?catalogue=` in the URL, and `query.test.ts` asserts that.
 * So the two catalogues are two destinations, and the template one is offered as a
 * link in the footer rather than dressed up as a filter.
 */
export async function HeroFilters() {
  const [taxonomy, currency] = await Promise.all([
    // The same argument the hero's `CatalogueSummary` passes, so this is the same
    // `"use cache"` entry rather than a second read.
    getTaxonomyIndex("script"),
    resolveStorefrontCurrency(),
  ]);

  const categories = taxonomy.category.slice(0, PANEL_TERMS_PER_DIMENSION);
  const industries = taxonomy.industry.slice(0, PANEL_TERMS_PER_DIMENSION);

  /*
   * `{}` as the current params, not the request's.
   *
   * We are not narrowing a grid we are standing on — this is the homepage, and each
   * link starts a fresh search. `SearchBox`'s `navigate` mode makes the same choice
   * for the same reason, and says so.
   */
  const href = (changes: Parameters<typeof marketplaceHref>[2]) =>
    marketplaceHref("/marketplace", {}, changes) as Route;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {categories.length > 0 && (
          <Group title="Category">
            {categories.map((term) => (
              <Chip key={term.slug} href={href({ category: term.slug })}>
                {term.name}
              </Chip>
            ))}
          </Group>
        )}

        {industries.length > 0 && (
          <Group title="Industry">
            {industries.map((term) => (
              <Chip key={term.slug} href={href({ industry: term.slug })}>
                {term.name}
              </Chip>
            ))}
          </Group>
        )}

        <Group title="Options">
          {/*
            `currency` is named explicitly, exactly as `FilterRail` does it: this
            link is what *creates* the price bound, so `currencyMustBeInUrl` is
            still false while it is being built. A shared `?free=true` carrying no
            currency shows a different catalogue to a viewer whose cookie disagrees.
          */}
          <Chip href={href({ free: true, currency })}>Free</Chip>
          <Chip href={href({ customisable: true })}>Can be adapted</Chip>
          <Chip href={href({ sort: "popular" })}>Most bought</Chip>
          <Chip href={href({ sort: "latest" })}>Newest</Chip>
        </Group>
      </div>

      <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Exit href="/marketplace" icon={SlidersHorizontal}>
            All filters
          </Exit>
          <Exit href={CATALOGUE_SURFACE.template.listingPath as Route} icon={ArrowRight}>
            Browse {CATALOGUE_SURFACE.template.plural.toLowerCase()}
          </Exit>
        </div>

        <Exit href="/custom-software" icon={Sparkles} accent>
          Can&rsquo;t find it? Request a custom build
        </Exit>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** The rail's chip, restated — its own `CHIP` constant is module-private. */
function Chip({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="border-border text-muted-foreground hover:border-border-strong hover:text-foreground rounded-lg border px-2.5 py-1.5 text-[12.5px] transition"
    >
      {children}
    </Link>
  );
}

function Exit({
  href,
  icon: Icon,
  accent,
  children,
}: {
  href: Route;
  icon: typeof ArrowRight;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        accent
          ? "text-signal-text inline-flex items-center gap-2 text-[13px] font-medium"
          : "text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-[13px] transition"
      }
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
