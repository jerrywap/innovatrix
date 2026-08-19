import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Vendor lifecycle — vendor ticket 12.
 *
 * One promise dominates this file:
 *
 * > **A customer who bought never loses what they bought.**
 *
 * Every case below is an assertion about that. Suspension, offboarding and even an emergency
 * delisting all leave the entitlement in place — the delist suspends it rather than revoking it,
 * because somebody who paid for something later found to be stolen is owed a refund conversation.
 *
 * The other half is that "unlisting is not unpublishing": a suspended vendor's products keep
 * their status, their URLs, their publish dates and their reviews, so reinstating is one flag
 * flip. That is the difference between a reversible decision and a rebuild.
 */

let mongoose: typeof import("mongoose").default;
let lifecycle: typeof import("./lifecycle-service");
let analytics: typeof import("./analytics-service");
let ledger: typeof import("./ledger-service");
let catalog: typeof import("@/lib/db/models/catalog");
let commerce: typeof import("@/lib/db/models/commerce");
let vendors: typeof import("@/lib/db/models/vendors");
let ledgerModels: typeof import("@/lib/db/models/ledger");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");
let moneyLib: typeof import("@/lib/money");

const VENDOR = "8b00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "8b00c46f6c887b38e2f0e0a2";
const ORG = "8b00c46f6c887b38e2f0e0b1";
const USER = "8b00c46f6c887b38e2f0e0c1";
const PRODUCT = "8b00c46f6c887b38e2f0e0d1";
const SECOND = "8b00c46f6c887b38e2f0e0d2";
const ORDER = "8b00c46f6c887b38e2f0e0e1";

