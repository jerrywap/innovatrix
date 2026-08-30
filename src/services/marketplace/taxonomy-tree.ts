import type { TaxonomyIndex, TaxonomyTerm } from "./index";

/**
 * Reading the category tree out of a `TaxonomyIndex`.
 *
 * ## Why these are here and not in `index.ts`
 *
 * `index.ts` carries `import "server-only"`, which is right for it — everything
 * in it touches the database or a cache scope. None of this does. These are pure
 * functions over data that is already in memory, and keeping them in their own
 * module is what lets a unit test call them with a hand-built index instead of a
 * mongod. There is no `vi.mock` anywhere in this codebase, so "pure, in its own
 * file" is the difference between a 30-line unit test and a 27th copy of the
 * integration preamble.
 *
 * ## The tree is one level deep
 *
 * A category is a root or a child of a root, and nothing else. That is why none
 * of these recurses, and why `parentOf` returns a term rather than a path. If a
 * third tier is ever wanted, this file is where it starts — and `deriveFacets`,
 * which denormalises exactly one ancestor onto the product, is where it becomes
 * expensive.
 *
 * ## Roots are identified by absence
 *
 * `parentSlug` is absent on a root — **and also on a child whose parent this
 * scope filtered out**, which `TaxonomyTerm.parentSlug` explains at length. That
 * is deliberate: the alternative is a subtree silently disappearing from the
 * storefront when somebody deactivates one parent. So "root" here means
 * "renders at the top level", which is the question every caller is actually
 * asking.
 */

/**
 * The top tier — what the rail, the category strip and the sitemap list.
 *
 * "Root" is `parentSlug` absent **or dangling**, and the second half is the
 * part that matters. `getTaxonomyIndex` already omits `parentSlug` when the
 * parent is outside the scope it read, but making that the only line of defence
 * puts the guarantee in one builder rather than in the shape itself. A term that
 * is neither a root nor under any parent that renders is unreachable: not in the
 * rail, not on a landing page, with its products still published and nothing
 * logged. So the predicate answers "does this render at the top level", which is
 * what every caller is asking, and it cannot be wrong about it.
 */
export function rootCategories(index: TaxonomyIndex): TaxonomyTerm[] {
  const present = new Set(index.category.map((term) => term.slug));
  return index.category.filter((term) => !term.parentSlug || !present.has(term.parentSlug));
}

/** One parent's children, in vocabulary order. Empty for a leaf or a childless root. */
export function childrenOf(index: TaxonomyIndex, parentSlug: string): TaxonomyTerm[] {
  return index.category.filter((term) => term.parentSlug === parentSlug);
}

/** A category by slug, whichever tier it is on. */
export function categoryBySlug(index: TaxonomyIndex, slug: string): TaxonomyTerm | undefined {
  return index.category.find((term) => term.slug === slug);
}

/**
 * A category by id — the one lookup that needs `TaxonomyTerm.id`.
 *
 * `Product.primaryCategoryId` is an id and everything else here is slug-keyed,
 * so this is the bridge between the two rather than a second query.
 */
export function categoryById(index: TaxonomyIndex, id: string): TaxonomyTerm | undefined {
  return index.category.find((term) => term.id === id);
}

/** A child's parent term, or `undefined` for a root. */
export function parentOf(index: TaxonomyIndex, term: TaxonomyTerm): TaxonomyTerm | undefined {
  return term.parentSlug ? categoryBySlug(index, term.parentSlug) : undefined;
}

/**
 * The inventory floor a landing page has to clear to be worth indexing.
 *
 * Reuses the number already in the codebase rather than inventing a second one:
 * `search-landing.tsx` refuses to print a catalogue count below **25**, on the
 * grounds that a small number advertised is worse than no number. The same
 * judgement applies to a page — a category with four products is a filter, not a
 * destination.
 *
 * Applies to the two page kinds this scheme *adds* — a child category, and a
 * template industry. Deliberately **not** applied to the marketplace industry
 * pages, which already exist and already rank: introducing a floor there would
 * de-index working pages to enforce a rule invented after them.
 */
export const LANDING_MIN_PRODUCTS = 25;

