import { describe, expect, it } from "vitest";
import type { TaxonomyIndex, TaxonomyTerm } from "./index";
import {
  categoryById,
  childrenOf,
  LANDING_MIN_PRODUCTS,
  isChildLandingIndexable,
  parentOf,
  rootCategories,
  visibleChildren,
  visibleRoots,
} from "./taxonomy-tree";

/**
 * The category tree, read out of a scoped index.
 *
 * One of these three cases earns the file. The other two come along for an
 * assertion each because the index literal is already built.
 */

function term(partial: Partial<TaxonomyTerm> & { slug: string }): TaxonomyTerm {
  return {
    id: `id-${partial.slug}`,
    name: partial.slug,
    catalogue: "script",
    ...partial,
  };
}

function index(category: TaxonomyTerm[]): TaxonomyIndex {
  return { category, industry: [], technology: [], product_type: [] };
}

describe("the category tree", () => {
  const tree = index([
    term({ slug: "business-operations" }),
    term({ slug: "crm", parentSlug: "business-operations" }),
    term({ slug: "erp", parentSlug: "business-operations" }),
    // A root with no children — "a product may carry a parent alone".
    term({ slug: "finance" }),
  ]);

  it("lists roots, and a childless root is still a root", () => {
    expect(rootCategories(tree).map((t) => t.slug)).toEqual(["business-operations", "finance"]);
  });

  it("lists a parent's children, and nothing for a leaf", () => {
    expect(childrenOf(tree, "business-operations").map((t) => t.slug)).toEqual(["crm", "erp"]);
    expect(childrenOf(tree, "crm")).toEqual([]);
    expect(childrenOf(tree, "finance")).toEqual([]);
  });

  it("resolves a category by id, which is how a primary category is named", () => {
    expect(categoryById(tree, "id-crm")?.slug).toBe("crm");
    expect(categoryById(tree, "id-nothing")).toBeUndefined();
  });

  /**
   * **This is the case the file exists for.**
   *
   * A child can name a parent that is not in the index: deactivated in the admin
   * screen, or scoped to the other catalogue. The rail lists roots, and a parent
   * that is not there renders nothing — so a term treated as "a child whose
   * parent is missing" appears in *neither* tier. Its products stay published and
   * every route to them disappears, with nothing logged.
   *
   * Falling back to root degrades instead of hiding. Note the parent is absent
   * from the index here while `crm` still names it — which is exactly the state
   * deactivating one parent produces.
   */
  it("treats a term whose parent is out of scope as a root", () => {
    const orphaned = index([
      term({ slug: "crm", parentSlug: "business-operations" }),
      term({ slug: "finance" }),
    ]);

    expect(rootCategories(orphaned).map((t) => t.slug)).toEqual(["crm", "finance"]);
    expect(parentOf(orphaned, orphaned.category[0]!)).toBeUndefined();
  });
});

describe("isChildLandingIndexable", () => {
  const FLOOR = LANDING_MIN_PRODUCTS;

  it("indexes a child with enough of its own products, in a parent that has more", () => {
    expect(isChildLandingIndexable({ childCount: FLOOR, parentCount: FLOOR + 1 })).toBe(true);
  });

  it("refuses a thin child", () => {
    // A page with four products is a filter, not a destination — and Google reads
    // it as a duplicate of the listing it was carved out of.
    expect(isChildLandingIndexable({ childCount: FLOOR - 1, parentCount: 500 })).toBe(false);
  });

  /**
   * The clause that is easy to forget, and the one the starter tree actually
   * hits: `crm` is the only child of `business-operations` and both carry 258
   * products, so the two pages would list byte-identical rows.
   */
  it("refuses a child that is the whole parent, however large", () => {
    expect(isChildLandingIndexable({ childCount: 258, parentCount: 258 })).toBe(false);
  });

  it("refuses a child counted higher than its parent, which should not happen", () => {
    // A product carries its category's parent too, so a child can never out-count
    // its parent. If it does, the facets have drifted — and the safe reading of a
    // number that cannot be right is "do not publish a page on it".
    expect(isChildLandingIndexable({ childCount: 300, parentCount: 258 })).toBe(false);
  });
});

describe("what the browser and the rail actually list", () => {
  const tree = index([
    term({ slug: "business-operations" }),
    term({ slug: "crm", parentSlug: "business-operations" }),
    term({ slug: "erp", parentSlug: "business-operations" }),
    term({ slug: "commerce" }),
    term({ slug: "e-commerce", parentSlug: "commerce" }),
    term({ slug: "pos", parentSlug: "commerce" }),
    term({ slug: "ai" }),
  ]);

  it("drops a root with nothing behind it", () => {
    // `ai` is a real term with a real landing page — it is simply not worth a
    // tile until something is filed under it.
    const counts = new Map([
      ["business-operations", 258],
      ["crm", 258],
      ["commerce", 117],
      ["e-commerce", 90],
      ["pos", 27],
    ]);
    expect(visibleRoots(tree, counts).map((t) => t.slug)).toEqual([
      "business-operations",
      "commerce",
    ]);
  });

  it("lists children when there is a choice between them", () => {
    const counts = new Map([
      ["commerce", 117],
      ["e-commerce", 90],
      ["pos", 27],
    ]);
    expect(visibleChildren(tree, "commerce", counts).map((t) => t.slug)).toEqual([
      "e-commerce",
      "pos",
    ]);
  });

  /**
   * **The rule worth writing down.** A parent whose only populated child holds
   * all of its products offers no narrowing: clicking the child returns the same
   * grid under a different heading. `isChildLandingIndexable` already refuses
   * that child a sitemap entry; this refuses it a tile, for the same reason.
   *
   * The empty siblings are in the tree here on purpose — the rule is about how
   * many children have *products*, not how many exist.
   */
  it("lists nothing when only one child is populated, however many exist", () => {
    const counts = new Map([
      ["business-operations", 258],
      ["crm", 258],
    ]);
    expect(visibleChildren(tree, "business-operations", counts)).toEqual([]);
  });

  it("lists nothing for a childless root", () => {
    expect(visibleChildren(tree, "ai", new Map([["ai", 12]]))).toEqual([]);
  });
});
