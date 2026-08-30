import { describe, expect, it } from "vitest";
import {
  buildProductFacets,
  facetFilter,
  facetMatch,
  parseFacet,
  withAncestors,
} from "./models/catalog";

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

  /**
   * Vendor ticket 04. A fifth dimension in the same flattened array, because that
   * array is the only thing making faceted filtering indexable — MongoDB refuses a
   * compound index across parallel arrays.
   */
  it("carries the vendor as a fifth dimension", () => {
    expect(
      buildProductFacets({ categorySlugs: ["crm"], vendorSlug: "northwind-labs" }),
    ).toEqual(["cat:crm", "vend:northwind-labs"]);
  });

  it("omits the vendor term for a first-party product", () => {
    // Absent means first-party, and that is the only meaning absence carries — no
    // house vendor row, no sentinel slug to match against.
    expect(buildProductFacets({ categorySlugs: ["crm"] })).toEqual(["cat:crm"]);
  });

  it("cannot collide a vendor slug with a taxonomy slug of the same name", () => {
    expect(
      buildProductFacets({ categorySlugs: ["northwind"], vendorSlug: "northwind" }),
    ).toEqual(["cat:northwind", "vend:northwind"]);
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

  it("ANDs a vendor against a category, and ORs two vendors", () => {
    // "CRM tools made by Northwind" is an intersection; "made by Northwind or
    // Southwind" is a union. Same rule as every other dimension.
    expect(facetMatch({ category: ["crm"], vendor: "northwind-labs" })).toEqual({
      $and: [{ facets: { $in: ["cat:crm"] } }, { facets: { $in: ["vend:northwind-labs"] } }],
    });

    expect(facetMatch({ vendor: ["northwind-labs", "southwind"] })).toEqual({
      $and: [{ facets: { $in: ["vend:northwind-labs", "vend:southwind"] } }],
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

describe("withAncestors", () => {
  const tree = new Map([
    ["crm", "business-operations"],
    ["erp", "business-operations"],
  ]);

  it("adds each category's parent, so a parent is a real facet term", () => {
    // Without this the parent's landing page counts zero products and the rail
    // greys it out — every parent dead on arrival.
    expect(withAncestors(["crm"], tree).sort()).toEqual(["business-operations", "crm"]);
  });

  it("names a shared parent once, so its count is not doubled", () => {
    // A product under two children of one parent belongs to that parent once.
    // `$unwind` over `facets` counts occurrences, so a duplicate here is a
    // wrong number on the rail rather than a wrong result set.
    expect(withAncestors(["crm", "erp"], tree).sort()).toEqual([
      "business-operations",
      "crm",
      "erp",
    ]);
  });

  it("leaves a root alone", () => {
    expect(withAncestors(["finance"], tree)).toEqual(["finance"]);
  });

  it("ignores a term that is its own parent", () => {
    // Not reachable through the service, which refuses it — but this function is
    // the one that would loop, and it is cheaper to be total than to rely on
    // the caller.
    expect(withAncestors(["loop"], new Map([["loop", "loop"]]))).toEqual(["loop"]);
  });
});
