import { describe, expect, it } from "vitest";
import {
  buildMarketplacePipeline,
  dimensionsWithHonestCounts,
  MAX_LIMIT,
  MAX_PAGE,
  queryKey,
  toFacetCounts,
  type MarketplaceQueryInput,
} from "./pipeline";

/**
 * The pipeline's shape, asserted without a database.
 *
 * Every case here is a decision that fails **silently** if it regresses: wrong
 * rows with no error, wrong counts with no error, a page that duplicates rows
 * and still looks right. A test that needed MongoDB running would be skipped
 * exactly when it mattered.
 */

const base: MarketplaceQueryInput = {
  sort: "latest",
  page: 1,
  limit: 24,
  currency: "GBP",
  catalogue: "script" as const,
};

const query = (overrides: Partial<MarketplaceQueryInput> = {}) =>
  buildMarketplacePipeline({ ...base, ...overrides });

const stage = (pipeline: Record<string, unknown>[], name: string, nth = 0) =>
  pipeline.filter((s) => name in s)[nth]! as Record<string, Record<string, unknown>>;

describe("stage one — what the index sees", () => {
  it("always filters to published and not-deleted", () => {
    const match = stage(query(), "$match").$match!;
    expect(match.status).toBe("published");
    // A soft-deleted product is still `status: "published"`, so this is not
    // redundant — it is the second half of "public means public".
    expect(match.deletedAt).toBeNull();
  });

  it("ORs within a dimension and ANDs across them", () => {
    const match = stage(
      query({ category: ["crm", "property"], technology: ["laravel"] }),
      "$match",
    ).$match!;

    // The regression guard: `$all` here returns zero rows for two categories,
    // with no error, because it asks for products filed under both.
    expect(match.$and).toEqual([
      { facets: { $in: ["cat:crm", "cat:property"] } },
      { facets: { $in: ["tech:laravel"] } },
    ]);
    expect(JSON.stringify(match)).not.toContain("$all");
  });

  it("puts $text in the first $match, where MongoDB requires it", () => {
    const pipeline = query({ q: "invoicing" });
    const first = pipeline[0]! as { $match: Record<string, unknown> };

    expect(first.$match.$text).toEqual({ $search: "invoicing" });
    // A `$text` in any later stage is a hard error, not a slow query.
    for (const later of pipeline.slice(1)) {
      expect(JSON.stringify(later)).not.toContain("$text");
    }
  });

  it("distinguishes customisable=false from unset", () => {
    expect(stage(query(), "$match").$match!["customization.available"]).toBeUndefined();
    expect(
      stage(query({ customisable: true }), "$match").$match!["customization.available"],
    ).toBe(true);
    // `$ne: true` rather than `false`, so a product that never set the field
    // counts as not customisable rather than vanishing from both filters.
    expect(
      stage(query({ customisable: false }), "$match").$match!["customization.available"],
    ).toEqual({ $ne: true });
  });
});

describe("the catalogue split", () => {
  const matchOf = (overrides: Partial<MarketplaceQueryInput>) =>
    (stage(query(overrides), "$match") as { $match: Record<string, unknown> }).$match;

  it("filters templates by equality", () => {
    expect(matchOf({ catalogue: "template" }).catalogue).toEqual("template");
  });

  it("filters scripts with an $in that also matches a missing field", () => {
    /*
     * Asserted as `$in`, by name, because the shape is the point and it is the
     * thing somebody will later be tempted to "tidy" into `$ne: "template"` or
     * `"script"`.
     *
     * `$ne` on the middle key of `{ status, catalogue, facets }` strips the index
     * bounds off `facets`, which is what stage one exists to preserve — it would
     * slow every marketplace query, not just this one. A bare `"script"` would
     * empty the catalogue for any document the backfill has not reached, with no
     * error: a filter bug that looks like an empty database.
     */
    expect(matchOf({ catalogue: "script" }).catalogue).toEqual({ $in: ["script", null] });
  });

  it("adds no catalogue predicate at all for both", () => {
    expect(matchOf({ catalogue: "all" }).catalogue).toBeUndefined();
  });

  it("keeps the catalogue in stage one, where an index can use it", () => {
    // Not in the post-`$addFields` match: that one cannot use an index, which is
    // the whole reason the price filter is separate from it.
    const pipeline = query({ catalogue: "template" });
    const first = pipeline.findIndex((s) => "$match" in s);
    const addFieldsAt = pipeline.findIndex((s) => "$addFields" in s);
    expect(first).toBeLessThan(addFieldsAt);
  });
});

