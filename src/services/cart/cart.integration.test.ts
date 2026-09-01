import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Ticket 10's guarantees, against a real MongoDB.
 *
 * The unit tests in `calculate.test.ts` prove the arithmetic. These prove the
 * things that only break when there is state: a product re-priced after it was
 * added, a code that expired between adding and checking out, two carts merging,
 * and the currency rule.
 */

let mongoose: typeof import("mongoose").default;
let cartService: typeof import("./cart-service");
let models: typeof import("@/lib/db/models/catalog");
let commerce: typeof import("@/lib/db/models/commerce");
let carts: typeof import("@/repositories/cart.repository").carts;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "cart_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  cartService = await import("./cart-service");
  models = await import("@/lib/db/models/catalog");
  commerce = await import("@/lib/db/models/commerce");
  carts = (await import("@/repositories/cart.repository")).carts;

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    models.Product.syncIndexes(),
    commerce.Cart.syncIndexes(),
    commerce.DiscountCode.syncIndexes(),
    commerce.TaxRule.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await Promise.all([
    models.Product.deleteMany({}),
    commerce.Cart.deleteMany({}),
    commerce.DiscountCode.deleteMany({}),
    commerce.TaxRule.deleteMany({}),
    commerce.Order.deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

async function product(
  overrides: {
    name?: string;
    slug?: string;
    prices?: Array<{ currency: string; amount: number }>;
    activationLimit?: number;
    addons?: Array<{ key: string; name: string; amount?: number; pricingType?: string }>;
    facets?: string[];
  } = {},
) {
  const prices = overrides.prices ?? [{ currency: "GBP", amount: 29_999 }];

  // Cast: the fixture omits the dozen fields a product has defaults for, and
  // `create`'s overload resolution collapses to `never` rather than widening.
  return models.Product.create({
    name: overrides.name ?? "Atlas CRM",
    slug: overrides.slug ?? `atlas-${Math.random().toString(36).slice(2, 8)}`,
    summary: "A CRM.",
    status: "published",
    deletedAt: null,
    facets: overrides.facets ?? ["cat:crm"],
    prices,
    licencePackages: [
      {
        key: "standard",
        name: "Standard",
        licenceType: "single_installation",
        activationLimit: overrides.activationLimit ?? 1,
        supportMonths: 12,
        updateMonths: 12,
        prices,
      },
    ],
    addons: (overrides.addons ?? []).map((addon) => ({
      key: addon.key,
      name: addon.name,
      pricingType: addon.pricingType ?? "fixed",
      prices: addon.amount === undefined ? [] : [{ currency: "GBP", amount: addon.amount }],
    })),
  } as never) as unknown as Promise<{ _id: import("mongoose").Types.ObjectId }>;
}

const OWNER = "guest:test-owner";

async function view(ownerKey = OWNER, context = {}) {
  const cart = await carts.findByOwnerKey(ownerKey);
  return cartService.recalculate(cart!, context);
}

/* ────────────────────────────────────────────── the total is the server's */

describe("totals come from the database, never the cart", () => {
  it("re-prices from the live product and flags the change", async () => {
    const atlas = await product({ prices: [{ currency: "GBP", amount: 29_999 }] });
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });

    // The seller raises the price after it was added.
    await models.Product.updateOne(
      { _id: atlas._id },
      {
        $set: {
          prices: [{ currency: "GBP", amount: 34_999 }],
          "licencePackages.0.prices": [{ currency: "GBP", amount: 34_999 }],
        },
      },
    );

    const result = await view();
    // The *new* price is charged, and the customer is told before payment.
    expect(result.totals.total.amount).toBe(34_999);
    expect(result.notices.map((n) => n.kind)).toContain("price_changed");
  });

  it("ignores a unitPrice written straight into the document", async () => {
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });

    // The most direct possible tamper — bypass the action entirely and write
    // a penny price into the cart. It must change nothing.
    await commerce.Cart.updateOne(
      { ownerKey: OWNER },
      { $set: { "items.0.unitPrice": { amount: 1, currency: "GBP" } } },
    );

    const result = await view();
    expect(result.totals.total.amount).toBe(29_999);
  });

  it("drops an unpublished product from the total and says so", async () => {
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await models.Product.updateOne({ _id: atlas._id }, { $set: { status: "draft" } });

    const result = await view();
    expect(result.lines).toHaveLength(0);
    expect(result.totals.total.amount).toBe(0);
    expect(result.notices.map((n) => n.kind)).toContain("item_unavailable");
  });
});

