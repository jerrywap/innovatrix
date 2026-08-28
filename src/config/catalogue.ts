import type { ProductCatalogue, TaxonomyCatalogue } from "@/lib/db/enums";

/**
 * The two catalogues, and the one place that knows where each one lives.
 *
 * Application **scripts** browse at `/marketplace`; website **templates** browse
 * at `/templates`. They coexist in one deployment today and templates are
 * intended to move to their own site later, so everything that turns a catalogue
 * into a URL goes through this module. That is the seam: when the move happens it
 * is a table edit and a compiler walk, not a search for string literals.
 *
 * Deliberately no `server-only` — client components read the labels.
 */

export interface CatalogueSurface {
  /** Where its grid lives. */
  listingPath: string;
  /** Where a category landing page lives. */
  categoryPath: string;
  /**
   * Where a **product page** lives.
   *
   * Both catalogues point at `/marketplace` today, on purpose. A template's
   * detail page has not moved yet, and moving it means touching canonicals,
   * `openGraph`, the `slugHistory` redirect, breadcrumbs, JSON-LD `offers.url`,
   * the proxy's product-path matcher and the sitemap. That is its own change; this
   * line is where it starts.
   */
  productPath: string;
  /**
   * What one of these **is**, in a customer's words, for a listing card's type
   * line.
   *
   * "Full Script" rather than "Script" because the distinction being drawn is not
   * script-versus-something-smaller, it is *a whole application* versus *a
   * front-end you style*. A visitor scanning a mixed grid — search results, a
   * saved list, a vendor storefront — is deciding which of those two they are
   * looking at, and "Script" alone does not answer it.
   */
  label: string;
  /**
   * The catalogue as a **destination**.
   *
   * The distinction from `label` is real and worth keeping: `label` is a fact
   * about *one item* in a mixed grid ("Full Script"), while this names the shelf
   * you are standing in front of. They are different jobs and one string cannot
   * do both.
   *
   * What is *not* true any more — this docblock used to say so — is that it is
   * "deliberately not wired in" anywhere. Three surfaces name the same
   * destination, and until they were pointed here they disagreed: the header link
   * said "Software & Scripts", the page it led to was titled "Marketplace", and a
   * product's breadcrumb said "Marketplace" *for both catalogues*, offering a
   * template buyer the wrong way back. So the listing `<h1>`, its `<title>`, the
   * footer and the breadcrumb ancestor all read this. `PUBLIC_NAV` still spells
   * its own, and that is the one remaining copy.
   */
  plural: string;
}

export const CATALOGUE_SURFACE: Record<ProductCatalogue, CatalogueSurface> = {
  script: {
    listingPath: "/marketplace",
    categoryPath: "/marketplace/category",
    productPath: "/marketplace",
    label: "Full Script",
    plural: "Software & Scripts",
  },
  template: {
    listingPath: "/templates",
    categoryPath: "/templates/category",
    productPath: "/marketplace",
    label: "Website Template",
    plural: "Website Templates",
  },
};

/**
 * Which catalogue's landing page a category term *owns*.
 *
 * ## Why this is not `CATALOGUE_SURFACE[catalogue].categoryPath`
 *
 * Because a term's home is decided by the **term's** scope, not by the product
 * you happened to arrive from. A term scoped `template` owns a page under
 * `/templates`; a `both` term keeps its single page on `/marketplace` and appears
 * under `/templates` as a *filter* instead. `sitemap.ts` splits
 * `taxonomy.category` on exactly that rule, each landing page's
 * `generateStaticParams` re-derives it, and `templates/category/[slug]` states
 * the reason in full: "two pages for one term would be duplicate content we
 * generated deliberately".
 *
 * Linking a breadcrumb by the product's catalogue would be a third spelling that
 * disagrees with both — a template product in a `both` category would point at
 * `/templates/category/<slug>`, a URL the sitemap withholds. And it would not
 * 404: `taxonomyScopeFilter("template")` matches `template`, `both` and `null`,
 * so the page renders. A silently crawlable duplicate is a worse outcome than a
 * loud failure, which is why this function exists rather than a one-line lookup.
 *
 * Tolerant of a missing `catalogue`, which is what a `ProductDetail` cached
 * before that field existed will hand it — see the note on
 * `ProductDetail.taxonomy`. Absence falls to `/marketplace`, the term's home in
 * every case but the one this exists to catch.
 */
