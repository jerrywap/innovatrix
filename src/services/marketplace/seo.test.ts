import { describe, expect, it } from "vitest";
import { parseRecentlyViewed, pushRecentlyViewed } from "./recently-viewed";
import { robotsFor } from "./seo";

describe("robotsFor — §93", () => {
  const q = (overrides: Partial<Parameters<typeof robotsFor>[1]> = {}) =>
    robotsFor("/marketplace", { page: 1, ...overrides });

  it("indexes the plain listing", () => {
    expect(q()).toMatchObject({ index: true, follow: true, canonical: "/marketplace" });
  });

  it("indexes one or two filter dimensions — those are real, linkable pages", () => {
    expect(q({ category: ["crm"] }).index).toBe(true);
    expect(q({ category: ["crm"], technology: ["laravel"] }).index).toBe(true);
  });

  it("refuses to index three dimensions at once", () => {
    // Four dimensions with a dozen terms each is a combinatorial space in the
    // millions — a crawl trap, not a set of pages.
    const decision = q({ category: ["crm"], technology: ["laravel"], industry: ["retail"] });
    expect(decision.index).toBe(false);
    expect(decision.follow).toBe(true);
  });

  it("refuses to index a search result but still follows its links", () => {
    const decision = q({ q: "invoicing" });
    expect(decision).toMatchObject({ index: false, follow: true, canonical: "/marketplace" });
  });

  it("refuses to index a price-filtered slice", () => {
    expect(q({ minPrice: 10_000 }).index).toBe(false);
    expect(q({ maxPrice: 10_000 }).index).toBe(false);
  });

  it("indexes free, and spends a dimension on it rather than being exempt", () => {
    // Unlike an arbitrary price slice, "free CRM software" is a real query with
    // a real page behind it — but it still doubles the crawl space it joins.
    expect(q({ free: true }).index).toBe(true);
    expect(q({ free: true, category: ["crm"] }).index).toBe(true);
    expect(q({ free: true, category: ["crm"], technology: ["laravel"] }).index).toBe(false);
  });

  it("self-canonicalises page 2, rather than pointing it at page 1", () => {
    // Canonicalising page 5 to page 1 tells the crawler page 5's products do
    // not exist. `rel=prev/next` was retired in 2019, so this is what is left.
    const decision = q({ page: 5 });
    expect(decision.canonical).toBe("/marketplace?page=5");
    expect(decision).toMatchObject({ index: false, follow: true });
  });

  it("respects the base path of a landing page", () => {
    expect(robotsFor("/marketplace/category/crm", { page: 1 }).canonical).toBe(
      "/marketplace/category/crm",
    );
  });

  it("always explains itself", () => {
    for (const decision of [q(), q({ q: "x" }), q({ page: 3 }), q({ minPrice: 1 })]) {
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("recently viewed — the cookie is untrusted input", () => {
  it("parses a plain list", () => {
    expect(parseRecentlyViewed("atlas-crm,tenancy")).toEqual(["atlas-crm", "tenancy"]);
  });

  it("drops anything that is not a slug", () => {
    expect(parseRecentlyViewed("atlas-crm,<script>,../../etc,   ,UPPER,tenancy")).toEqual([
      "atlas-crm",
      "tenancy",
    ]);
  });

  it("survives an absent or empty cookie", () => {
    expect(parseRecentlyViewed(undefined)).toEqual([]);
    expect(parseRecentlyViewed("")).toEqual([]);
  });

  it("caps the list, so the cookie cannot be grown without bound", () => {
    const many = Array.from({ length: 200 }, (_, i) => `product-${i}`).join(",");
    expect(parseRecentlyViewed(many)).toHaveLength(8);
  });

  it("moves a re-visited product to the front instead of duplicating it", () => {
    // "Recently viewed" is a set ordered by recency, not a history log.
    expect(pushRecentlyViewed("a-one,b-two,c-three", "c-three")).toEqual([
      "c-three",
      "a-one",
      "b-two",
    ]);
  });

  it("ignores a slug that is not one", () => {
    expect(pushRecentlyViewed("a-one", "not a slug")).toEqual(["a-one"]);
  });
});