/* ────────────────────────────────────────────── currency */

describe("one currency per cart", () => {
  it("refuses a product not priced in the cart's currency, actionably", async () => {
    const gbpOnly = await product({ prices: [{ currency: "GBP", amount: 29_999 }] });
    const ngnOnly = await product({
      slug: "ngn-only",
      prices: [{ currency: "NGN", amount: 5_000_000 }],
    });

    await cartService.addItem(OWNER, { productId: String(ngnOnly._id) }, { currency: "NGN" });

    await expect(
      cartService.addItem(OWNER, { productId: String(gbpOnly._id) }, { currency: "NGN" }),
    ).rejects.toThrow(/isn't sold in NGN/);
  });

  it("lets an empty cart adopt the first product's currency", async () => {
    // Refusing a first item because the default happened to be GBP would be
    // absurd — there is nothing to conflict with.
    const ngnOnly = await product({ prices: [{ currency: "NGN", amount: 5_000_000 }] });
    await cartService.addItem(OWNER, { productId: String(ngnOnly._id) }, { currency: "NGN" });

    const result = await view();
    expect(result.currency).toBe("NGN");
    expect(result.totals.total.amount).toBe(5_000_000);
  });

  /**
   * The case the test above looks like it covers and doesn't: there, the viewer
   * was *already* browsing in NGN, so the session currency and the product
   * agreed and nothing had to adapt.
   *
   * Reported by a customer. A new account browsing in USD, an empty basket, and
   * every add refused with "switch your basket to a currency it's priced in, or
   * remove the other items first" — advice with no possible action behind it.
   * The cause was `cart.items.length === 0 ? context.currency : cart.currency`,
   * which reads like adopting the product's currency and is not that.
   */
  it("adopts a currency the product IS priced in when the viewer's does not fit", async () => {
    const ngnOnly = await product({ prices: [{ currency: "NGN", amount: 5_000_000 }] });

    await expect(
      cartService.addItem(OWNER, { productId: String(ngnOnly._id) }, { currency: "USD" }),
    ).resolves.toBeTruthy();

    const result = await view();
    expect(result.currency).toBe("NGN");
    expect(result.totals.total.amount).toBe(5_000_000);
  });

  it("still prefers the viewer's currency when the product has one", async () => {
    // Adopting must not mean "ignore what they asked for" — a product priced in
    // both should charge the currency they are browsing in.
    const both = await product({
      prices: [
        { currency: "GBP", amount: 29_999 },
        { currency: "USD", amount: 38_000 },
      ],
    });

    await cartService.addItem(OWNER, { productId: String(both._id) }, { currency: "USD" });

    const result = await view();
    expect(result.currency).toBe("USD");
    expect(result.totals.total.amount).toBe(38_000);
  });

  it("re-prices every line on a currency switch, keeping unpriceable ones visible", async () => {
    const both = await product({
      prices: [
        { currency: "GBP", amount: 29_999 },
        { currency: "USD", amount: 38_099 },
      ],
    });
    const gbpOnly = await product({
      slug: "gbp-only",
      prices: [{ currency: "GBP", amount: 9_900 }],
    });

    await cartService.addItem(OWNER, { productId: String(both._id) }, { currency: "GBP" });
    await cartService.addItem(OWNER, { productId: String(gbpOnly._id) }, { currency: "GBP" });

    const switched = await cartService.switchCurrency(OWNER, "USD");
    expect(switched.repriced).toBe(1);
    // Kept, not deleted — silently emptying somebody's basket because they
    // clicked a currency toggle is a second problem, not a recovery.
    expect(switched.unpriceable).toHaveLength(1);

    const result = await view();
    expect(result.notices.map((n) => n.kind)).toContain("no_price_in_currency");
    expect(result.totals.total.amount).toBe(38_099);

    /*
     * "Visible" is what this test's name has claimed since it was written, and
     * for as long as the view dropped the line it was not true of anything the
     * customer could see: `lines` did not contain it, and its notice carried a
     * `lineId` no rendered line could match. `blocked` is the row the basket
     * draws, so it is the assertion that means what the name says.
     */
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]!.reason).toBe("no_price_in_currency");
    expect(result.blocked[0]!.message).toMatch(/isn't sold in USD/);
    // In `blocked` *and* in the count — the header badge used to disagree with
    // the basket by exactly this line.
    expect(result.itemCount).toBe(2);

    // The remedy's options: GBP prices both, USD only one of them. An
    // intersection, so a suggestion cannot fix one line and break the other.
    expect(result.priceableCurrencies).toEqual(["GBP"]);
  });

  it("offers no currency at all when a line's product has gone", async () => {
    // `priceableCurrencies` is an intersection over every line, and a product
    // that no longer exists prices in nothing. Removing is the only move, and
    // the basket must not offer a switch that cannot work.
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await models.Product.updateOne({ _id: atlas._id }, { $set: { status: "draft" } });

    const result = await view();
    expect(result.blocked.map((line) => line.reason)).toEqual(["item_unavailable"]);
    expect(result.priceableCurrencies).toEqual([]);
  });
});

