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
  /**
   * Where an industry landing page lives.
   *
   * Added late, and its absence was the bug. `sitemap.ts` hardcoded
   * `/marketplace/industry/${slug}` for **every** industry while the category
   * lines two above it split by ownership — so a template-scoped industry was
   * advertised at a URL its own page never prerenders. Two spellings of one fact,
   * and only one of them was in this table.
   */
  industryPath: string;
  /**
   * Where a **product page** lives.
   *
   * `/details` for both catalogues, and the move off `/marketplace` is what makes
   * the two-tier category URLs possible at all: a product and a category cannot
   * both own `/marketplace/[slug]`, because Next allows one dynamic segment per
   * level.
   *
   * It also deleted a wart. `proxy.ts` used to match a product with
   * `/^\/marketplace\/(?!category\/|industry\/)…/` — a negative lookahead that
   * would have needed a new clause for every static segment ever added beside it.
   * Under `/details/{slug}` the pattern has no exclusions, because `/details` has
   * no static children.
   *
   * Still one path for both catalogues. The seam is for the day templates get
   * their own domain; it just has nothing to distinguish yet.
   */
  productPath: string;
  /**
   * What one of these **is**, in a customer's words, for a listing card's badge.
   *
   * "Full Software Script" rather than "Script" because the distinction being
   * drawn is not script-versus-something-smaller, it is *a whole application*
   * versus *a front-end you style*. A visitor scanning a mixed grid — search
   * results, a saved list, a vendor storefront — is deciding which of those two
   * they are looking at, and "Script" alone does not answer it. "Software" earns
   * its place for the same reason: it is the word that separates the two.
   *
   * Read in exactly one place, `product-card.tsx`, which is why the wording can
   * be reconsidered without a hunt.
   */
  label: string;
  /**
   * The catalogue as a **destination**.
   *
   * The distinction from `label` is real and worth keeping: `label` is a fact
   * about *one item* in a mixed grid ("Full Software Script"), while this names the shelf
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
  /**
   * The noun for **counting** things in this catalogue — "258 software scripts".
   *
   * A third string, and a third job. `label` is a fact about *one item* in a
   * mixed grid ("Full Software Script"); `plural` names the shelf you are
   * standing in front of ("Software & Scripts"); this follows a number. None of
   * the three can do another's work: "258 Software & Scripts" reads as a
   * category name with a number stuck on it, and "258 Full Software Scripts"
   * over-qualifies a count nobody asked to have qualified.
   *
   * Both forms, because English needs them and a card showing "1 products" is
   * the sort of thing a person notices before anything else on the page.
   */
  countNoun: { one: string; many: string };
}

export const CATALOGUE_SURFACE: Record<ProductCatalogue, CatalogueSurface> = {
  script: {
    listingPath: "/marketplace",
    industryPath: "/marketplace/industry",
    productPath: "/details",
    label: "Full Software Script",
    plural: "Software & Scripts",
    countNoun: { one: "software script", many: "software scripts" },
  },
  template: {
    listingPath: "/templates",
    /*
     * No route yet — `/templates/industry/[slug]` arrives with the two-tier
     * landing pages. Stated here rather than left out because this table is the
     * one place that answers "where does a template's X live", and a missing row
     * is how the sitemap ended up with a literal.
     */
    industryPath: "/templates/industry",
    productPath: "/details",
    label: "Website Template",
    plural: "Website Templates",
    countNoun: { one: "template", many: "templates" },
  },
};

/**
 * The URL of a product's detail page. **The only way to build one.**
 *
 * ## Why a function rather than reading `productPath` at the call site
 *
 * Because a product URL is built in twenty-three places, and eighteen of them
 * were written `as Route`. A cast defeats `typedRoutes` completely — so moving
 * the page would leave `tsc` perfectly happy about eighteen links pointing at a
 * route that no longer exists, and the only way to find them would be to click
 * each one. That is the same failure `sitemap.test.ts`'s docblock was written
 * after, where the sitemap advertised `/about` and `/contact` and neither route
 * existed.
 *
 * With one builder, moving the page is an edit *here* and a grep that comes back
 * empty.
 *
 * ## `catalogue` is optional, and that is honest rather than lax
 *
 * Both catalogues resolve to the same path today, and six of the call sites — the
 * cart, a notification, two staff screens, two dashboard screens — hold a slug
 * and no catalogue. Making it required would only make them guess. The parameter
 * exists so the seam survives for the eventual template domain; it just has
 * nothing to distinguish yet.
 *
 * Not for a *landing* page — see `categoryLandingPath`.
 */
