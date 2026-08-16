import { describe, expect, it } from "vitest";
import {
  currencyMustBeInUrl,
  marketplaceHref,
  parseMarketplaceQuery,
  toggleTerm,
} from "./query";
import { MAX_LIMIT, MAX_PAGE } from "./pipeline";

/**
 * The URL parser, which is the trust boundary for the whole marketplace.
 *
 * Everything it reads is attacker-controlled, and §94 forbids unbounded reads —
 * so the clamps here are not defensive tidiness, they are the enforcement.
 */

describe("parseMarketplaceQuery — untrusted input", () => {
  it("drops anything that is not a slug", () => {
    const query = parseMarketplaceQuery({
      category: ["crm", "Not A Slug", "../etc/passwd", "property"],
    });
    expect(query.category).toEqual(["crm", "property"]);
  });

  it("deduplicates and caps the terms per dimension", () => {
    const query = parseMarketplaceQuery({
      technology: ["laravel", "laravel", ...Array.from({ length: 30 }, (_, i) => `tech-${i}`)],
    });
    expect(query.technology?.filter((t) => t === "laravel")).toHaveLength(1);
    expect(query.technology!.length).toBeLessThanOrEqual(12);
  });

  it("clamps the page and page size", () => {
    expect(parseMarketplaceQuery({ page: "99999" }).page).toBe(MAX_PAGE);
    expect(parseMarketplaceQuery({ page: "-4" }).page).toBe(1);
    expect(parseMarketplaceQuery({ page: "banana" }).page).toBe(1);
    expect(parseMarketplaceQuery({ limit: "10000" }).limit).toBe(MAX_LIMIT);
  });

  it("reads customisable=false as false", () => {
    // `z.coerce.boolean()` is `Boolean(input)`, so the *string* "false" is true
    // — and the filter would return the opposite rows, with no error.
    expect(parseMarketplaceQuery({ customisable: "false" }).customisable).toBe(false);
    expect(parseMarketplaceQuery({ customisable: "0" }).customisable).toBe(false);
    expect(parseMarketplaceQuery({ customisable: "true" }).customisable).toBe(true);
    expect(parseMarketplaceQuery({ customisable: "" }).customisable).toBeUndefined();
    expect(parseMarketplaceQuery({ customisable: "maybe" }).customisable).toBeUndefined();
  });

  it("ignores a negative or nonsense price", () => {
    expect(parseMarketplaceQuery({ minPrice: "-100" }).minPrice).toBeUndefined();
    expect(parseMarketplaceQuery({ maxPrice: "abc" }).maxPrice).toBeUndefined();
    expect(parseMarketplaceQuery({ minPrice: "29999" }).minPrice).toBe(29_999);
    // Rounded, because minor units are integers.
    expect(parseMarketplaceQuery({ minPrice: "299.7" }).minPrice).toBe(300);
  });

  it("falls back on an unknown sort rather than passing it through", () => {
    expect(parseMarketplaceQuery({ sort: "; drop products" }).sort).toBe("latest");
  });

  it("defaults to relevance when searching and latest when browsing", () => {
    expect(parseMarketplaceQuery({ q: "invoicing" }).sort).toBe("relevance");
    expect(parseMarketplaceQuery({}).sort).toBe("latest");
    // An explicit choice still wins.
    expect(parseMarketplaceQuery({ q: "invoicing", sort: "price_asc" }).sort).toBe("price_asc");
  });

  it("lets a landing page force its own term", () => {
    // Otherwise /marketplace/category/crm is just a second /marketplace.
    const query = parseMarketplaceQuery(
      { category: ["property"] },
      { forced: { category: ["crm"] } },
    );
    expect(query.category).toEqual(["crm"]);
  });
});

describe("marketplaceHref", () => {
  it("preserves the filters it was not asked to change", () => {
    const href = marketplaceHref(
      "/marketplace",
      { category: ["crm"], technology: ["laravel"] },
      { sort: "price_asc" },
    );
    expect(href).toContain("category=crm");
    expect(href).toContain("technology=laravel");
    expect(href).toContain("sort=price_asc");
  });

  it("resets the page whenever the result set changes", () => {
    // Page 7 of a set that now has two pages renders an empty grid, which reads
    // as "no results for that filter".
    const href = marketplaceHref(
      "/marketplace",
      { page: "7", category: ["crm"] },
      {
        technology: ["laravel"],
      },
    );
    expect(href).not.toContain("page=");
  });

  it("keeps an explicit page", () => {
    const href = marketplaceHref("/marketplace", { category: ["crm"] }, { page: 3 });
    expect(href).toContain("page=3");
    expect(href).toContain("category=crm");
  });

  it("omits page=1, so page one has one address", () => {
    // Two URLs for the same content is a duplicate-content problem (§93) and a
    // cache key that splits for nothing.
    expect(marketplaceHref("/marketplace", {}, { page: 1 })).toBe("/marketplace");
  });

  it("removes a parameter rather than setting it empty", () => {
    const href = marketplaceHref("/marketplace", { q: "crm" }, { q: "" });
    expect(href).toBe("/marketplace");
  });

  it("drops a false boolean instead of writing customisable=false", () => {
    const href = marketplaceHref(
      "/marketplace",
      { customisable: "true" },
      {
        customisable: false,
      },
    );
    expect(href).not.toContain("customisable");
  });

  it("round-trips through the parser", () => {
    // The linkability criterion, as a property: what the URL builder writes,
    // the parser must read back identically.
    const original = parseMarketplaceQuery({
      category: ["crm", "property"],
      technology: ["laravel"],
      customisable: "true",
      minPrice: "10000",
      sort: "price_asc",
      page: "3",
    });

    const href = marketplaceHref("/marketplace", original.raw, {});
    const params = new URL(href, "https://x.test").searchParams;
    const roundTripped = parseMarketplaceQuery({
      category: params.getAll("category"),
      technology: params.getAll("technology"),
      customisable: params.get("customisable") ?? undefined,
      minPrice: params.get("minPrice") ?? undefined,
      sort: params.get("sort") ?? undefined,
      page: params.get("page") ?? undefined,
    });

    expect(roundTripped.category).toEqual(original.category);
    expect(roundTripped.technology).toEqual(original.technology);
    expect(roundTripped.customisable).toBe(original.customisable);
    expect(roundTripped.minPrice).toBe(original.minPrice);
    expect(roundTripped.sort).toBe(original.sort);
    expect(roundTripped.page).toBe(original.page);
  });
});

describe("toggleTerm", () => {
  it("adds a term that is not selected and removes one that is", () => {
    expect(toggleTerm({ category: ["crm"] }, "category", "property")).toEqual({
      category: ["crm", "property"],
    });
    expect(toggleTerm({ category: ["crm", "property"] }, "category", "crm")).toEqual({
      category: ["property"],
    });
  });
});

describe("currencyMustBeInUrl", () => {
  it("is true exactly when a price bound is active", () => {
    // "Under 50,000" means nothing without saying 50,000 of what — a URL with a
    // bound and no currency gives a different result set to a viewer whose
    // cookie says something else.
    const base = { sort: "latest", page: 1, limit: 24, currency: "GBP" } as const;
    expect(currencyMustBeInUrl(base)).toBe(false);
    expect(currencyMustBeInUrl({ ...base, minPrice: 1000 })).toBe(true);
    expect(currencyMustBeInUrl({ ...base, maxPrice: 1000 })).toBe(true);
  });
});