/* ────────────────────────────────────────────── add-ons and quantity */

describe("add-ons and quantity", () => {
  it("removes a product's add-ons with it", async () => {
    const atlas = await product({
      addons: [
        { key: "install", name: "Installation", amount: 9_900 },
        { key: "branding", name: "Branding", amount: 4_900 },
      ],
    });

    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), addonKeys: ["install", "branding"] },
      { currency: "GBP" },
    );

    const before = await view();
    expect(before.lines).toHaveLength(3);
    expect(before.totals.total.amount).toBe(44_799); // 29999 + 9900 + 4900

    const licenceLine = before.lines.find((line) => line.kind === "product_licence")!;
    await cartService.removeLine(OWNER, licenceLine.lineId);

    const after = await view();
    expect(after.lines).toHaveLength(0);
  });

  it("locks a single-installation licence to a quantity of one", async () => {
    const atlas = await product({ activationLimit: 1 });
    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), quantity: 5 },
      { currency: "GBP" },
    );

    const result = await view();
    expect(result.lines[0]?.quantity).toBe(1);
    expect(result.lines[0]?.quantityLocked).toBe(true);
    expect(result.totals.total.amount).toBe(29_999);
  });

  it("allows quantity on a multi-installation licence", async () => {
    const atlas = await product({ activationLimit: 10 });
    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), quantity: 3 },
      { currency: "GBP" },
    );

    const result = await view();
    expect(result.lines[0]?.quantity).toBe(3);
    expect(result.totals.total.amount).toBe(89_997);
  });

  it("carries a quote-required add-on at zero rather than dropping it", async () => {
    const atlas = await product({
      addons: [{ key: "migration", name: "Data migration", pricingType: "quote_required" }],
    });
    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), addonKeys: ["migration"] },
      { currency: "GBP" },
    );

    const result = await view();
    // Still a line: "I want this quoted" is real information for the order.
    expect(result.lines).toHaveLength(2);
    expect(result.totals.total.amount).toBe(29_999);
  });

  it("refuses an add-on with no price in the cart's currency instead of charging zero", async () => {
    // The leak this replaced: `addonPrice ?? 0` shipped a paid plugin for
    // nothing whenever it had no row in the basket's currency. Now that an
    // add-on can legitimately be free, zero has to mean zero.
    const atlas = await product({
      addons: [{ key: "stripe", name: "Stripe gateway" }], // no amount ⇒ no prices
    });

    await expect(
      cartService.addItem(
        OWNER,
        { productId: String(atlas._id), addonKeys: ["stripe"] },
        { currency: "GBP" },
      ),
    ).rejects.toThrow(/Stripe gateway isn't sold in GBP/);

    // And it refused the whole call rather than adding the licence alone.
    expect((await view()).lines).toHaveLength(0);
  });

  it("carries a genuinely free add-on at zero", async () => {
    const atlas = await product({
      addons: [{ key: "csv", name: "CSV export", amount: 0 }],
    });
    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), addonKeys: ["csv"] },
      { currency: "GBP" },
    );

    const result = await view();
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]?.unitPrice.amount).toBe(0);
    // Priced, not quoted — the distinction the basket now renders.
    expect(result.lines[1]?.addonPricingType).toBe("fixed");
    expect(result.totals.total.amount).toBe(29_999);
  });
});

/* ────────────────────────────────────────────── discounts */

