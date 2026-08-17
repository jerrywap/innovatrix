import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * The earnings ledger — vendor ticket 08.
 *
 * The arithmetic is a unit test. What needs a database is everything that makes the ledger
 * *trustworthy*, which is a different claim from "the split is right":
 *
 *  1. **One earning per line, ever.** A retried webhook must not pay twice, and the guard
 *     is a unique index rather than a check-then-write.
 *  2. **Append-only for real**, on the model, not in a repository — because
 *     `LedgerEntry.deleteMany(...)` never passes through one.
 *  3. **A refund reverses rather than deletes**, and behaves differently depending on
 *     whether the money had already been paid out.
 *  4. **Clearance is idempotent** and never early.
 *  5. **A balance is derived**, per currency, and never sums across currencies.
 */

let mongoose: typeof import("mongoose").default;
let ledger: typeof import("./ledger-service");
let ledgerModels: typeof import("@/lib/db/models/ledger");
let commerce: typeof import("@/lib/db/models/commerce");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");
let scope: typeof import("@/lib/auth/scope");
let moneyLib: typeof import("@/lib/money");

const VENDOR = "7d00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "7d00c46f6c887b38e2f0e0a2";
const USER = "7d00c46f6c887b38e2f0e0b1";
const ORG = "7d00c46f6c887b38e2f0e0b2";
const PRODUCT = "7d00c46f6c887b38e2f0e0c1";

const ACTOR = { type: "staff", userId: USER, name: "Fin" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "ledger_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  ledger = await import("./ledger-service");
  ledgerModels = await import("@/lib/db/models/ledger");
  commerce = await import("@/lib/db/models/commerce");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");
  scope = await import("@/lib/auth/scope");
  moneyLib = await import("@/lib/money");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await ledgerModels.LedgerEntry.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  // `deleteMany` on the model is refused by design, so the cleanup goes through the
  // driver. That is not a workaround for a bug — it is the guard working, and doing it
  // here rather than relaxing the model is the point.
  await ledgerModels.LedgerEntry.collection.deleteMany({});
  await commerce.Order.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
});

/** An order with one vendor line at 30% and one first-party line. */
function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    reference: "ORD-2026-9001",
    organizationId: ORG,
    userId: USER,
    currency: "GBP",
    items: [
      {
        lineId: "line-vendor",
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
      {
        lineId: "line-ours",
        kind: "product_licence" as const,
        productId: PRODUCT,
        productName: "Atlas",
        productSlug: "atlas",
        quantity: 1,
        unitPrice: { amount: 5_000, currency: "GBP" },
        lineTotal: { amount: 5_000, currency: "GBP" },
      },
    ],
    subtotal: { amount: 15_000, currency: "GBP" },
    total: { amount: 15_000, currency: "GBP" },
    status: "paid" as const,
    billingSnapshot: {},
    paymentMethod: "online" as const,
    ...overrides,
  };
}

describe("recordEarnings", () => {
  it("writes one entry per vendor line and none for ours", async () => {
    const order = await commerce.Order.create(orderFixture());

    const { written } = await ledger.recordEarnings(order.toObject(), undefined);
    expect(written).toBe(1);

    const entries = await ledgerModels.LedgerEntry.find({}).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.orderLineId).toBe("line-vendor");
    // £100 at 30% → the vendor keeps £70.
    expect(entries[0]!.amount).toMatchObject({ amount: 7_000, currency: "GBP" });
    expect(entries[0]!.status).toBe("pending");
    expect(entries[0]!.clearsAt).toBeInstanceOf(Date);
  });

  it("does nothing at all for a first-party-only order", async () => {
    const fixture = orderFixture();
    fixture.items = [fixture.items[1]!];
    const order = await commerce.Order.create(fixture);

    expect(await ledger.recordEarnings(order.toObject(), undefined)).toEqual({ written: 0 });
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(0);
  });

  /**
   * The retried-webhook case, and the reason the unique index is on
   * `(orderId, orderLineId, kind)` rather than on the order alone.
   */
  it("refuses a second earning for the same line", async () => {
    const order = await commerce.Order.create(orderFixture());
    await ledger.recordEarnings(order.toObject(), undefined);

    await expect(ledger.recordEarnings(order.toObject(), undefined)).rejects.toThrow();
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(1);
  });

  it("takes the fee on the discounted total, not the list price", async () => {
    // £30 off a £150 order: the £100 vendor line carries £20 of it, so the fee is 30% of
    // £80 = £24 and the vendor keeps £56.
    const order = await commerce.Order.create(
      orderFixture({
        discount: { code: "SPRING", amount: 3_000, currency: "GBP" },
        total: { amount: 12_000, currency: "GBP" },
      }),
    );

    await ledger.recordEarnings(order.toObject(), undefined);

    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.amount.amount).toBe(5_600);
  });

  /**
   * A rate change between checkout and fulfilment must not move the money.
   *
   * The line carries the rate, so the only way this test can fail is if somebody replaces
   * the read with a resolve — which is exactly the regression worth catching.
   */
  it("uses the rate on the line rather than resolving one", async () => {
    const fixture = orderFixture();
    fixture.items[0]!.commissionBasisPoints = 1_000;
    const order = await commerce.Order.create(fixture);

    await ledger.recordEarnings(order.toObject(), undefined);

    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.amount.amount).toBe(9_000);
  });

  it("skips a vendor line with no snapshotted rate rather than guessing one", async () => {
    const fixture = orderFixture();
    delete (fixture.items[0] as Record<string, unknown>).commissionBasisPoints;
    const order = await commerce.Order.create(fixture);

    expect(await ledger.recordEarnings(order.toObject(), undefined)).toEqual({ written: 0 });
  });
});