describe("the active price", () => {
  it("wraps $first in $ifNull, because an empty $filter yields missing", () => {
    const fields = stage(query(), "$addFields").$addFields!;
    const active = fields.activePrice as Record<string, unknown>;

    // Without the wrapper, `{ $ne: [activePrice, null] }` is TRUE for a product
    // with no price in this currency — and the card renders £0.00 or NaN.
    expect(active.$ifNull).toBeDefined();
    expect((active.$ifNull as unknown[])[1]).toBeNull();
  });

  it("derives hasPrice from a count, not from a comparison against null", () => {
    const fields = stage(query(), "$addFields").$addFields!;
    expect(JSON.stringify(fields.hasPrice)).toContain("$size");
  });

  it("filters on the currency the viewer actually chose", () => {
    for (const currency of ["GBP", "USD", "NGN"] as const) {
      const fields = stage(query({ currency }), "$addFields").$addFields!;
      expect(JSON.stringify(fields.activePrice)).toContain(`"${currency}"`);
    }
  });

  it("only computes textScore when there is a query to score", () => {
    expect(stage(query(), "$addFields").$addFields!.textScore).toBeUndefined();
    expect(stage(query({ q: "crm" }), "$addFields").$addFields!.textScore).toEqual({
      $meta: "textScore",
    });
  });
});

describe("the price range filter", () => {
  it("is absent when no bounds are set", () => {
    // Two `$match` stages would mean an extra pass for nothing.
    expect(query().filter((s) => "$match" in s)).toHaveLength(1);
  });

  it("applies after $addFields, so the facet index keeps its bounds", () => {
    const pipeline = query({ minPrice: 10_000, maxPrice: 50_000 });
    const addFieldsAt = pipeline.findIndex((s) => "$addFields" in s);
    const secondMatchAt = pipeline.findLastIndex((s) => "$match" in s);

    expect(secondMatchAt).toBeGreaterThan(addFieldsAt);
    expect((pipeline[secondMatchAt]! as { $match: Record<string, unknown> }).$match).toEqual({
      "activePrice.amount": { $gte: 10_000, $lte: 50_000 },
    });
  });

  it("accepts a lower bound alone", () => {
    const pipeline = query({ minPrice: 10_000 });
    const last = pipeline.findLastIndex((s) => "$match" in s);
    expect((pipeline[last]! as { $match: Record<string, unknown> }).$match).toEqual({
      "activePrice.amount": { $gte: 10_000 },
    });
  });

  it("filters free as a bound on the same field, not a separate mechanism", () => {
    const pipeline = query({ free: true });
    const last = pipeline.findLastIndex((s) => "$match" in s);
    expect((pipeline[last]! as { $match: Record<string, unknown> }).$match).toEqual({
      "activePrice.amount": { $lte: 0 },
    });
  });

  it("lets free win over a numeric range rather than intersecting the two", () => {
    // `?free=true&maxPrice=50000` is a contradiction the URL can express and
    // nobody means. Intersecting would silently produce `$lte: 0, $lte: 50000`.
    const pipeline = query({ free: true, minPrice: 10_000, maxPrice: 50_000 });
    const last = pipeline.findLastIndex((s) => "$match" in s);
    expect((pipeline[last]! as { $match: Record<string, unknown> }).$match).toEqual({
      "activePrice.amount": { $lte: 0 },
    });
  });

  it("adds no stage for free:false, so 'not free' is not a filter", () => {
    const pipeline = query({ free: false });
    // Only stage one matches; there is no second `$match`.
    expect(pipeline.filter((s) => "$match" in s)).toHaveLength(1);
  });
});

describe("sorting", () => {
  const sortOf = (overrides: Partial<MarketplaceQueryInput>) => {
    const facet = stage(query(overrides), "$facet").$facet as unknown as {
      rows: Record<string, unknown>[];
    };
    return (facet.rows[0]! as { $sort: Record<string, unknown> }).$sort;
  };

  it.each(["latest", "popular", "price_asc", "price_desc", "relevance"] as const)(
    "%s ends with _id, so pages cannot duplicate or drop rows",
    (sort) => {
      const keys = Object.keys(sortOf({ sort, ...(sort === "relevance" ? { q: "x" } : {}) }));
      expect(keys[keys.length - 1]).toBe("_id");
    },
  );

  it("parks price-on-request at the end of both price sorts", () => {
    // Not just ascending: with `-1` on a missing field they would lead the
    // descending sort too.
    expect(Object.keys(sortOf({ sort: "price_asc" }))[0]).toBe("hasPrice");
    expect(Object.keys(sortOf({ sort: "price_desc" }))[0]).toBe("hasPrice");
    expect(sortOf({ sort: "price_asc" }).hasPrice).toBe(-1);
    expect(sortOf({ sort: "price_desc" }).hasPrice).toBe(-1);
  });

  it("falls back to latest when relevance is asked for without a query", () => {
    // `$meta: "textScore"` in a pipeline with no `$text` is an error, not a
    // no-op — and "sort by relevance" is a reachable URL with no `q`.
    const sort = sortOf({ sort: "relevance" });
    expect(JSON.stringify(sort)).not.toContain("textScore");
    expect(sort).toEqual({ publishedAt: -1, _id: -1 });
  });
});