const STAFF = { type: "staff", userId: USER, name: "Sam" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "vendor_lifecycle_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  lifecycle = await import("./lifecycle-service");
  analytics = await import("./analytics-service");
  ledger = await import("./ledger-service");
  catalog = await import("@/lib/db/models/catalog");
  commerce = await import("@/lib/db/models/commerce");
  vendors = await import("@/lib/db/models/vendors");
  ledgerModels = await import("@/lib/db/models/ledger");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");
  moneyLib = await import("@/lib/money");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();

  /*
   * Build the indexes here, not in the first test.
   *
   * `autoIndex` is on, so Mongoose builds a model's indexes on its first write — and without
   * this that cost lands inside whichever test runs first, which timed out at 30s under a
   * loaded full run while passing in isolation. `beforeAll` has a 180-second budget precisely
   * for setup like this, and every other vendor suite already does it.
   */
  await Promise.all([
    catalog.Product.syncIndexes(),
    vendors.Vendor.syncIndexes(),
    commerce.Entitlement.syncIndexes(),
    commerce.Licence.syncIndexes(),
    commerce.Order.syncIndexes(),
    ledgerModels.LedgerEntry.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await catalog.Product.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await commerce.Entitlement.deleteMany({});
  await commerce.Licence.deleteMany({});
  await commerce.Order.deleteMany({});
  await ledgerModels.LedgerEntry.collection.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
  await communication.Notification.deleteMany({});
});

/* ────────────────────────────────────────────── fixtures */

async function vendor(
  status: "verified" | "suspended" | "offboarded" = "verified",
  id = VENDOR,
  slug = "northwind",
) {
  return vendors.Vendor.create({
    _id: id,
    displayName: "Northwind Labs",
    slug,
    contactEmail: "ada@northwind.test",
    country: "GB",
    pitch: "Dispatch tooling.",
    appliedAt: new Date(),
    status,
    verifiedAt: new Date(),
    verification: {
      identity: { status: "approved" },
      business: { status: "approved" },
    },
  });
}

async function publishedProduct(id = PRODUCT, slug = "northwind-dispatch", vendorId = VENDOR) {
  return catalog.Product.create({
    _id: id,
    name: "Northwind Dispatch",
    slug,
    summary: "Dispatch tooling.",
    status: "published" as const,
    publishedAt: new Date("2026-03-01"),
    vendorId,
    vendorSlug: "northwind",
    vendorName: "Northwind Labs",
  });
}

/** A customer who has bought, with a licence — the person this ticket protects. */
async function customerWhoBought(productId = PRODUCT) {
  const entitlement = await commerce.Entitlement.create({
    organizationId: ORG,
    productId,
    orderId: ORDER,
    orderLineId: `line-${Math.random().toString(36).slice(2, 8)}`,
    status: "active" as const,
  });

  await commerce.Licence.create({
    entitlementId: entitlement._id,
    organizationId: ORG,
    productId,
    key: `INVX-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    type: "single_installation" as const,
    activationLimit: 1,
    status: "active" as const,
  });

  return entitlement;
}

/* ────────────────────────────────────────────── suspension */

describe("suspension", () => {
  it("unlists the products without unpublishing them", async () => {
    await vendor();
    await publishedProduct();

    await lifecycle.suspend(VENDOR, "An unresolved dispute on their only product.", STAFF);

    const product = await catalog.Product.findById(PRODUCT).lean();
    // The three things that make reinstatement one action rather than a rebuild.
    expect(product!.status).toBe("published");
    expect(product!.slug).toBe("northwind-dispatch");
    expect(product!.publishedAt).toEqual(new Date("2026-03-01"));
    // And the one thing that takes it off the marketplace.
    expect(product!.listingSuppressed).toBe(true);
  });

  it("leaves every entitlement and licence untouched", async () => {
    await vendor();
    await publishedProduct();
    const entitlement = await customerWhoBought();

    await lifecycle.suspend(VENDOR, "Under investigation.", STAFF);

    const after = await commerce.Entitlement.findById(entitlement._id).lean();
    const licence = await commerce.Licence.findOne({ entitlementId: entitlement._id }).lean();

    expect(after!.status).toBe("active");
    expect(licence!.status).toBe("active");
  });

  it("leaves the ledger alone", async () => {
    await vendor();
    await publishedProduct();
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(5_000, "GBP"), note: "Earned before." },
      STAFF,
    );

    await lifecycle.suspend(VENDOR, "Under investigation.", STAFF);

    const [balance] = await ledger.balanceFor({ vendorId: VENDOR });
    expect(balance!.cleared).toBe(5_000);
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(1);
  });

  it("refuses a suspension with no reason", async () => {
    await vendor();

    await expect(lifecycle.suspend(VENDOR, "  ", STAFF)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });

  it("audits the unlisting with a count and the reason", async () => {
    await vendor();
    await publishedProduct();
    await publishedProduct(SECOND, "northwind-invoicing");

    await lifecycle.suspend(VENDOR, "Two products, one problem.", STAFF);

    const audit = await communication.AuditLog.findOne({
      action: "vendor.products_unlisted",
    }).lean();
    expect(audit).toBeTruthy();
    expect((audit!.after as { products?: number }).products).toBe(2);
    expect((audit!.after as { reason?: string }).reason).toBe("Two products, one problem.");
  });

  it("does not touch another vendor's products", async () => {
    await vendor();
    await vendor("verified", OTHER_VENDOR, "southgate");
    await publishedProduct();
    await publishedProduct(SECOND, "southgate-thing", OTHER_VENDOR);

    await lifecycle.suspend(VENDOR, "Only theirs.", STAFF);

    const theirs = await catalog.Product.findById(SECOND).lean();
    expect(theirs!.listingSuppressed).toBeUndefined();
  });
});

describe("reinstatement", () => {
  it("relists with the URL, the publish date and the reviews intact", async () => {
    await vendor();
    await publishedProduct();
    await lifecycle.suspend(VENDOR, "Temporary.", STAFF);

    await lifecycle.reinstate(VENDOR, STAFF);

    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.listingSuppressed).toBeUndefined();
    expect(product!.status).toBe("published");
    expect(product!.slug).toBe("northwind-dispatch");
    expect(product!.publishedAt).toEqual(new Date("2026-03-01"));

    const after = await vendors.Vendor.findById(VENDOR).lean();
    expect(after!.status).toBe("verified");
  });
});

/* ────────────────────────────────────────────── offboarding */

describe("offboarding", () => {
  it("keeps every entitlement active and every licence valid", async () => {
    await vendor();
    await publishedProduct();
    const entitlement = await customerWhoBought();

    const outcome = await lifecycle.offboard(VENDOR, "They asked to leave.", STAFF);

    expect(outcome.entitlementsPreserved).toBe(1);

    const after = await commerce.Entitlement.findById(entitlement._id).lean();
    const licence = await commerce.Licence.findOne({ entitlementId: entitlement._id }).lean();
    expect(after!.status).toBe("active");
    expect(licence!.status).toBe("active");
  });

  it("closes the ledger without deleting an entry", async () => {
    await vendor();
    await publishedProduct();
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(7_000, "GBP"), note: "Owed at the end." },
      STAFF,
    );

    const outcome = await lifecycle.offboard(VENDOR, "Mutual.", STAFF);

    // Reported, not cleared: a final payout is somebody's job, and pretending it ran would be
    // worse than saying what is owed.
    expect(outcome.outstanding).toEqual([{ currency: "GBP", amount: 7_000 }]);
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(1);

    const after = await vendors.Vendor.findById(VENDOR).lean();
    expect(after!.closedAt).toBeInstanceOf(Date);
    // The row itself survives — customers still hold entitlements to their products.
    expect(after!.deletedAt).toBeNull();
  });

  it("unlists their products", async () => {
    await vendor();
    await publishedProduct();

    await lifecycle.offboard(VENDOR, "Leaving.", STAFF);

    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.listingSuppressed).toBe(true);
    expect(product!.status).toBe("published");
  });

  it("tells the customers who hold an entitlement", async () => {
    await vendor();
    await publishedProduct();
    await customerWhoBought();

    await lifecycle.offboard(VENDOR, "Leaving.", STAFF);

    // The event carries product ids; the audience is resolved by querying who holds an active
    // entitlement to any of them. Whether a notification row lands depends on there being an
    // organisation member, which this fixture deliberately does not create — so what is
    // asserted is that the emit happened with the right subject.
    const audit = await communication.AuditLog.findOne({ action: "vendor.offboarded" }).lean();
    expect(audit).toBeTruthy();
    expect((audit!.after as { entitlementsPreserved?: number }).entitlementsPreserved).toBe(1);
  });

  it("refuses with no reason", async () => {
    await vendor();

    await expect(lifecycle.offboard(VENDOR, "", STAFF)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });

  it("cannot be undone — the state machine has no edge out", async () => {
    await vendor();
    await lifecycle.offboard(VENDOR, "Leaving.", STAFF);

    await expect(lifecycle.reinstate(VENDOR, STAFF)).rejects.toBeInstanceOf(
      errors.StateTransitionError,
    );
  });
});

/* ────────────────────────────────────────────── emergency delisting */

describe("emergency delisting", () => {
  it("archives the product and suspends rather than revokes entitlements", async () => {
    await vendor();
    await publishedProduct();
    const entitlement = await customerWhoBought();

    const outcome = await lifecycle.emergencyDelist(
      PRODUCT,
      "Contains code taken from a GPL project without attribution.",
      STAFF,
    );

    expect(outcome.entitlementsSuspended).toBe(1);

    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.status).toBe("archived");
    expect(product!.listingSuppressed).toBe(true);
    expect(product!.delistedReason).toContain("GPL");

    const after = await commerce.Entitlement.findById(entitlement._id).lean();
    // **Suspended**, not revoked: the customer is owed a refund conversation, and revoking
    // would take away both the software and the record that they had it.
    expect(after!.status).toBe("suspended");

    // The licence is deliberately untouched here — `processPaymentRefunded` is what suspends a
    // licence, and a delisting that pre-empted the refund decision would be making it.
    const licence = await commerce.Licence.findOne({ entitlementId: entitlement._id }).lean();
    expect(licence!.status).toBe("active");
  });

  it("audits it with the reason and the number affected", async () => {
    await vendor();
    await publishedProduct();
    await customerWhoBought();

    await lifecycle.emergencyDelist(PRODUCT, "Malware in the installer.", STAFF);

    const audit = await communication.AuditLog.findOne({
      action: "product.emergency_delisted",
    }).lean();
    expect(audit).toBeTruthy();
    expect((audit!.after as { reason?: string }).reason).toBe("Malware in the installer.");
    expect((audit!.after as { entitlementsSuspended?: number }).entitlementsSuspended).toBe(1);
  });

  it("refuses with no reason, and refuses a product that does not exist", async () => {
    await vendor();
    await publishedProduct();

    await expect(lifecycle.emergencyDelist(PRODUCT, "   ", STAFF)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
    await expect(
      lifecycle.emergencyDelist("8b00c46f6c887b38e2f0e0ff", "Anything.", STAFF),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });
});

/* ────────────────────────────────────────────── analytics */

describe("analytics", () => {
  it("is bounded and windowed", async () => {
    const result = await analytics.vendorAnalytics(
      { vendorId: VENDOR },
      { windowDays: 10_000 },
    );

    // Clamped, not honoured. §94 applies to a date range as much as to a row count.
    expect(result.windowDays).toBe(analytics.MAX_WINDOW_DAYS);
    expect(result.from.getTime()).toBeGreaterThan(0);
  });

  /** The honest gap, asserted so nobody quietly fills it with a zero. */
  it("reports no traffic figures rather than a placeholder", async () => {
    const result = await analytics.vendorAnalytics({ vendorId: VENDOR });
    expect(result.traffic).toBeNull();
  });

  it("derives units and earnings from the ledger", async () => {
    await vendor();
    await publishedProduct();

    const order = await commerce.Order.create({
      _id: ORDER,
      reference: "ORD-2026-7001",
      organizationId: ORG,
      userId: USER,
      currency: "GBP",
      items: [
        {
          lineId: "line-1",
          kind: "product_licence" as const,
          productId: PRODUCT,
          productName: "Northwind Dispatch",
          productSlug: "northwind-dispatch",
          quantity: 1,
          unitPrice: { amount: 10_000, currency: "GBP" },
          lineTotal: { amount: 10_000, currency: "GBP" },
          vendorId: VENDOR,
          commissionBasisPoints: 3000,
        },
      ],
      subtotal: { amount: 10_000, currency: "GBP" },
      total: { amount: 10_000, currency: "GBP" },
      status: "paid" as const,
      paidAt: new Date(),
      billingSnapshot: {},
      paymentMethod: "online" as const,
    });

    await ledger.recordEarnings(order.toObject(), undefined);

    const result = await analytics.vendorAnalytics({ vendorId: VENDOR });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]!.units).toBe(1);
    expect(result.products[0]!.earnings).toEqual([{ currency: "GBP", amount: 7_000 }]);
    expect(result.refundRateBasisPoints).toEqual([{ currency: "GBP", rate: 0 }]);
  });

  it("sees nothing of another vendor's figures", async () => {
    await vendor();
    await vendor("verified", OTHER_VENDOR, "southgate");
    await ledger.recordAdjustment(
      { vendorId: OTHER_VENDOR, amount: moneyLib.money(9_999, "GBP"), note: "Theirs." },
      STAFF,
    );

    const result = await analytics.vendorAnalytics({ vendorId: VENDOR });
    expect(result.products).toEqual([]);
  });

  it("refuses an empty vendor scope rather than reporting the whole platform", async () => {
    const scope = await import("@/lib/auth/scope");
    await expect(analytics.vendorAnalytics({ vendorId: "" })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
    await expect(analytics.actionItems({ vendorId: "  " })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
  });

  it("leads with what needs doing", async () => {
    await vendor();
    await catalog.Product.create({
      name: "Needs work",
      slug: "needs-work",
      summary: "Sent back.",
      status: "changes_requested" as const,
      vendorId: VENDOR,
      vendorSlug: "northwind",
      vendorName: "Northwind Labs",
    });

    const items = await analytics.actionItems({ vendorId: VENDOR });

    expect(items.map((item) => item.kind)).toContain("changes_requested");
    expect(items[0]!.message).toContain("changes");
  });
});