describe("append-only", () => {
  async function anEntry() {
    const order = await commerce.Order.create(orderFixture());
    await ledger.recordEarnings(order.toObject(), undefined);
    return ledgerModels.LedgerEntry.findOne({});
  }

  it("refuses deleteOne, deleteMany and findOneAndDelete on the model", async () => {
    await anEntry();

    await expect(ledgerModels.LedgerEntry.deleteMany({})).rejects.toThrow(/append-only/i);
    await expect(ledgerModels.LedgerEntry.deleteOne({})).rejects.toThrow(/append-only/i);
    await expect(ledgerModels.LedgerEntry.findOneAndDelete({})).rejects.toThrow(/append-only/i);
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(1);
  });

  it("refuses to amend an amount, and allows a status change", async () => {
    const entry = (await anEntry())!;

    entry.amount = { amount: 99, currency: "GBP" };
    await expect(entry.save()).rejects.toThrow(/cannot be changed/i);

    const fresh = (await ledgerModels.LedgerEntry.findById(entry._id))!;
    fresh.status = "cleared";
    await expect(fresh.save()).resolves.toBeTruthy();
  });
});

describe("clawBackEarnings", () => {
  async function paidOrderWithEarning() {
    const order = await commerce.Order.create(orderFixture());
    await ledger.recordEarnings(order.toObject(), undefined);
    return order;
  }

  it("writes a negative entry and reverses the original when it had not been paid", async () => {
    const order = await paidOrderWithEarning();

    expect(await ledger.clawBackEarnings(order.toObject(), undefined)).toEqual({
      reversed: 1,
    });

    const entries = await ledgerModels.LedgerEntry.find({}).sort({ kind: 1 }).lean();
    expect(entries).toHaveLength(2);

    const earning = entries.find((e) => e.kind === "earning")!;
    const refund = entries.find((e) => e.kind === "refund")!;

    expect(earning.status).toBe("reversed");
    expect(refund.amount.amount).toBe(-7_000);
    expect(refund.status).toBe("cleared");
    // The two net to nothing — which is the property that makes a balance query correct
    // without a special case for refunds.
    expect(earning.amount.amount + refund.amount.amount).toBe(0);
  });

  /**
   * The case that must **not** be tidied away.
   *
   * A paid earning stays `paid`: the money genuinely left, and marking it reversed would
   * make the payout that sent it unreconcilable. The balance goes negative instead, which
   * is the honest answer and what reduces the next payout.
   */
  it("leaves an already-paid earning alone and lets the balance go negative", async () => {
    const order = await paidOrderWithEarning();
    await ledgerModels.LedgerEntry.updateOne({}, { $set: { status: "paid" } });

    await ledger.clawBackEarnings(order.toObject(), undefined);

    const earning = await ledgerModels.LedgerEntry.findOne({ kind: "earning" }).lean();
    expect(earning!.status).toBe("paid");

    const [balance] = await ledger.balanceFor({ vendorId: VENDOR });
    expect(balance!.paid).toBe(7_000);
    expect(balance!.cleared).toBe(-7_000);
  });

  it("is a no-op on an order with no earnings", async () => {
    const fixture = orderFixture();
    fixture.items = [fixture.items[1]!];
    const order = await commerce.Order.create(fixture);

    expect(await ledger.clawBackEarnings(order.toObject(), undefined)).toEqual({
      reversed: 0,
    });
  });
});

