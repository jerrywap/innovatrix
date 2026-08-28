import { describe, expect, it } from "vitest";
import {
  FILTER_KEYS,
  activeFilterCount,
  currencyMustBeInUrl,
  currencySwitchHref,
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

  it("ignores a catalogue in the query string", () => {
    /*
     * The trust boundary for the split. A catalogue is the surface the visitor is
     * standing on, decided by the route — if `?catalogue=template` worked here,
     * `/marketplace` would be a way to browse the template shop and the
     * separation would be advisory.
     */
    expect(parseMarketplaceQuery({ catalogue: "template" }).catalogue).toBe("script");
    expect(
      parseMarketplaceQuery({ catalogue: "script" }, { catalogue: "template" }).catalogue,
    ).toBe("template");
  });

  it("reads free=false as false, like every other query boolean", () => {
    expect(parseMarketplaceQuery({ free: "true" }).free).toBe(true);
    expect(parseMarketplaceQuery({ free: "false" }).free).toBe(false);
    expect(parseMarketplaceQuery({ free: "" }).free).toBeUndefined();
    expect(parseMarketplaceQuery({ free: "maybe" }).free).toBeUndefined();
  });

  it("counts free as a filter, so 'Clear all' can clear it", () => {
    // The list this reads has drifted once already — a dimension missing from it
    // renders a filter with no way back out.
    expect(FILTER_KEYS).toContain("free");
    expect(activeFilterCount({ free: "true" })).toBe(1);
  });

  it("requires the currency in the URL once free is on", () => {
    // "Free" is a bound on the price *in this currency*, so a shared link
    // without it shows a different set to somebody whose cookie differs.
    expect(currencyMustBeInUrl(parseMarketplaceQuery({ free: "true" }))).toBe(true);
    expect(currencyMustBeInUrl(parseMarketplaceQuery({}))).toBe(false);
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
    const base = {
      sort: "latest",
      page: 1,
      limit: 24,
      currency: "GBP",
      catalogue: "script",
    } as const;
    expect(currencyMustBeInUrl(base)).toBe(false);
    expect(currencyMustBeInUrl({ ...base, minPrice: 1000 })).toBe(true);
    expect(currencyMustBeInUrl({ ...base, maxPrice: 1000 })).toBe(true);
  });
});

describe("activeFilterCount", () => {
  it("counts terms rather than keys", () => {
    // "2 filters" is what a person would say about two categories, so that is what the drawer's
    // trigger says.
    expect(activeFilterCount({ category: ["crm", "property"] })).toBe(2);
    expect(activeFilterCount({ category: ["crm"], minPrice: "1000" })).toBe(2);
    expect(activeFilterCount({})).toBe(0);
  });

  it("ignores sort, page and currency", () => {
    // None of the three narrows the result set. A trigger badged "3" because somebody chose a sort
    // order and a currency would be telling the reader their grid is filtered when it is not.
    expect(activeFilterCount({ sort: "price_asc", page: "3", currency: "USD" })).toBe(0);
  });

  it("covers every dimension the parser accepts", () => {
    /*
     * The drift check, and the reason this list lives in one place.
     *
     * `FILTER_KEYS` had already been copied once and gone stale: vendor ticket 04 added the `vendor`
     * dimension and missed the copy behind "Clear all filters", so a vendor-only filter rendered a
     * view with no way out of it. This asserts against `parseMarketplaceQuery` itself, so the next
     * dimension fails here rather than silently going uncounted.
     */
    const raw = Object.fromEntries(FILTER_KEYS.map((key) => [key, "x"]));
    expect(activeFilterCount(raw)).toBe(FILTER_KEYS.length);

    const parsed = parseMarketplaceQuery({
      q: "crm",
      category: ["a"],
      industry: ["b"],
      technology: ["c"],
      productType: ["d"],
      vendor: ["e"],
      minPrice: "100",
      maxPrice: "200",
      customisable: "true",
    });

    /*
     * Every key the parser reads as a filter must be one this counts. The exceptions are the four
     * that do not narrow the result set, plus `raw` — the parser echoes its own input back under
     * that name, so it is the whole query rather than a dimension of it.
     *
     * `catalogue` is a sixth exception and a different kind. It *does* narrow the
     * result set, but it is not a filter: it comes from the page rather than the
     * query string, it never appears in a URL, and the rail cannot clear it.
     * Counting it would badge "1 filter" on every template page with nothing the
     * customer could press to remove it — which is the exact bug the `FILTER_KEYS`
     * comment records for `vendor`, in reverse.
     */
    const parsedFilterKeys = Object.entries(parsed)
      .filter(
        ([key]) => !["sort", "page", "limit", "currency", "raw", "catalogue"].includes(key),
      )
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

    for (const key of parsedFilterKeys) {
      expect(FILTER_KEYS as readonly string[], `${key} is parsed but not counted`).toContain(
        key,
      );
    }
  });
});

/**
 * The header currency switcher's href.
 *
 * The other control that changes this preference is the filter rail's chips, and
 * the two must produce the same URL — see `currencySwitchHref`'s docblock.
 */
describe("currencySwitchHref", () => {
  it("replaces the currency rather than appending a second one", () => {
    expect(currencySwitchHref("/marketplace?currency=GBP", "USD")).toBe(
      "/marketplace?currency=USD",
    );
  });

  it("keeps the price bounds, so the two switchers agree", () => {
    // They are re-denominated rather than cleared — 50,000 pence becomes 50,000
    // cents — which is exactly what the rail's chips already do.
    const href = currencySwitchHref("/marketplace?minPrice=5000&maxPrice=50000", "NGN");
    expect(href).toContain("minPrice=5000");
    expect(href).toContain("maxPrice=50000");
    expect(href).toContain("currency=NGN");
  });

  it("drops the page, because the set it indexed into has changed", () => {
    expect(currencySwitchHref("/marketplace?category=crm&page=7", "USD")).not.toContain("page");
  });

  it("refuses anything that is not a same-origin path", () => {
    // The value arrives as a request header and becomes an `href`. The proxy
    // overwrites it on every request; this is the second line of defence.
    for (const hostile of ["//evil.example", "https://evil.example/", "evil", ""]) {
      expect(currencySwitchHref(hostile, "USD")).toBe("/?currency=USD");
    }
    expect(currencySwitchHref(null, "USD")).toBe("/?currency=USD");
  });

  it("works on a path with no query at all", () => {
    expect(currencySwitchHref("/sell", "USD")).toBe("/sell?currency=USD");
  });
});