export function productHref(slug: string, catalogue: ProductCatalogue = "script"): string {
  return `${CATALOGUE_SURFACE[catalogue].productPath}/${slug}`;
}

/**
 * Where a category term lives — **the only way to build a category URL.**
 *
 * ## Why it takes the term rather than a catalogue
 *
 * Because a term's home is decided by the **term's** scope, not by the product
 * you happened to arrive from. A term scoped `template` owns a page under
 * `/templates`; a `both` term keeps its single page on `/marketplace` and appears
 * under `/templates` as a *filter* instead. `sitemap.ts` maps every category
 * through this function, each landing page's `generateStaticParams` re-derives
 * the same rule, and two pages for one term would be duplicate content we
 * generated deliberately.
 *
 * Linking a breadcrumb by the *product's* catalogue would be a second spelling
 * that disagrees — a template product in a `both` category would point under
 * `/templates`, a URL the sitemap withholds. And it would not 404:
 * `taxonomyScopeFilter("template")` matches `template`, `both` and `null`, so the
 * page renders. A silently crawlable duplicate is a worse outcome than a loud
 * failure, which is why this function exists rather than a one-line lookup.
 *
 * There is deliberately no `categoryPath` on `CatalogueSurface` any more. It used
 * to name `/marketplace/category`, which is now a **308** to whatever this returns
 * — a legacy address rather than a place anything lives, and a table entry nothing
 * reads is a lie about where things are.
 *
 * ## Two segments for a child, one for a root
 *
 * `parentSlug` is what makes `/marketplace/{parent}/{child}` — the URL *is* the
 * hierarchy, which is why a child belongs to exactly one parent.
 *
 * Tolerant of a missing `catalogue` **and** of a missing `parentSlug`, and both
 * tolerances earn their keep for the same reason: a `ProductDetail` is cached, so
 * one written before either field existed will hand this a term without it. A
 * missing `catalogue` falls to `/marketplace`; a missing `parentSlug` falls to the
 * one-segment form. Neither is a broken link — `/marketplace/[parent]` answers a
 * child at that depth with a 308 up to its real address, which is what turns this
 * tolerance into something safe rather than merely quiet.
 */
export function categoryLandingPath(term: {
  slug: string;
  catalogue?: TaxonomyCatalogue;
  parentSlug?: string;
}): string {
  const surface =
    term.catalogue === "template" ? CATALOGUE_SURFACE.template : CATALOGUE_SURFACE.script;
  return term.parentSlug
    ? `${surface.listingPath}/${term.parentSlug}/${term.slug}`
    : `${surface.listingPath}/${term.slug}`;
}

/**
 * Segments that sit *beside* a category under `/marketplace` and `/templates`.
 *
 * Once a category owns `/{catalogue}/{parent}`, these two literals are competing
 * for the same space. Next resolves a static segment before a dynamic one — so
 * `/marketplace/category/crm` keeps reaching `category/[slug]` and never
 * `[parent]/[child]` — which means the collision does not error. It just makes a
 * category slugged `category` **permanently unreachable**: its landing page is
 * shadowed, its sitemap entry 404s in effect, and nothing anywhere reports it.
 *
 * So it is refused at the write, where somebody can be told why.
 *
 * `page` is deliberately **not** here. It is a reserved *file* name, not a route
 * segment, and `/marketplace/page` is a perfectly good category URL.
 */
export const RESERVED_CATALOGUE_SEGMENTS = ["category", "industry"] as const;

export function isReservedCatalogueSegment(slug: string): boolean {
  return (RESERVED_CATALOGUE_SEGMENTS as readonly string[]).includes(slug);
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