describe("clearDueEarnings", () => {
  async function earningDue(clearsAt: Date) {
    const order = await commerce.Order.create(orderFixture());
    await ledger.recordEarnings(order.toObject(), undefined);
    await ledgerModels.LedgerEntry.updateOne({}, { $set: { clearsAt } });
  }

  it("clears what is due", async () => {
    await earningDue(new Date(Date.now() - 1000));

    expect(await ledger.clearDueEarnings()).toEqual({ cleared: 1 });
    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.status).toBe("cleared");
  });

  it("leaves what is not due, however close", async () => {
    await earningDue(new Date(Date.now() + 60_000));

    expect(await ledger.clearDueEarnings()).toEqual({ cleared: 0 });
    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.status).toBe("pending");
  });

  /** The property that makes the sweep safe to run twice, or by hand from `/admin/jobs`. */
  it("is idempotent", async () => {
    await earningDue(new Date(Date.now() - 1000));

    expect(await ledger.clearDueEarnings()).toEqual({ cleared: 1 });
    expect(await ledger.clearDueEarnings()).toEqual({ cleared: 0 });
  });

  it("does not resurrect a reversed entry", async () => {
    await earningDue(new Date(Date.now() - 1000));
    await ledgerModels.LedgerEntry.updateOne({}, { $set: { status: "reversed" } });

    expect(await ledger.clearDueEarnings()).toEqual({ cleared: 0 });
  });
});

describe("recordAdjustment", () => {
  it("writes a cleared entry and audits it", async () => {
    const entry = await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(-2_500, "GBP"), note: "Chargeback fee." },
      ACTOR,
    );

    expect(entry.status).toBe("cleared");
    expect(entry.amount).toMatchObject({ amount: -2_500, currency: "GBP" });

    const audit = await communication.AuditLog.findOne({ action: "ledger.adjusted" }).lean();
    expect(audit).toBeTruthy();
    expect(String(audit!.subjectId)).toBe(VENDOR);
  });

  it("refuses an empty note and a zero amount", async () => {
    await expect(
      ledger.recordAdjustment(
        { vendorId: VENDOR, amount: moneyLib.money(100, "GBP"), note: "   " },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    await expect(
      ledger.recordAdjustment(
        { vendorId: VENDOR, amount: moneyLib.money(0, "GBP"), note: "Nothing." },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(0);
  });

  /** Many adjustments are legitimate; the unique index must not be in their way. */
  it("allows several adjustments for one vendor", async () => {
    for (const note of ["One.", "Two.", "Three."]) {
      await ledger.recordAdjustment(
        { vendorId: VENDOR, amount: moneyLib.money(100, "GBP"), note },
        ACTOR,
      );
    }
    expect(await ledgerModels.LedgerEntry.countDocuments({})).toBe(3);
  });
});

describe("balanceFor", () => {
  it("groups by currency and never sums across them", async () => {
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(1_000, "GBP"), note: "Credit." },
      ACTOR,
    );
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(500_00, "NGN"), note: "Credit." },
      ACTOR,
    );

    const balances = await ledger.balanceFor({ vendorId: VENDOR });
    expect(balances.map((b) => b.currency)).toEqual(["GBP", "NGN"]);
    expect(balances[0]!.cleared).toBe(1_000);
    expect(balances[1]!.cleared).toBe(500_00);
  });

  it("sees nothing of another vendor's ledger", async () => {
    await ledger.recordAdjustment(
      { vendorId: OTHER_VENDOR, amount: moneyLib.money(9_999, "GBP"), note: "Theirs." },
      ACTOR,
    );

    expect(await ledger.balanceFor({ vendorId: VENDOR })).toEqual([]);
    expect(await ledger.listEntries({ vendorId: VENDOR })).toEqual([]);
  });

  /**
   * An empty scope must throw rather than widen.
   *
   * The same guard `orgFilter` has, for the same reason: `{ vendorId: "" }` reaching Mongo
   * as `{}` would show one vendor the whole platform's money.
   */
  it("refuses an empty scope", async () => {
    await expect(ledger.balanceFor({ vendorId: "" })).rejects.toBeInstanceOf(scope.ScopeError);
    await expect(ledger.listEntries({ vendorId: "  " })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
  });

  it("keeps a reversed pair out of every bucket", async () => {
    const order = await commerce.Order.create(orderFixture());
    await ledger.recordEarnings(order.toObject(), undefined);
    await ledger.clawBackEarnings(order.toObject(), undefined);

    const [balance] = await ledger.balanceFor({ vendorId: VENDOR });
    // The earning is `reversed` (in no bucket) and the refund is `cleared` at -£70. A
    // vendor's payable figure showing a negative is the honest reading of a refund on
    // money that never cleared; what must not happen is `pending` still showing £70.
    expect(balance!.pending).toBe(0);
    expect(balance!.cleared).toBe(-7_000);
  });
});