/**
 * Does a child category earn its own indexable URL?
 *
 * ```
 * childCount >= FLOOR  ∧  parentCount > childCount
 * ```
 *
 * ## Both clauses, and the second is the one that is easy to miss
 *
 * The first is the inventory floor: below it the page is thin, and a thin page is
 * read as a duplicate of the listing it was carved out of.
 *
 * The second kills the **one-child** case. A parent whose only child holds all of
 * its products has two URLs listing byte-identical rows — duplicate content we
 * would be generating on purpose, which is the exact mistake `categoryLandingPath`
 * already exists to prevent for `both`-scoped terms. When the child *is* the
 * parent, the parent is the page that should rank.
 *
 * This is a real state in the starter tree, not a hypothetical: `crm` is the only
 * child of `business-operations` and both carry 258 products.
 *
 * A below-floor child still **renders** — a link to it must never 404. It is
 * `noindex, follow` with a *self*-canonical, and absent from the sitemap. Not a
 * canonical to the parent: Google discards a canonical on a noindex page, and the
 * noindex can travel to the target. The products are real; the page just is not
 * worth ranking yet.
 */
export function isChildLandingIndexable(counts: {
  childCount: number;
  parentCount: number;
}): boolean {
  return counts.childCount >= LANDING_MIN_PRODUCTS && counts.parentCount > counts.childCount;
}

/**
 * Does a template industry earn its own indexable URL?
 *
 * One clause, not two — an industry has no parent to be indistinguishable from.
 *
 * ## Why this page exists at all, given the ownership rule
 *
 * `categoryLandingPath` gives a `both` **category** exactly one home, because two
 * URLs would list the same rows. Industries are the opposite case and the
 * departure is deliberate: `/marketplace/industry/logistics` lists scripts and
 * `/templates/industry/logistics` lists templates. Different inventory, different
 * heading, different canonical — not a duplicate.
 *
 * The floor is what keeps that honest. Almost every industry is scoped `both`, so
 * without it this route would mint a page per industry on day one, most of them
 * holding a handful of products, and the duplicate the ownership rule guards
 * against would arrive by another door.
 */
export function isIndustryLandingIndexable(count: number): boolean {
  return count >= LANDING_MIN_PRODUCTS;
}

/**
 * The roots worth showing: those with products behind them.
 *
 * ## Hidden, not greyed
 *
 * The rail used to render every term and grey the empty ones, so that it "never
 * loses options as it narrows". That reasoning holds for a dimension you *toggle*
 * — hide a technology because your current filter excludes it and you cannot then
 * pick it. It does not hold for a count taken over the **whole catalogue**, which
 * is what `termCounts` returns: a term with nothing behind it anywhere is not an
 * option somebody is about to want, it is furniture. At 30 parents, 43 industries
 * and 70 technologies, most of them empty, the furniture was the majority.
 *
 * The count must be global for exactly that reason. Hiding on a *relative* count
 * would reintroduce the dead end the old invariant existed to prevent.
 */
export function visibleRoots(
  index: TaxonomyIndex,
  counts: ReadonlyMap<string, number>,
): TaxonomyTerm[] {
  return rootCategories(index).filter((term) => (counts.get(term.slug) ?? 0) > 0);
}

/**
 * The children worth listing under a parent — **or none at all**.
 *
 * Two rules, and the second is the interesting one.
 *
 * A child with no products is dropped, for the reason above. And if that leaves
 * **exactly one**, the whole list is dropped: a parent with one populated child
 * holds precisely that child's products, so offering it as a narrowing choice
 * narrows nothing. The visitor clicks it and the same grid comes back under a
 * different heading.
 *
 * That is the display twin of `isChildLandingIndexable`'s `parentCount >
 * childCount` clause, which already refuses such a child a sitemap entry and a
 * canonical. One shape of duplicate, refused in both places for the same reason.
 *
 * Returning `[]` rather than the single child is what makes the caller's
 * `length > 0` guard do the right thing without knowing any of this.
 */
export function visibleChildren(
  index: TaxonomyIndex,
  parentSlug: string,
  counts: ReadonlyMap<string, number>,
): TaxonomyTerm[] {
  const populated = childrenOf(index, parentSlug).filter(
    (term) => (counts.get(term.slug) ?? 0) > 0,
  );
  return populated.length > 1 ? populated : [];
}
