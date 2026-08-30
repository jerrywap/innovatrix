import { describe, expect, it } from "vitest";
import {
  CATALOGUE_SURFACE,
  categoryLandingPath,
  isReservedCatalogueSegment,
  productCatalogueFilter,
  productHref,
  taxonomyScopeFilter,
} from "./catalogue";

/**
 * The URL table, and the two rules that read it.
 *
 * Pure functions over a literal, so this is a unit test in the plain sense. It
 * exists because each of these is the *single* spelling of a URL that several
 * surfaces have to agree on, and the failure when they disagree is a page that
 * renders rather than one that errors.
 */

describe("productHref", () => {
  it("is one builder for both catalogues", () => {
    // `/details`, not `/marketplace` — a product and a category cannot both own
    // `/marketplace/[slug]`, so the product moved and the category took the
    // segment. Still one path for both catalogues: the seam is for the day
    // templates get their own domain, and that has not happened.
    expect(productHref("atlas-crm")).toBe("/details/atlas-crm");
    expect(productHref("atlas-crm", "template")).toBe("/details/atlas-crm");
  });

  it("agrees with the table rather than hardcoding the path", () => {
    expect(productHref("x")).toBe(`${CATALOGUE_SURFACE.script.productPath}/x`);
  });
});

describe("categoryLandingPath", () => {
  it("gives a child two segments — the URL is the hierarchy", () => {
    expect(
      categoryLandingPath({
        slug: "crm",
        catalogue: "script",
        parentSlug: "business-operations",
      }),
    ).toBe("/marketplace/business-operations/crm");
  });

  it("gives a root one", () => {
    expect(categoryLandingPath({ slug: "finance", catalogue: "script" })).toBe(
      "/marketplace/finance",
    );
  });

  it("sends a template-scoped term to /templates", () => {
    expect(
      categoryLandingPath({
        slug: "admin-dashboards",
        catalogue: "template",
        parentSlug: "admin-application-ui",
      }),
    ).toBe("/templates/admin-application-ui/admin-dashboards");
  });

  it("keeps a `both` term's single home on /marketplace", () => {
    // Two landing pages for one term would be duplicate content generated on
    // purpose. The term's own scope decides, never the product you arrived from.
    expect(categoryLandingPath({ slug: "finance", catalogue: "both" })).toBe(
      "/marketplace/finance",
    );
  });

  it("falls back to one segment when either field is missing", () => {
    /*
     * What a `ProductDetail` cached before these fields existed hands it. Safe
     * rather than merely quiet: `/marketplace/[parent]` answers a *child* at that
     * depth with a 308 up to its real two-segment address, so a stale breadcrumb
     * lands on the right page instead of a 404.
     */
    expect(categoryLandingPath({ slug: "crm" })).toBe("/marketplace/crm");
  });
});

describe("isReservedCatalogueSegment", () => {
  /**
   * The collision is silent, which is the whole reason for a guard.
   *
   * Next resolves a static segment before a dynamic one, so a category slugged
   * `category` does not error — `/marketplace/category` keeps reaching the
   * existing route, and the category's own landing page is simply unreachable
   * forever, with a sitemap entry pointing at it.
   */
  it("refuses the segments that sit beside a category", () => {
    expect(isReservedCatalogueSegment("category")).toBe(true);
    expect(isReservedCatalogueSegment("industry")).toBe(true);
  });

  it("allows `page`, which is a file name and not a route segment", () => {
    expect(isReservedCatalogueSegment("page")).toBe(false);
    expect(isReservedCatalogueSegment("categories")).toBe(false);
    expect(isReservedCatalogueSegment("crm")).toBe(false);
  });
});

describe("the two scope filters", () => {
  /**
   * These are opposites and it is easy to reach for the wrong one: a **product**
   * with no catalogue is a script, while a **term** with no catalogue belongs to
   * both. Asserting them side by side is the point.
   */
  it("treats a product's missing catalogue as a script", () => {
    expect(productCatalogueFilter("script")).toEqual({ catalogue: { $in: ["script", null] } });
    expect(productCatalogueFilter("template")).toEqual({ catalogue: "template" });
    expect(productCatalogueFilter("all")).toEqual({});
  });

  it("gives a term's scope its own catalogue plus `both`", () => {
    // The reason a template-only industry is absent from a `script`-scoped index —
    // and why the page that reads it has to pass a scope rather than default to
    // `"all"`.
    expect(taxonomyScopeFilter("script")).toEqual({
      catalogue: { $in: ["script", "both", null] },
    });
    expect(taxonomyScopeFilter("template")).toEqual({
      catalogue: { $in: ["template", "both", null] },
    });
    expect(taxonomyScopeFilter("all")).toEqual({});
  });
});
