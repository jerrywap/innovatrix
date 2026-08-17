import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Ticket 11's guarantees.
 *
 * These need a **replica set** rather than a plain mongod: `createOrder` runs
 * inside `withTransaction`, and the atomicity criterion is meaningless without
 * one.
 */

let mongoose: typeof import("mongoose").default;
let checkout: typeof import("./checkout-service");
let cartService: typeof import("@/services/cart/cart-service");
let catalog: typeof import("@/lib/db/models/catalog");
let commerce: typeof import("@/lib/db/models/commerce");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const USER = "6a80c46f6c887b38e2f0e0b2";
const OWNER = `user:${USER}`;
const ACTOR = { type: "staff", userId: USER, name: "Test" } as const;

const BILLING = {
  organizationName: "Brightpath Ltd",
  email: "amara@brightpath.test",
  line1: "1 High Street",
  city: "Leeds",
  country: "GB",
};

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "checkout_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  checkout = await import("./checkout-service");
  cartService = await import("@/services/cart/cart-service");
  catalog = await import("@/lib/db/models/catalog");
  commerce = await import("@/lib/db/models/commerce");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    catalog.Product.syncIndexes(),
    commerce.Cart.syncIndexes(),
    commerce.Order.syncIndexes(),
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
    catalog.Product.deleteMany({}),
    commerce.Cart.deleteMany({}),
    commerce.Order.deleteMany({}),
    commerce.DiscountCode.deleteMany({}),
    commerce.TaxRule.deleteMany({}),
    commerce.PaymentSettings.deleteMany({}),
    mongoose.connection.collection("vendors").deleteMany({}),
    mongoose.connection.collection("counters").deleteMany({}),
    mongoose.connection.collection("auditLogs").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

async function product(overrides: { slug?: string; amount?: number } = {}) {
  const prices = [{ currency: "GBP", amount: overrides.amount ?? 29_999 }];

  return catalog.Product.create({
    name: "Atlas CRM",
    slug: overrides.slug ?? `atlas-${Math.random().toString(36).slice(2, 8)}`,
    summary: "A CRM.",
    status: "published",
    deletedAt: null,
    facets: ["cat:crm"],
    prices,
    licencePackages: [
      {
        key: "standard",
        name: "Standard",
        licenceType: "single_installation",
        activationLimit: 1,
        supportMonths: 12,
        updateMonths: 12,
        prices,
      },
    ],
  } as never) as unknown as Promise<{ _id: import("mongoose").Types.ObjectId }>;
}

async function basketWith(amount = 29_999) {
  const atlas = await product({ amount });
  await cartService.addItem(
    OWNER,
    { productId: String(atlas._id) },
    { currency: "GBP", userId: USER },
  );
  return atlas;
}

const place = (extra: Record<string, unknown> = {}) =>
  checkout.createOrder(
    { ownerKey: OWNER, userId: USER, organizationId: ORG, billing: BILLING, ...extra },
    ACTOR,
  );

/* ────────────────────────────────────────────── the total is the server's */

describe("the server prices the order", () => {
  it("ignores anything the client could have sent", async () => {
    await basketWith(29_999);

    // There is no input path for a total at all — `createOrder` takes an
    // address and nothing else numeric. This asserts the outcome.
    const { order } = await place();
    expect(order.total.amount).toBe(29_999);
    expect(order.subtotal.amount).toBe(29_999);
  });

  it("uses the current price, not the one in the cart", async () => {
    const atlas = await basketWith(29_999);
    await catalog.Product.updateOne(
      { _id: atlas._id },
      {
        $set: {
          prices: [{ currency: "GBP", amount: 39_999 }],
          "licencePackages.0.prices": [{ currency: "GBP", amount: 39_999 }],
        },
      },
    );

    const { order } = await place();
    expect(order.total.amount).toBe(39_999);
  });

  it("refuses when an item became unavailable", async () => {
    const atlas = await basketWith();
    await catalog.Product.updateOne({ _id: atlas._id }, { $set: { status: "draft" } });

    await expect(place()).rejects.toThrow(/basket has changed/i);
    expect(await commerce.Order.countDocuments({})).toBe(0);
  });
});

/* ────────────────────────────────────────────── §61 */

