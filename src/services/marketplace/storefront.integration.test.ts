import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * The vendor storefront — vendor ticket 11.
 *
 * The interesting cases are all **absences**: a storefront exists only for a verified vendor
 * with at least one published product, and every other state must be indistinguishable from
 * "no such vendor". A page that said "this vendor is suspended" would publish a decision the
 * vendor never agreed to us publishing.
 *
 * These call `loadVendorProfile`, the uncached half. A `"use cache"` function throws under vitest
 * (`cacheTag()` needs the `cacheComponents` config), and the split exists so the rules are
 * testable rather than only the caching being right.
 *
 * The sitemap half matters for the same reason `sitemap.test.ts` exists: a sitemap listing a
 * URL that 404s is a contradiction a crawler resolves by trusting neither, and the conditions
 * therefore have to match the page's exactly.
 */

let mongoose: typeof import("mongoose").default;
let storefront: typeof import("./storefront");
let catalog: typeof import("@/lib/db/models/catalog");
let vendors: typeof import("@/lib/db/models/vendors");
let taxonomy: typeof import("@/lib/db/models/catalog");

const VENDOR = "8a00c46f6c887b38e2f0e0a1";
const OTHER = "8a00c46f6c887b38e2f0e0a2";

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "storefront_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  storefront = await import("./storefront");
  catalog = await import("@/lib/db/models/catalog");
  vendors = await import("@/lib/db/models/vendors");
  taxonomy = catalog;

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await catalog.Product.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await taxonomy.Taxonomy.deleteMany({});
  await vendors.StorefrontSettings.deleteMany({});
});

async function vendor(
  overrides: Record<string, unknown> = {},
  id = VENDOR,
  slug = "northwind",
) {
  return vendors.Vendor.create({
    _id: id,
    displayName: "Northwind Labs",
    slug,
    contactEmail: "ada@northwind.test",
    country: "GB",
    pitch: "Dispatch tooling for distributors.",
    appliedAt: new Date(),
    status: "verified",
    verifiedAt: new Date("2026-02-01"),
    verification: {
      identity: { status: "approved", decidedAt: new Date() },
      business: { status: "pending" },
    },
    profile: { summary: "We build dispatch tooling.", websiteUrl: "https://northwind.test" },
    ...overrides,
  });
}

async function published(
  vendorId = VENDOR,
  slug = "northwind-dispatch",
  overrides: Record<string, unknown> = {},
) {
  return catalog.Product.create({
    name: "Northwind Dispatch",
    slug,
    summary: "Dispatch and route planning.",
    status: "published",
    publishedAt: new Date(),
    vendorId,
    vendorSlug: "northwind",
    vendorName: "Northwind Labs",
    // No `hasPrice`/`activePrice`: both are computed by the marketplace pipeline's
    // `$addFields` and are not fields on `Product` — which is exactly the mistake the first
    // version of `storefront.ts` made, and the reason the grid goes through that pipeline.
    prices: [{ currency: "GBP", amount: 29_900 }],
    ...overrides,
  });
}

describe("who gets a storefront", () => {
  it("builds one for a verified vendor with a published product", async () => {
    await vendor();
    await published();

    const page = await storefront.loadVendorProfile("northwind");

    expect(page).not.toBeNull();
    expect(page!.displayName).toBe("Northwind Labs");
    // Identity only — "business verified" is about whether we may send them money, which is
    // none of a buyer's business.
    expect(page!.identityVerified).toBe(true);
    expect(page!.sellingSince).toEqual(new Date("2026-02-01"));
  });

  it("gives an unverified vendor nothing", async () => {
    await vendor({ status: "applied" });
    await published();

    expect(await storefront.loadVendorProfile("northwind")).toBeNull();
  });

  it("gives a suspended vendor nothing", async () => {
    await vendor({ status: "suspended" });
    await published();

    expect(await storefront.loadVendorProfile("northwind")).toBeNull();
  });

  it("gives an offboarded vendor nothing", async () => {
    await vendor({ status: "offboarded" });
    await published();

    expect(await storefront.loadVendorProfile("northwind")).toBeNull();
  });

  /*
   * "Has at least one published product" is **not** asserted here.
   *
   * The page answers it from `searchMarketplace({ vendor: [slug] }).total` rather than with a
   * second query, so the rule lives where the grid does. What is testable without the cached
   * pipeline is the *sitemap's* version of the same condition, below — and the two matching is
   * what stops the sitemap advertising a 404.
   */
});

describe("what it shows", () => {
  it("shows no rating at all when there are no reviews", async () => {
    await vendor();
    await published();

    const page = await storefront.loadVendorProfile("northwind");
    // `null`, not `{ average: 0 }`. An empty five-star frame reads as "everybody hated them".
    expect(page!.rating).toBeNull();
  });

  it("shows the rating when there is one", async () => {
    await vendor({ ratingSum: 22, ratingCount: 5 });
    await published();

    const page = await storefront.loadVendorProfile("northwind");
    expect(page!.rating).toEqual({ average: 4.4, count: 5 });
  });

  /** The criterion that keeps a storefront from becoming a disclosure. */
  it("carries no sales, revenue or payout information", async () => {
    await vendor({
      payout: { accountName: "Northwind Ltd", accountIdentifier: "12345678", bankName: "Bank" },
      commissionBasisPoints: 2500,
    });
    await published();

    const page = await storefront.loadVendorProfile("northwind");
    const serialised = JSON.stringify(page);

    expect(serialised).not.toContain("12345678");
    expect(serialised).not.toContain("payout");
    expect(serialised).not.toContain("commission");
    expect(serialised).not.toContain("2500");
    // And nothing about the level that gates money.
    expect(serialised).not.toContain("business");
  });
});