describe("discounts are validated on every recalculation", () => {
  const code = async (overrides: Record<string, unknown>) =>
    commerce.DiscountCode.create({
      code: "TESTCODE",
      kind: "percentage",
      value: 1_000,
      isActive: true,
      usedCount: 0,
      productIds: [],
      categorySlugs: [],
      ...overrides,
    });

  it("applies a valid code", async () => {
    await code({});
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await cartService.setDiscountCode(OWNER, "TESTCODE");

    const result = await view();
    expect(result.totals.discount.amount).toBe(3_000); // 10% of 29999 = 2999.9 → 3000
    expect(result.totals.total.amount).toBe(26_999);
  });

  it("rejects a code that expired after it was applied", async () => {
    // The acceptance criterion. Applied Monday, checked out Friday.
    await code({ expiresAt: new Date(Date.now() + 60_000) });
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await cartService.setDiscountCode(OWNER, "TESTCODE");

    expect((await view()).totals.discount.amount).toBe(3_000);

    await commerce.DiscountCode.updateOne(
      { code: "TESTCODE" },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const after = await view();
    expect(after.totals.discount.amount).toBe(0);
    expect(after.totals.total.amount).toBe(29_999);
    expect(after.notices.map((n) => n.message)).toContain("That code has expired.");
  });

  it("rejects a code that hit its usage limit", async () => {
    await code({ usageLimit: 5, usedCount: 5 });
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await cartService.setDiscountCode(OWNER, "TESTCODE");

    const result = await view();
    expect(result.totals.discount.amount).toBe(0);
    expect(result.notices.map((n) => n.message)).toContain("That code has been fully claimed.");
  });

  it("rejects a code below its minimum spend", async () => {
    await code({ minSpend: { amount: 50_000, currency: "GBP" } });
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await cartService.setDiscountCode(OWNER, "TESTCODE");

    expect((await view()).totals.discount.amount).toBe(0);
  });

  it("honours category scoping", async () => {
    await code({ categorySlugs: ["finance"] });
    const crm = await product({ facets: ["cat:crm"] });
    await cartService.addItem(OWNER, { productId: String(crm._id) }, { currency: "GBP" });
    await cartService.setDiscountCode(OWNER, "TESTCODE");

    const refused = await view();
    expect(refused.totals.discount.amount).toBe(0);

    const finance = await product({ slug: "ledger", facets: ["cat:finance"] });
    await cartService.addItem(OWNER, { productId: String(finance._id) }, { currency: "GBP" });

    // Now something in the basket qualifies, so the code applies — to the
    // whole subtotal, which is what an order-level discount means.
    const applied = await view();
    expect(applied.totals.discount.amount).toBeGreaterThan(0);
  });
});

/* ────────────────────────────────────────────── tax */

describe("tax", () => {
  it("applies the country rule, after the discount", async () => {
    await commerce.TaxRule.create({
      ruleId: "uk-digital-vat-20",
      label: "UK VAT",
      country: "GB",
      kind: "digital",
      basisPoints: 2_000,
      priority: 10,
      isActive: true,
    });

    const atlas = await product({ prices: [{ currency: "GBP", amount: 10_000 }] });
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });

    const result = await view(OWNER, { organizationCountry: "GB" });
    expect(result.totals.tax.amount).toBe(2_000);
    expect(result.totals.taxRuleId).toBe("uk-digital-vat-20");
    expect(result.totals.total.amount).toBe(12_000);
  });

  it("charges nothing when the country has no rule", async () => {
    const atlas = await product({ prices: [{ currency: "GBP", amount: 10_000 }] });
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });

    const result = await view(OWNER, { organizationCountry: "AQ" });
    expect(result.totals.tax.amount).toBe(0);
    expect(result.totals.total.amount).toBe(10_000);
  });

  it("prefers a country rule over the wildcard, whatever the priority says", async () => {
    await commerce.TaxRule.create([
      {
        ruleId: "catch-all",
        label: "Catch-all",
        country: "*",
        kind: "any",
        basisPoints: 500,
        // Deliberately higher, to prove country specificity wins first.
        priority: 99,
        isActive: true,
      },
      {
        ruleId: "gb-vat",
        label: "UK VAT",
        country: "GB",
        kind: "any",
        basisPoints: 2_000,
        priority: 1,
        isActive: true,
      },
    ]);

    const atlas = await product({ prices: [{ currency: "GBP", amount: 10_000 }] });
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });

    const result = await view(OWNER, { organizationCountry: "GB" });
    expect(result.totals.taxRuleId).toBe("gb-vat");
  });
});

/* ────────────────────────────────────────────── merge */