describe("clearedEntriesFor", () => {
  it("returns one currency's cleared entries oldest first", async () => {
    for (const note of ["First.", "Second."]) {
      await ledger.recordAdjustment(
        { vendorId: VENDOR, amount: moneyLib.money(100, "GBP"), note },
        ACTOR,
      );
    }
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(100, "NGN"), note: "Other currency." },
      ACTOR,
    );

    const entries = await ledger.clearedEntriesFor(VENDOR, "GBP");
    expect(entries.map((e) => e.note)).toEqual(["First.", "Second."]);
  });
});

describe("reconcile", () => {
  const WINDOW = [new Date("2026-01-01"), new Date("2026-12-31")] as const;

  it("reports no drift when every line has its entry", async () => {
    const order = await commerce.Order.create(orderFixture({ paidAt: new Date("2026-06-01") }));
    await ledger.recordEarnings(order.toObject(), undefined);

    const { rows, truncated } = await ledger.reconcile(WINDOW[0], WINDOW[1]);
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row!.currency).toBe("GBP");
    expect(row!.lines).toBe(1);
    expect(row!.entries).toBe(1);
    expect(row!.drift).toBe(0);
    // £100 net, £30 to us, £70 to them — and the three add up, which is the claim.
    expect(row!.orderedNet).toBe(10_000);
    expect(row!.ledgerEarnings).toBe(7_000);
    expect(row!.platformFees).toBe(3_000);
    expect(row!.ledgerEarnings + row!.platformFees).toBe(row!.orderedNet);
  });

  /**
   * The finding that matters most, and the one a two-total comparison would hide.
   *
   * A paid order whose earning was never written is a vendor silently unpaid. It is named
   * by reference so somebody can repair it, and the drift carries the size of the hole.
   */
  it("names a paid vendor line with no ledger entry", async () => {
    await commerce.Order.create(orderFixture({ paidAt: new Date("2026-06-01") }));

    const { rows } = await ledger.reconcile(WINDOW[0], WINDOW[1]);
    expect(rows[0]!.missingEntries).toEqual(["ORD-2026-9001:line-vendor"]);
    expect(rows[0]!.entries).toBe(0);
    expect(rows[0]!.drift).toBe(7_000);
  });

  /** An entry that disagrees with the order it came from. */
  it("reports drift when an entry does not match its line", async () => {
    const order = await commerce.Order.create(orderFixture({ paidAt: new Date("2026-06-01") }));
    await ledger.recordEarnings(order.toObject(), undefined);
    // Not through the model — amending an amount is refused there, which is the point.
    await ledgerModels.LedgerEntry.collection.updateOne(
      { kind: "earning" },
      { $set: { "amount.amount": 6_000 } },
    );

    const { rows } = await ledger.reconcile(WINDOW[0], WINDOW[1]);
    expect(rows[0]!.drift).toBe(1_000);
  });

  it("ignores an unpaid order and one outside the window", async () => {
    await commerce.Order.create(
      orderFixture({ reference: "ORD-2026-9002", status: "awaiting_payment" }),
    );
    await commerce.Order.create(
      orderFixture({ reference: "ORD-2026-9003", paidAt: new Date("2025-06-01") }),
    );

    const { rows, ordersRead } = await ledger.reconcile(WINDOW[0], WINDOW[1]);
    expect(ordersRead).toBe(0);
    expect(rows).toEqual([]);
  });

  it("counts a refunded order's original lines, so a clawback is visible as drift", async () => {
    const order = await commerce.Order.create(orderFixture({ paidAt: new Date("2026-06-01") }));
    await ledger.recordEarnings(order.toObject(), undefined);
    await ledger.clawBackEarnings(order.toObject(), undefined);

    // The earning still matches its line — the refund is a separate entry, and
    // `reconcile` deliberately compares earnings only. A refund reducing the *balance* is
    // `balanceFor`'s job; conflating the two would make a legitimate refund look like a
    // reconciliation failure.
    const { rows } = await ledger.reconcile(WINDOW[0], WINDOW[1]);
    expect(rows[0]!.drift).toBe(0);
  });
});
