import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { getPublishedProductCount, getRail, getTaxonomyIndex } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { categoryLandingPath, CATALOGUE_SURFACE } from "@/config/catalogue";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { CatalogueExits } from "./catalogue-exits";
import { SEARCH_OPENERS } from "./data";
import { rootCategories } from "@/services/marketplace/taxonomy-tree";

/**
 * `/search` with nothing asked for yet.
 *
 * Somebody typing the URL, or clearing what they typed. It has to be useful
 * *before* a query exists, and it must not be a second home page.
 *
 * ## Every read here is cached
 *
 * `getPublishedProductCount` and `getRail` both route through `cachedSearch`
 * (no `q`, so the free-text bypass does not apply) and `getTaxonomyIndex` is
 * `use cache`. So this page costs nothing an uncached search would cost — which
 * matters, because a bare `/search` is the cheapest thing to land on by accident.
 *
 * ## The counts use `DEFAULT_CURRENCY` on purpose
 *
 * A total does not vary by currency. Passing the *resolved* storefront currency
 * would mint a separate cache entry per visitor's currency for an identical
 * number — and `CatalogueSummary` on the home page already holds the GBP entry,
 * so this shares it rather than adding two more.
 */
export async function SearchLanding() {
  const currency = await resolveStorefrontCurrency();

  const [scripts, templates, taxonomy, featured] = await Promise.all([
    getPublishedProductCount(DEFAULT_CURRENCY, "script"),
    getPublishedProductCount(DEFAULT_CURRENCY, "template"),
    // `"all"`, so both vocabularies come back — and unlike the filter rail, this
    // page can afford to *un-merge* them again. See below.
    getTaxonomyIndex("all"),
    getRail("featured", currency, 3, "all"),
  ]);

  /*
   * Roots only, on both sides.
   *
   * This prints every term it is given as a chip, with no cap — which was fine
   * for a flat dozen and is not for a two-level tree: the second tier is where
   * the vocabulary's growth lives, and a page whose stated job is "not a second
   * home page" cannot carry all of it. Each parent's own page lists its children,
   * which is where the tier below belongs.
   */
  const roots = rootCategories(taxonomy);
  const scriptTerms = roots.filter((term) => term.catalogue !== "template");
  const templateTerms = roots.filter((term) => term.catalogue === "template");

  return (
    <div className="flex flex-col gap-12">
      <CatalogueExits variant="cards" />

      {/*
        The honesty floor, borrowed from `CatalogueSummary`.

        That component exists because the page once claimed "148 products across
        31 industries" while the catalogue held four. Below a threshold where a
        number is worth saying, say nothing rather than something small.
      */}
      {scripts >= 25 && templates >= 25 && (
        <p className="text-muted-foreground text-[13.5px]">
          <span className="text-foreground font-medium">{scripts}</span> applications and
          scripts and <span className="text-foreground font-medium">{templates}</span> website
          templates, searched together.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
          Start with a question
        </h2>
        <ul className="flex flex-wrap gap-2">
          {SEARCH_OPENERS.map((opener) => (
            <li key={opener.q}>
              <Link
                href={`/search?q=${encodeURIComponent(opener.q)}` as Route}
                className="border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[13px] transition-colors"
              >
                {opener.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/*
        Browse by category — the merge, un-merged.

        The filter rail *has* to show one merged vocabulary, because it is
        describing one result set. This page has no result set to describe, so it
        can do the thing the rail cannot: show that there are two shelves and
        which terms belong to which. The liability becomes the feature, in the one
        place it can.

        Every term goes through `categoryLandingPath`, so a `both` term keeps its
        single `/marketplace` home and only a template-scoped term points at
        `/templates/category/…` — matching exactly what the sitemap publishes.
      */}
      <section className="grid gap-8 sm:grid-cols-2">
        {[
          { title: CATALOGUE_SURFACE.script.plural, terms: scriptTerms },
          { title: CATALOGUE_SURFACE.template.plural, terms: templateTerms },
        ]
          .filter((column) => column.terms.length > 0)
          .map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h2 className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
                {column.title}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {column.terms.map((term) => (
                  <li key={term.slug}>
                    <Link
                      href={categoryLandingPath(term) as Route}
                      className="border-border hover:bg-surface-muted rounded-full border px-3 py-1 text-[12.5px] transition-colors"
                    >
                      {term.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>

      {featured.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            A few to start with
          </h2>
          {/* Mixed by construction — the first place the catalogue badge earns
              its colour, before a visitor has typed anything. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((card) => (
              <ProductCardTile key={card.slug} card={card} />
            ))}
          </div>
        </section>
      )}

      <p className="text-muted-foreground text-[13.5px]">
        Not finding it?{" "}
        <Link href="/custom-software" className="underline underline-offset-4">
          Have it built instead →
        </Link>
      </p>
    </div>
  );
}