/**
 * The two-level visibility rule, against the real collections.
 *
 * The resolution itself is pure and covered in
 * `services/vendors/storefront-visibility.test.ts` in milliseconds. What earns a
 * place here is the part that unit test cannot reach: the profile is assembled
 * from **two collections**, and the question is whether the setting in one
 * actually reaches the projection of the other. A resolver that is right and a
 * loader that never consults it look identical from the unit project.
 */
describe("what staff allow a storefront to show", () => {
  async function platform(fields: Record<string, boolean>) {
    await vendors.StorefrontSettings.create({ singleton: "global", fields });
  }

  /**
   * The property that makes this change invisible on deploy — no settings row,
   * no vendor override, and the storefront is the one that existed before.
   */
  it("shows everything when nothing has been configured", async () => {
    await vendor();
    await published();

    const page = await storefront.loadVendorProfile("northwind");

    expect(page!.websiteUrl).toBe("https://northwind.test");
    expect(page!.summary).toBe("We build dispatch tooling.");
    expect(page!.country).toBe("GB");
  });

  it("drops a field the platform setting switches off", async () => {
    await platform({ website: false });
    await vendor();
    await published();

    const page = await storefront.loadVendorProfile("northwind");

    // **Absent, not blanked.** `VendorJsonLd` spreads `sameAs` off this object, so
    // omitting the key is what stops the structured data advertising a link the
    // page does not show — a mismatch rather than an untidiness.
    expect(page).not.toHaveProperty("websiteUrl");
    expect(JSON.stringify(page)).not.toContain("northwind.test");
    // Only that one. A switch is not a blanket.
    expect(page!.summary).toBe("We build dispatch tooling.");
  });

  /**
   * The case both levels exist for, and the one a single-level design gets
   * wrong: a platform-wide switch-off with one vendor exempted.
   */
  it("lets one vendor's override beat the platform setting", async () => {
    await platform({ website: false });
    await vendor({ storefrontVisibility: { website: true } });
    await published();

    expect((await storefront.loadVendorProfile("northwind"))!.websiteUrl).toBe(
      "https://northwind.test",
    );
  });

  it("lets a vendor be hidden while the platform shows everyone else", async () => {
    await platform({ website: true });
    await vendor({ storefrontVisibility: { website: false } });
    await published();

    expect(await storefront.loadVendorProfile("northwind")).not.toHaveProperty("websiteUrl");
  });

  /**
   * `country` was required on `VendorProfile` until staff could switch `location`
   * off. This is the assertion that it really is optional now — and the reason
   * the `Organization` node's `address` had to become conditional, since a
   * `PostalAddress` naming no country is a claim to have an address that has none.
   */
  it("omits the country entirely when location is hidden", async () => {
    await platform({ location: false });
    await vendor();
    await published();

    expect(await storefront.loadVendorProfile("northwind")).not.toHaveProperty("country");
  });

  it("never lets a hidden field reach the storefront through the profile", async () => {
    await platform({ cover: false, logo: false });
    await vendor({
      profile: {
        summary: "We build dispatch tooling.",
        logoUrl: "https://cdn.test/logo.png",
        coverUrl: "https://cdn.test/cover.jpg",
      },
    });
    await published();

    const serialised = JSON.stringify(await storefront.loadVendorProfile("northwind"));

    expect(serialised).not.toContain("cdn.test");
  });
});

describe("the sitemap", () => {
  it("lists a verified vendor with a published product", async () => {
    await vendor();
    await published();

    expect(await storefront.storefrontSlugs()).toEqual([{ slug: "northwind" }]);
  });

  it("omits exactly what the page 404s on", async () => {
    // Unverified with a published product, and verified with nothing published: both have a
    // `vendorSlug` on a product or a vendor row, and neither has a page.
    await vendor({ status: "in_review" });
    await published();
    await vendor({ displayName: "Southgate" }, OTHER, "southgate");

    expect(await storefront.storefrontSlugs()).toEqual([]);
  });

  it("lists each vendor once however many products they have", async () => {
    await vendor();
    await published(VENDOR, "one");
    await published(VENDOR, "two");
    await published(VENDOR, "three");

    expect(await storefront.storefrontSlugs()).toEqual([{ slug: "northwind" }]);
  });
});

describe("vendorNames", () => {
  it("resolves the slugs a filter actually carries", async () => {
    await vendor();
    await vendor({ displayName: "Southgate" }, OTHER, "southgate");

    const names = await storefront.vendorNames(["northwind", "southgate", "nobody"]);

    expect(names.get("northwind")).toBe("Northwind Labs");
    expect(names.get("southgate")).toBe("Southgate");
    expect(names.has("nobody")).toBe(false);
  });

  it("does not query at all for an empty filter", async () => {
    expect(await storefront.vendorNames([])).toEqual(new Map());
  });
});
