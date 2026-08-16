import { describe, expect, it } from "vitest";
import { buildProductFacets, facetFilter, facetMatch, parseFacet } from "./models/catalog";

describe("buildProductFacets", () => {
  it("prefixes each dimension so slugs from different kinds cannot collide", () => {
    // `finance` is legitimately both a category and an industry — taxonomy
    // slugs are unique per kind, not globally.
    expect(
      buildProductFacets({ categorySlugs: ["finance"], industrySlugs: ["finance"] }),
    ).toEqual(["cat:finance", "ind:finance"]);
  });

  it("sorts and deduplicates, so the stored value is canonical", () => {
    // Two products with the same taxonomy must produce byte-identical arrays,
    // or a re-derive looks like a change and churns the index.
    expect(
      buildProductFacets({
        technologySlugs: ["laravel", "postgresql", "laravel"],
        categorySlugs: ["crm"],
      }),
    ).toEqual(["cat:crm", "tech:laravel", "tech:postgresql"]);
  });

  it("returns an empty array rather than undefined for a product with no taxonomy", () => {
    expect(buildProductFacets({})).toEqual([]);
  });
});

describe("facetMatch — OR within a dimension, AND across dimensions", () => {
  /**
   * The bug this function exists for. `$all` means *every* term must be
   * present, so two categories asks for a product filed under both — which
   * essentially never exists. Verified live: `$all` returns 0 documents where
   * `$in` returns 2.
   */
  it("uses $in within a dimension, never $all", () => {
    const match = facetMatch({ category: ["crm", "property"] });

    expect(match).toEqual({ $and: [{ facets: { $in: ["cat:crm", "cat:property"] } }] });
    expect(JSON.stringify(match)).not.toContain("$all");
  });

  it("ANDs separate dimensions", () => {
    // "a CRM built in Laravel", not "tagged with any of these four".
    expect(facetMatch({ category: ["crm"], technology: ["laravel"] })).toEqual({
      $and: [{ facets: { $in: ["cat:crm"] } }, { facets: { $in: ["tech:laravel"] } }],
    });
  });

  it("handles all four dimensions at once", () => {
    const match = facetMatch({
      category: ["crm"],
      industry: ["property"],
      technology: ["laravel", "postgresql"],
      productType: "complete-application",
    });
    expect(match?.$and).toHaveLength(4);
    expect(match?.$and[3]).toEqual({ facets: { $in: ["type:complete-application"] } });
  });

  it("accepts productType as a string or a single-element array", () => {
    expect(facetMatch({ productType: "script" })).toEqual(
      facetMatch({ productType: ["script"] }),
    );
  });

  it("returns null when nothing is selected, so callers can spread it", () => {
    expect(facetMatch({})).toBeNull();
    expect(facetMatch({ category: [] })).toBeNull();
  });

  it("drops empty slugs rather than emitting a term that matches nothing", () => {
    expect(facetMatch({ category: ["crm", ""] })).toEqual({
      $and: [{ facets: { $in: ["cat:crm"] } }],
    });
  });

  it("deduplicates within a dimension", () => {
    expect(facetMatch({ category: ["crm", "crm"] })).toEqual({
      $and: [{ facets: { $in: ["cat:crm"] } }],
    });
  });
});

describe("facetFilter", () => {
  it("returns the terms a query selects, flattened", () => {
    expect(facetFilter({ category: ["crm"], industry: ["property"] })).toEqual([
      "cat:crm",
      "ind:property",
    ]);
  });
});

describe("parseFacet", () => {
  it("splits a term back into dimension and slug for rendering chips", () => {
    expect(parseFacet("cat:crm")).toEqual({ prefix: "cat", slug: "crm" });
    // A slug can contain a hyphen but never a colon, so the first colon splits.
    expect(parseFacet("type:complete-application")).toEqual({
      prefix: "type",
      slug: "complete-application",
    });
  });

  it("returns null for something that isn't a facet term", () => {
    expect(parseFacet("crm")).toBeNull();
    expect(parseFacet(":crm")).toBeNull();
  });
});