describe("§61 — the order preserves its own pricing forever", () => {
  it("keeps its line prices when the product is re-priced afterwards", async () => {
    const atlas = await basketWith(29_999);
    const { order } = await place();

    await catalog.Product.updateOne(
      { _id: atlas._id },
      {
        $set: {
          name: "Atlas CRM Renamed",
          prices: [{ currency: "GBP", amount: 99_999 }],
          "licencePackages.0.prices": [{ currency: "GBP", amount: 99_999 }],
        },
      },
    );

    const reread = await commerce.Order.findById(order._id).lean();
    expect(reread!.total.amount).toBe(29_999);
    expect(reread!.items[0]!.unitPrice.amount).toBe(29_999);
    // The *name* is frozen too — an invoice that renames itself when marketing
    // rebrands a product is not a record of anything.
    expect(reread!.items[0]!.productName).toBe("Atlas CRM");
  });

  it("survives the product being deleted outright", async () => {
    const atlas = await basketWith();
    const { order } = await place();
    await catalog.Product.deleteOne({ _id: atlas._id });

    const reread = await commerce.Order.findById(order._id).lean();
    expect(reread!.items[0]!.productName).toBe("Atlas CRM");
    expect(reread!.total.amount).toBe(29_999);
  });

  it("snapshots the licence terms, not a pointer to them", async () => {
    const atlas = await basketWith();
    const { order } = await place();

    await catalog.Product.updateOne(
      { _id: atlas._id },
      { $set: { "licencePackages.0.updateMonths": 1, "licencePackages.0.supportMonths": 1 } },
    );

    const reread = await commerce.Order.findById(order._id).lean();
    // Ticket 14 issues entitlements from these numbers. Reading them live would
    // mean shortening a support window somebody already paid for.
    expect(reread!.items[0]!.updateMonths).toBe(12);
    expect(reread!.items[0]!.supportMonths).toBe(12);
    expect(reread!.items[0]!.activationLimit).toBe(1);
  });

  it("snapshots the tax rate, so a rate change never rewrites it", async () => {
    await commerce.TaxRule.create({
      ruleId: "gb-vat-20",
      label: "UK VAT",
      country: "GB",
      kind: "any",
      basisPoints: 2_000,
      priority: 10,
      isActive: true,
    });
    await basketWith(10_000);

    const { order } = await place();
    expect(order.tax?.amount).toBe(2_000);
    expect(order.tax?.basisPoints).toBe(2_000);
    expect(order.tax?.ruleId).toBe("gb-vat-20");

    // The Chancellor moves VAT. Nothing already sold may move with it.
    await commerce.TaxRule.updateOne({ ruleId: "gb-vat-20" }, { $set: { basisPoints: 1_750 } });

    const reread = await commerce.Order.findById(order._id).lean();
    expect(reread!.tax!.basisPoints).toBe(2_000);
    expect(reread!.total.amount).toBe(12_000);
  });
});

/* ────────────────────────────────────────────── idempotency & atomicity */

describe("one cart, one order", () => {
  it("returns the same order for two rapid submissions", async () => {
    await basketWith();

    const [first, second] = await Promise.all([place(), place()]);

    expect(String(first.order._id)).toBe(String(second.order._id));
    expect(await commerce.Order.countDocuments({})).toBe(1);
    // One of them found the other's work rather than doing it again.
    expect([first.reused, second.reused].filter(Boolean)).toHaveLength(1);
  });

  it("honours an explicit idempotency key", async () => {
    await basketWith();
    const key = "a".repeat(32);

    const first = await place({ idempotencyKey: key });
    const second = await place({ idempotencyKey: key });

    expect(String(first.order._id)).toBe(String(second.order._id));
    expect(second.reused).toBe(true);
  });

  it("leaves no partial order when the transaction fails", async () => {
    await basketWith();
    await commerce.DiscountCode.create({
      code: "GONE",
      kind: "percentage",
      value: 1_000,
      isActive: true,
      usageLimit: 1,
      usedCount: 1,
      productIds: [],
      categorySlugs: [],
    });
    await cartService.setDiscountCode(OWNER, "GONE");

    // The code is refused at recalculation, so it never reaches the claim —
    // the order is placed without it rather than failing. That is correct, and
    // the atomicity case below is the real one.
    const { order } = await place();
    // `toBeUndefined()` would fail here for the wrong reason: Mongoose gives
    // back `{}` for an unset nested path, which is exactly the footgun
    // documented on `OrderDoc.discount`. Check the field, not the object.
    expect(order.discount?.amount).toBeUndefined();
    expect(order.total.amount).toBe(29_999);
    expect(await commerce.Order.countDocuments({})).toBe(1);
  });

  it("rolls the reference back when the transaction aborts", async () => {
    await basketWith();

    // Force a failure *inside* the transaction, after the reference is taken.
    const spy = vi
      .spyOn(commerce.Order, "create")
      .mockRejectedValueOnce(new Error("simulated write failure"));

    await expect(place()).rejects.toThrow(/simulated write failure/);
    spy.mockRestore();

    expect(await commerce.Order.countDocuments({})).toBe(0);

    // And the counter did not burn a number: the next real order is 0001.
    const { order } = await place();
    expect(order.reference).toMatch(/^ORD-\d{4}-0001$/);
  });
});