describe("guest → login merge", () => {
  it("moves items across without losing or duplicating them", async () => {
    const a = await product({ slug: "product-a" });
    const b = await product({ slug: "product-b" });

    await cartService.addItem(OWNER, { productId: String(a._id) }, { currency: "GBP" });

    const userId = "6a80c46f6c887b38e2f0e001";
    await cartService.addItem(
      `user:${userId}`,
      { productId: String(b._id) },
      { currency: "GBP", userId },
    );

    const result = await cartService.mergeOnLogin(OWNER, userId, undefined, "GBP");
    expect(result.merged).toBe(1);
    expect(result.dropped).toHaveLength(0);

    const merged = await view(`user:${userId}`);
    expect(merged.lines).toHaveLength(2);
    // And the guest cart is gone, so a second sign-in cannot re-merge it.
    expect(await carts.findByOwnerKey(OWNER)).toBeNull();
  });

  it("sums quantities for the same line rather than duplicating it", async () => {
    const atlas = await product({ activationLimit: 10 });
    const userId = "6a80c46f6c887b38e2f0e002";

    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), quantity: 2 },
      { currency: "GBP" },
    );
    await cartService.addItem(
      `user:${userId}`,
      { productId: String(atlas._id), quantity: 3 },
      { currency: "GBP", userId },
    );

    await cartService.mergeOnLogin(OWNER, userId, undefined, "GBP");

    const merged = await view(`user:${userId}`);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]?.quantity).toBe(5);
  });

  it("keeps the user cart on a currency conflict and reports what was dropped", async () => {
    const gbp = await product({ slug: "gbp", prices: [{ currency: "GBP", amount: 29_999 }] });
    const ngn = await product({
      slug: "ngn",
      prices: [{ currency: "NGN", amount: 5_000_000 }],
    });

    const userId = "6a80c46f6c887b38e2f0e003";
    await cartService.addItem(
      `user:${userId}`,
      { productId: String(gbp._id) },
      { currency: "GBP", userId },
    );
    await cartService.addItem(OWNER, { productId: String(ngn._id) }, { currency: "NGN" });

    const result = await cartService.mergeOnLogin(OWNER, userId, undefined, "GBP");

    // The user's basket wins: re-pricing what they built while signed in, on
    // the strength of a cookie from another session, is the wrong default.
    expect(result.dropped).toHaveLength(1);
    const merged = await view(`user:${userId}`);
    expect(merged.currency).toBe("GBP");
    expect(merged.lines).toHaveLength(1);
  });

  it("adopts the guest currency when the user cart is empty", async () => {
    const ngn = await product({ prices: [{ currency: "NGN", amount: 5_000_000 }] });
    const userId = "6a80c46f6c887b38e2f0e004";

    await cartService.addItem(OWNER, { productId: String(ngn._id) }, { currency: "NGN" });
    await cartService.mergeOnLogin(OWNER, userId, undefined, "GBP");

    const merged = await view(`user:${userId}`);
    expect(merged.currency).toBe("NGN");
    expect(merged.lines).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────── the cart itself */

describe("cart lifecycle", () => {
  it("does not create two carts for two simultaneous adds", async () => {
    const atlas = await product();

    await Promise.all([
      cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" }),
      cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" }),
    ]);

    // The unique index on `ownerKey` is what makes this safe; a
    // read-then-insert would have thrown E11000 at the customer.
    expect(await commerce.Cart.countDocuments({ ownerKey: OWNER })).toBe(1);
  });

  it("has a TTL index so abandoned guest carts are swept", async () => {
    const indexes = await commerce.Cart.collection.indexes();
    const ttl = indexes.find((index) => index.name === "expiresAt_1");
    expect(ttl?.expireAfterSeconds).toBe(0);
  });

  it("sets a longer expiry for a signed-in cart than a guest one", async () => {
    const atlas = await product();
    await cartService.addItem(OWNER, { productId: String(atlas._id) }, { currency: "GBP" });
    await cartService.addItem(
      "user:6a80c46f6c887b38e2f0e005",
      { productId: String(atlas._id) },
      { currency: "GBP", userId: "6a80c46f6c887b38e2f0e005" },
    );

    const guest = await carts.findByOwnerKey(OWNER);
    const user = await carts.findByOwnerKey("user:6a80c46f6c887b38e2f0e005");
    expect(user!.expiresAt.getTime()).toBeGreaterThan(guest!.expiresAt.getTime());
  });
});