export function categoryLandingPath(term: {
  slug: string;
  catalogue?: TaxonomyCatalogue;
}): string {
  const surface =
    term.catalogue === "template" ? CATALOGUE_SURFACE.template : CATALOGUE_SURFACE.script;
  return `${surface.categoryPath}/${term.slug}`;
}

/**
 * A **total** scope, with an explicit `"all"`.
 *
 * Not `ProductCatalogue | undefined`. Two callers legitimately want both
 * catalogues — a vendor's storefront, a customer's saved list — and with an
 * optional field "meant both" is indistinguishable from "forgot to pass it". On a
 * public listing that mistake fails *open*, which is the shape of bug this
 * codebase has been bitten by twice (`listingSuppressed`, and the `strictQuery`
 * incident behind `schema-paths.test.ts`).
 *
 * Required-with-`"all"` makes the decision a visible word in the diff, and lets
 * `tsc` enumerate every call site the day a new one appears.
 */
export type CatalogueScope = ProductCatalogue | "all";

/**
 * The product-side predicate.
 *
 * ## Why `$in` and not `$ne`
 *
 * Scripts are "not templates", and the obvious spelling is
 * `{ catalogue: { $ne: "template" } }`. It is wrong here for an index reason: the
 * storefront's compound index is `{ status, catalogue, facets }`, and a
 * **non-equality** predicate on a middle key stops the planner producing tight
 * bounds on the keys after it. `facets` is what comes after, and the whole point
 * of stage one in `pipeline.ts` is that `facets` keeps its bounds — verified there
 * with `explain()`. A `$ne` would quietly slow the *main* marketplace query, not
 * just the new one.
 *
 * `$in` is an equality-shaped predicate: two point intervals, and the keys after
 * it still bound. And `null` inside an `$in` matches a **missing** field, so this
 * stays correct for any document the backfill has not reached — the same
 * tolerance `listingSuppressed` needs, without giving up the index.
 *
 * (`listingSuppressed` is absent *forever* on first-party products. `catalogue` is
 * `required` with a default and is backfilled, so absence here is a window, not a
 * permanent state. The `null` is belt and braces for that window and for a process
 * holding a stale schema.)
 */
export function productCatalogueFilter(scope: CatalogueScope): Record<string, unknown> {
  if (scope === "all") return {};
  if (scope === "template") return { catalogue: "template" };
  return { catalogue: { $in: ["script", null] } };
}

/**
 * The taxonomy-side predicate.
 *
 * A `both` term belongs to either catalogue, so each surface wants its own scope
 * plus `both` — again as an `$in` of point values rather than a negation.
 */
export function taxonomyScopeFilter(scope: CatalogueScope): Record<string, unknown> {
  if (scope === "all") return {};
  const wanted: Array<TaxonomyCatalogue | null> = [scope, "both", null];
  return { catalogue: { $in: wanted } };
}

/**
 * The origin a catalogue's URLs hang off.
 *
 * One function, returning the same value for both today. It exists so that the
 * eventual second domain is a change *here* rather than in every caller — and so
 * that the number of places reading `APP_URL` for a product URL stays at one.
 *
 * Taking the scope as an argument rather than reading it from a request keeps this
 * pure and callable from a script.
 */
export function catalogueOrigin(_catalogue: ProductCatalogue, appUrl: string): string {
  return appUrl.replace(/\/$/, "");
}