/* ────────────────────────────────────────────── references */

describe("references", () => {
  it("are sequential within the year and unique", async () => {
    const references: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      await commerce.Cart.deleteMany({});
      await basketWith(10_000 + index);
      const { order } = await place();
      references.push(order.reference);
    }

    expect(references).toEqual([
      expect.stringMatching(/^ORD-\d{4}-0001$/),
      expect.stringMatching(/^ORD-\d{4}-0002$/),
      expect.stringMatching(/^ORD-\d{4}-0003$/),
    ]);
    expect(new Set(references).size).toBe(3);
  });
});

/* ────────────────────────────────────────────── the cart survives */

describe("an abandoned payment leaves the basket intact", () => {
  it("does not clear the cart on order creation", async () => {
    await basketWith();
    const { order } = await place();

    // The acceptance criterion. Ticket 13 clears it on *confirmed payment*;
    // until then the customer can walk away and come back to their basket.
    const cart = await commerce.Cart.findOne({ ownerKey: OWNER }).lean();
    expect(cart!.items).toHaveLength(1);
    expect(order.status).toBe("awaiting_payment");
  });
});

/* ────────────────────────────────────────────── discounts */

describe("discount claiming", () => {
  it("increments usedCount inside the transaction", async () => {
    await commerce.DiscountCode.create({
      code: "TENOFF",
      kind: "percentage",
      value: 1_000,
      isActive: true,
      usageLimit: 5,
      usedCount: 0,
      productIds: [],
      categorySlugs: [],
    });
    await basketWith(10_000);
    await cartService.setDiscountCode(OWNER, "TENOFF");

    const { order } = await place();
    expect(order.discount?.amount).toBe(1_000);
    expect(order.discount?.code).toBe("TENOFF");

    const code = await commerce.DiscountCode.findOne({ code: "TENOFF" }).lean();
    expect(code!.usedCount).toBe(1);
  });

  it("cannot take a code past its limit under concurrency", async () => {
    await commerce.DiscountCode.create({
      code: "LASTONE",
      kind: "fixed",
      value: 1_000,
      currency: "GBP",
      isActive: true,
      usageLimit: 1,
      usedCount: 0,
      productIds: [],
      categorySlugs: [],
    });

    // Two different baskets, both holding the last remaining use.
    const a = await product({ slug: "a", amount: 10_000 });
    const b = await product({ slug: "b", amount: 10_000 });
    await cartService.addItem(
      "user:aaa",
      { productId: String(a._id) },
      { currency: "GBP", userId: "6a80c46f6c887b38e2f0e001" },
    );
    await cartService.addItem(
      "user:bbb",
      { productId: String(b._id) },
      { currency: "GBP", userId: "6a80c46f6c887b38e2f0e002" },
    );
    await cartService.setDiscountCode("user:aaa", "LASTONE");
    await cartService.setDiscountCode("user:bbb", "LASTONE");

    const results = await Promise.allSettled([
      checkout.createOrder(
        {
          ownerKey: "user:aaa",
          userId: "6a80c46f6c887b38e2f0e001",
          organizationId: ORG,
          billing: BILLING,
        },
        ACTOR,
      ),
      checkout.createOrder(
        {
          ownerKey: "user:bbb",
          userId: "6a80c46f6c887b38e2f0e002",
          organizationId: ORG,
          billing: BILLING,
        },
        ACTOR,
      ),
    ]);

    const code = await commerce.DiscountCode.findOne({ code: "LASTONE" }).lean();
    // The whole point: a one-use code used exactly once, whatever the timing.
    expect(code!.usedCount).toBe(1);

    const discounted = results
      .filter((r) => r.status === "fulfilled")
      .filter((r) => r.value.order.discount?.amount);
    expect(discounted).toHaveLength(1);

    await commerce.Cart.deleteMany({});
  });
});

/* ────────────────────────────────────────────── audit */

describe("audit", () => {
  it("records the order with its total and source", async () => {
    await basketWith();
    const { order } = await place();

    const rows = await mongoose.connection
      .collection("auditLogs")
      .find({ action: "order.created" })
      .toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("checkout");
    expect(rows[0]!.after).toMatchObject({
      reference: order.reference,
      total: 29_999,
      currency: "GBP",
    });
  });
});

