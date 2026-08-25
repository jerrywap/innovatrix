import { describe, expect, it } from "vitest";
import { buildSiblingCopy } from "./template-sibling";
import type { ProductDoc, ProductPrice } from "@/lib/db/models/catalog";

/**
 * The copy map, at the only altitude it needs.
 *
 * `buildSiblingCopy` is pure, so these assertions need no database and no
 * request context. What they check is the handful of decisions a reader would
 * otherwise have to reconstruct from the exclusion table: money is replaced rather
 * than copied, and the fields that would be *false* on a front-end-only listing are
 * absent.
 *
 * **Exhaustiveness is deliberately not tested here.** `EXCLUDED` is a
 * `Record<Exclude<keyof ProductDoc, …>, string>`, so `tsc` fails the day
 * `ProductDoc` gains a field, naming it. A test that walked the keys would be a
 * second, weaker copy of that — and a filesystem-scanning one would be a fifteenth
 * enforcement test, which the closed set forbids.
 */

const PRICES: ProductPrice[] = [
  { currency: "GBP", amount: 7_900 },
  { currency: "USD", amount: 9_900 },
];

/** A full script with everything set, so an accidental copy shows up as a value. */
function script(overrides: Partial<ProductDoc> = {}): ProductDoc {
  return {
    name: "Atlas CRM",
    summary: "A complete sales and customer system.",
    slug: "atlas-crm",
    catalogue: "script",
    industryIds: ["6a80c46f6c887b38e2f0e0b4"],
    categoryIds: ["6a80c46f6c887b38e2f0e0b5"],
    technologyIds: ["6a80c46f6c887b38e2f0e0b6"],
    features: [{ title: "Role-based access" }, { title: "Email notifications" }],
    requirements: "PHP 8.2, MySQL 8",
    media: [{ kind: "screenshot", url: "https://example.test/a.png", alt: "" }],
    prices: [{ currency: "GBP", amount: 29_900 }],
    licencePackages: [
      {
        key: "single",
        name: "Single installation",
        licenceType: "single_installation",
        activationLimit: 1,
        supportMonths: 12,
        updateMonths: 12,
        prices: [{ currency: "GBP", amount: 29_900 }],
      },
      {
        key: "multi",
        name: "Multi",
        licenceType: "multi_installation",
        activationLimit: 5,
        supportMonths: 12,
        updateMonths: 12,
        prices: [{ currency: "GBP", amount: 79_900 }],
      },
    ],
    addons: [{ key: "install", name: "Installation", pricingType: "fixed", prices: [] }],
    installation: { selfInstall: true, innovatrixInstall: true, managedHosting: false },
    customization: {
      available: true,
      aiWorkflowEnabled: true,
      suggestedAreas: ["Branding"],
      startingPrice: { currency: "GBP", amount: 150_000 },
    },
    demo: {
      exposure: "public",
      credentials: [{ role: "Admin", username: "a", passwordCipher: {} }],
    },
    ...overrides,
  } as unknown as ProductDoc;
}

describe("buildSiblingCopy", () => {
  it("replaces the money rather than copying it, on both price lists", () => {
    // The two lists come from one input, which is what makes `unbuyable_currency`
    // structurally impossible on the new listing: the marketplace cannot advertise
    // a currency the cart has no line for.
    const copy = buildSiblingCopy(script(), PRICES);

    expect(copy.prices).toEqual(PRICES);
    for (const pkg of copy.licencePackages) {
      expect(pkg.prices).toEqual(PRICES);
    }
  });

  it("keeps every licence package, so tiers are not silently dropped", () => {
    // All at one price — the panel says so before the click, and the pricing step
    // is where tiers are restored.
    const copy = buildSiblingCopy(script(), PRICES);
    expect(copy.licencePackages.map((pkg) => pkg.key)).toEqual(["single", "multi"]);
  });

  it("drops the customization starting price, which is money for the whole app", () => {
    const copy = buildSiblingCopy(script(), PRICES);
    expect(copy.customization.available).toBe(true);
    expect(copy.customization.startingPrice).toBeUndefined();
  });

  it("carries industries but not the other three taxonomies", () => {
    // Industries are seeded `both`, so nothing refuses them. Script categories
    // would be refused outright by `assertTermsInCatalogue`, and a template
    // advertising PostgreSQL is wrong in its own filter rail.
    const copy = buildSiblingCopy(script(), PRICES);

    expect(copy.industryIds).toEqual(["6a80c46f6c887b38e2f0e0b4"]);
    expect(copy).not.toHaveProperty("categoryIds");
    expect(copy).not.toHaveProperty("technologyIds");
    expect(copy).not.toHaveProperty("productTypeId");
  });

  /**
   * The description is copied **and** flagged.
   *
   * It used to be excluded, so `no_description` would force a human to write one.
   * Prefilling without the flag would have satisfied that gate with prose
   * describing a backend the template does not have — the exact failure the
   * exclusion existed to prevent. The flag is what makes prefilling safe.
   */
  it("copies the description, marked as unread", () => {
    // The shared fixture has none, so this one supplies it — the flag must only
    // appear when there is actually prose to review.
    const withOne = {
      ...script(),
      description: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "A full CRM." }] }],
      },
    };
    const copy = buildSiblingCopy(withOne as never, PRICES);

    expect(copy.description).toBeDefined();
    expect(copy.descriptionText).toBeTruthy();
    expect(copy.descriptionInherited).toBe(true);
  });

  it("does not flag a description that was never there", () => {
    // Nothing to review, so `no_description` fires for the ordinary reason and the
    // vendor is not told to read an empty box.
    const copy = buildSiblingCopy(script(), PRICES);

    expect(copy.descriptionInherited).toBeUndefined();
  });

  it("copies nothing that would be false or unusable on a front-end listing", () => {
    const copy = buildSiblingCopy(script(), PRICES);

    // `features` has no readiness gap to force a read, so a copied capability list
    // would reach a customer having never been looked at.
    expect(copy).not.toHaveProperty("features");
    expect(copy).not.toHaveProperty("requirements");
    // Hard constraints: a media key and a credential ciphertext are both bound to
    // the product they were created under.
    expect(copy).not.toHaveProperty("media");
    expect(copy).not.toHaveProperty("demo");
    // Would point at a version whose `productId` is the other product.
    expect(copy).not.toHaveProperty("currentVersionId");
  });

  it("carries the delivery method only when the script has one", () => {
    // Absent means `archive`, so writing an explicit `undefined` would be a
    // different statement from saying nothing.
    expect(buildSiblingCopy(script(), PRICES)).not.toHaveProperty("deliveryMethod");
    expect(
      buildSiblingCopy(script({ deliveryMethod: "vendor_hosted" }), PRICES).deliveryMethod,
    ).toBe("vendor_hosted");
  });
});