describe("bounds", () => {
  it("clamps the page, because $skip beyond it is a scan and a crawl trap", () => {
    const facet = stage(query({ page: 9_999 }), "$facet").$facet as unknown as {
      rows: Record<string, unknown>[];
    };
    const skip = (facet.rows[1]! as { $skip: number }).$skip;
    expect(skip).toBe((MAX_PAGE - 1) * 24);
  });

  it("clamps the page size", () => {
    const facet = stage(query({ limit: 5_000 }), "$facet").$facet as unknown as {
      rows: Record<string, unknown>[];
    };
    expect((facet.rows[2]! as { $limit: number }).$limit).toBe(MAX_LIMIT);
  });

  it("never projects the whole document", () => {
    const facet = stage(query(), "$facet").$facet as unknown as {
      rows: Record<string, unknown>[];
    };
    const project = (facet.rows[3]! as { $project: Record<string, unknown> }).$project;

    // §94 — a grid must not pull descriptions, demo config or licence packages.
    expect(project.description).toBeUndefined();
    expect(project.demo).toBeUndefined();
    expect(project.licencePackages).toBeUndefined();
    expect(project.testingChecklist).toBeUndefined();
    expect(project.slug).toBe(1);
  });

  it("gets rows, counts and the total from one $facet", () => {
    const facet = stage(query(), "$facet").$facet!;
    expect(Object.keys(facet).sort()).toEqual(["facetCounts", "rows", "total"]);
    // One round trip is the acceptance criterion, so more than one `$facet`
    // would be the regression.
    expect(query().filter((s) => "$facet" in s)).toHaveLength(1);
  });
});

describe("toFacetCounts", () => {
  it("splits the prefix back into a dimension", () => {
    expect(
      toFacetCounts([
        { _id: "cat:crm", count: 4 },
        { _id: "tech:laravel", count: 2 },
        { _id: "type:complete-application", count: 9 },
      ]),
    ).toEqual([
      { dimension: "category", slug: "crm", count: 4 },
      { dimension: "technology", slug: "laravel", count: 2 },
      { dimension: "productType", slug: "complete-application", count: 9 },
    ]);
  });

  it("drops a facet string it does not recognise", () => {
    // Stored data can outrun the code — a stale prefix should disappear from
    // the rail, not crash it.
    expect(
      toFacetCounts([
        { _id: "colour:blue", count: 3 },
        { _id: "nope", count: 1 },
      ]),
    ).toEqual([]);
  });
});

describe("dimensionsWithHonestCounts", () => {
  /**
   * Every dimension, named rather than counted. The count used to be `4`, which
   * meant adding the vendor dimension failed here with "expected 5 to be 4" — a
   * true statement that says nothing about what is wrong. Naming them makes the
   * failure read as "vendor is missing" instead.
   */
  it("shows counts everywhere when nothing is selected", () => {
    expect([...dimensionsWithHonestCounts(base)].sort()).toEqual([
      "category",
      "industry",
      "productType",
      "technology",
      "vendor",
    ]);
  });

  it("hides the count on a dimension that is already filtering", () => {
    // Within a dimension the terms are OR'd, so ticking a second category
    // *widens* the set — any number shown next to it would be smaller than
    // what clicking it actually gives.
    const honest = dimensionsWithHonestCounts({ ...base, category: ["crm"] });
    expect(honest.has("category")).toBe(false);
    expect(honest.has("technology")).toBe(true);
  });

  it("hides the vendor count once a vendor is selected", () => {
    const honest = dimensionsWithHonestCounts({ ...base, vendor: ["northwind-labs"] });
    expect(honest.has("vendor")).toBe(false);
    expect(honest.has("category")).toBe(true);
  });
});

/**
 * `{ counts: false }` — the shape the append path reads.
 *
 * Same class of failure as everything above: silently wrong rows, no error. And
 * one extra hazard specific to this option — `getCardsBySlug` reuses the *default*
 * pipeline with `.slice(1)`, so a change that reordered the default stages would
 * give the recently-viewed rail somebody else's filters, in a different file, with
 * nothing to connect the two.
 */