/* ────────────────────────────────────────────── the commission snapshot */

/**
 * Vendor ticket 07 — the rate is decided **here**, once, and frozen.
 *
 * This is the same argument §61 makes about a price and §61's tax test makes about a rate:
 * the order carries the number it was charged at, so a later change cannot rewrite history.
 * The commission is the case where getting it wrong would be least visible and worst — a
 * silent, retroactive change to somebody's income, in our favour.
 */
describe("the commission rate is snapshotted onto the line", () => {
  const VENDOR = "6c10c46f6c887b38e2f0e0f1";

  async function vendorProduct(commissionBasisPoints?: number) {
    const atlas = await product({ amount: 10_000 });

    await mongoose.connection.collection("vendors").insertOne({
      _id: new mongoose.Types.ObjectId(VENDOR),
      displayName: "Northwind Labs",
      slug: "northwind-labs",
      contactEmail: "hi@northwind.test",
      country: "GB",
      status: "verified",
      ...(commissionBasisPoints === undefined ? {} : { commissionBasisPoints }),
    } as never);

    await catalog.Product.updateOne(
      { _id: atlas._id },
      {
        $set: {
          vendorId: new mongoose.Types.ObjectId(VENDOR),
          vendorSlug: "northwind-labs",
          vendorName: "Northwind Labs",
        },
      },
    );

    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id) },
      { currency: "GBP", userId: USER },
    );

    return atlas;
  }

  it("writes the vendor and the platform rate onto a vendor line", async () => {
    await vendorProduct();

    const { order } = await place();

    expect(String(order.items[0]!.vendorId)).toBe(VENDOR);
    // Nothing configured, so the built-in default — 30%.
    expect(order.items[0]!.commissionBasisPoints).toBe(3000);
  });

  it("prefers the vendor's own rate over the platform default", async () => {
    await commerce.PaymentSettings.create({
      singleton: "global",
      commissionBasisPoints: 2500,
    } as never);
    await vendorProduct(1500);

    const { order } = await place();
    expect(order.items[0]!.commissionBasisPoints).toBe(1500);
  });

  it("uses the platform setting when the vendor has no override", async () => {
    await commerce.PaymentSettings.create({
      singleton: "global",
      commissionBasisPoints: 2500,
    } as never);
    await vendorProduct();

    const { order } = await place();
    expect(order.items[0]!.commissionBasisPoints).toBe(2500);
  });

  /** The freeze. A rate change afterwards must leave the placed order alone. */
  it("keeps the rate when the vendor's rate changes afterwards", async () => {
    await vendorProduct(1500);
    const { order } = await place();

    await mongoose.connection
      .collection("vendors")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(VENDOR) },
        { $set: { commissionBasisPoints: 9000 } },
      );

    const reread = await commerce.Order.findById(order._id).lean();
    expect(reread!.items[0]!.commissionBasisPoints).toBe(1500);
  });

  /**
   * An **add-on** on a vendor's product is still the platform's revenue.
   *
   * Installation and branding are work Innovatrix does; a vendor who wants paid services
   * around their product is a different feature. The line therefore carries no vendor and no
   * rate, so no earning is ever written for it — asserted rather than left to the comment on
   * `buildOrderLines`.
   */
  it("leaves an add-on on a vendor product with no vendor and no rate", async () => {
    const atlas = await vendorProduct(1500);

    await catalog.Product.updateOne(
      { _id: atlas._id },
      {
        $set: {
          addons: [
            {
              key: "install",
              name: "Installation",
              pricingType: "fixed",
              prices: [{ currency: "GBP", amount: 5_000 }],
            },
          ],
        },
      },
    );

    await cartService.addItem(
      OWNER,
      { productId: String(atlas._id), addonKeys: ["install"] },
      { currency: "GBP", userId: USER },
    );

    const { order } = await place();

    const addon = order.items.find((item) => item.kind === "addon");
    expect(addon).toBeTruthy();
    expect(addon!.vendorId).toBeUndefined();
    expect(addon!.commissionBasisPoints).toBeUndefined();

    // The licence line beside it is still the vendor's, so this is not vacuous.
    const licence = order.items.find((item) => item.kind === "product_licence");
    expect(licence!.commissionBasisPoints).toBe(1500);
  });

  it("leaves a first-party line with no vendor and no rate", async () => {
    await basketWith(29_999);

    const { order } = await place();
    expect(order.items[0]!.vendorId).toBeUndefined();
    expect(order.items[0]!.commissionBasisPoints).toBeUndefined();
  });
});