describe("rows-only, for appending a page", () => {
  const rowsOnly = (overrides: Partial<MarketplaceQueryInput> = {}) =>
    buildMarketplacePipeline({ ...base, ...overrides }, { counts: false });

  it("returns the rows flattened, with no $facet", () => {
    const pipeline = rowsOnly();
    expect(pipeline.some((stage) => "$facet" in stage)).toBe(false);
    // Flattened means the aggregation yields card documents rather than one
    // wrapper object — the reader maps straight over the result.
    expect(Object.keys(pipeline.at(-1)!)).toEqual(["$project"]);
  });

  it("keeps the filtering stages identical to the counted version", () => {
    // The rows must be *the same rows*. If the two paths could filter differently,
    // scrolling would show products a click on "2" would not.
    const counted = query();
    const flat = rowsOnly();
    const upToFacet = counted.slice(
      0,
      counted.findIndex((stage) => "$facet" in stage),
    );

    expect(flat.slice(0, upToFacet.length)).toEqual(upToFacet);
  });

  it("still skips and limits, so page three is page three", () => {
    const pipeline = rowsOnly({ page: 3, limit: 12 });
    expect(stage(pipeline, "$skip").$skip).toBe(24);
    expect(stage(pipeline, "$limit").$limit).toBe(12);
  });

  it("computes no counts, because they cannot have changed", () => {
    // Appending narrows nothing, so the facet counts and the total still describe
    // the same set they described on the first render. Recomputing them would be an
    // `$unwind` plus a `$group` to reproduce numbers already on the screen.
    const pipeline = rowsOnly();
    expect(pipeline.some((stage) => "$unwind" in stage || "$group" in stage)).toBe(false);
  });

  it("leaves the default shape untouched, which `getCardsBySlug` depends on", () => {
    // `.slice(1)` there drops stage one and reuses the rest, so the default must
    // still be [$match, $addFields, …price, $facet] with the facet last.
    const pipeline = query();
    expect(Object.keys(pipeline[0]!)).toEqual(["$match"]);
    expect(Object.keys(pipeline[1]!)).toEqual(["$addFields"]);
    expect(Object.keys(pipeline.at(-1)!)).toEqual(["$facet"]);
  });
});

/**
 * The cache key — a decision whose failure is invisible.
 *
 * A wrong key never shows a wrong page. It shows the *right* page, having paid
 * full price for it, while the cache fills with entries nobody will read again.
 * So there is nothing to notice, which is why this needs assertions rather than
 * a look at the screen.
 *
 * `JSON.stringify` is the comparison because key **order** is part of what is
 * being fixed: `toEqual` passes on two objects with the same entries in different
 * orders, and two objects with the same entries in different orders are two cache
 * entries.
 */
describe("queryKey", () => {
  const key = (overrides: Partial<MarketplaceQueryInput> & Record<string, unknown> = {}) =>
    JSON.stringify(queryKey({ ...base, ...overrides } as MarketplaceQueryInput));

  it("drops everything that does not decide the rows", () => {
    // The actual bug: callers pass a `ParsedMarketplaceQuery`, which carries the
    // whole query string in `raw` so the filter rail can build links from it. A
    // single `utm_source` meant campaign traffic — the traffic most worth serving
    // fast — could never hit the cache.
    expect(key({ raw: { utm_source: "newsletter", q: undefined } })).toBe(key());
  });

  it("is insensitive to the order the caller built the object in", () => {
    const a = queryKey({ ...base, category: ["crm"], industry: ["retail"] });
    const b = queryKey({ industry: ["retail"], category: ["crm"], ...base });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("treats a term list as the set it becomes", () => {
    // `facetMatch` builds an `$in` and de-duplicates, so these three produce a
    // byte-identical pipeline — which is exactly what makes normalising safe.
    const canonical = key({ category: ["crm", "erp"] });
    expect(key({ category: ["erp", "crm"] })).toBe(canonical);
    expect(key({ category: ["crm", "erp", "crm"] })).toBe(canonical);
  });

  it("treats an empty list as no filter at all", () => {
    // `parseMarketplaceQuery` returns `[]` for an absent dimension, so without
    // this every listing URL keys differently from the one the landing pages build.
    expect(key({ category: [], industry: [], technology: [], vendor: [] })).toBe(key());
  });

  it("keeps every field that does change the result", () => {
    // The other half. A key that collapses two different questions into one entry
    // would serve the wrong rows, which is the failure worth having a test for.
    const canonical = key();
    for (const different of [
      { currency: "NGN" as const },
      { page: 2 },
      { limit: 12 },
      { sort: "popular" as const },
      { catalogue: "template" as const },
      { free: true },
      { customisable: true },
      { minPrice: 1000 },
      { maxPrice: 9000 },
      { productType: "saas" },
      { category: ["crm"] },
      { industry: ["retail"] },
      { technology: ["laravel"] },
      { vendor: ["acme"] },
      { q: "crm" },
    ]) {
      expect(key(different), JSON.stringify(different)).not.toBe(canonical);
    }
  });
});
