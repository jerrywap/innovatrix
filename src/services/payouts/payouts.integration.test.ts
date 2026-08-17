import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Payouts — vendor ticket 09.
 *
 * The most expensive bug this system can have is paying twice, so most of this file is about
 * the three guards that stop it:
 *
 *  1. **A draft claims its entries**, so a second batch cannot see money the first is about to
 *     send.
 *  2. **Entries move to `paid` inside the transaction** that marks the payout `paid`, guarded on
 *     them still being `cleared` and still claimed by *this* payout.
 *  3. **Every transition is guarded on the current status**, so a retried confirmation finds
 *     nothing to change.
 *
 * The rest is the part a vendor experiences: that they are either paid or told why not.
 */

let mongoose: typeof import("mongoose").default;
let payouts: typeof import("./payout-service");
let statement: typeof import("./statement");
let ledger: typeof import("@/services/vendors/ledger-service");
let ledgerModels: typeof import("@/lib/db/models/ledger");
let vendors: typeof import("@/lib/db/models/vendors");
let commerce: typeof import("@/lib/db/models/commerce");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");

let moneyLib: typeof import("@/lib/money");

const VENDOR = "7e00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "7e00c46f6c887b38e2f0e0a2";
const USER = "7e00c46f6c887b38e2f0e0b1";
const ORG = "7e00c46f6c887b38e2f0e0b2";
const PRODUCT = "7e00c46f6c887b38e2f0e0c1";

const STAFF = { type: "staff", userId: USER, name: "Fin" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "payouts_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  payouts = await import("./payout-service");
  statement = await import("./statement");
  ledger = await import("@/services/vendors/ledger-service");
  ledgerModels = await import("@/lib/db/models/ledger");
  vendors = await import("@/lib/db/models/vendors");
  commerce = await import("@/lib/db/models/commerce");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");
  moneyLib = await import("@/lib/money");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await ledgerModels.LedgerEntry.syncIndexes();
  await ledgerModels.Payout.syncIndexes();
  await ledgerModels.PayoutSkip.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  // Through the driver: ledger deletion is refused on the model by design (vendor ticket 08),
  // and relaxing that for a test would throw away the guarantee.
  await ledgerModels.LedgerEntry.collection.deleteMany({});
  await ledgerModels.Payout.deleteMany({});
  await ledgerModels.PayoutSkip.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await commerce.Order.deleteMany({});
  await commerce.PaymentSettings.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
  await mongoose.connection.collection("counters").deleteMany({});
});

/* ────────────────────────────────────────────── fixtures */

/** A vendor who can be paid: verified, business-verified, account on file. */
async function payableVendor(overrides: Record<string, unknown> = {}, id = VENDOR) {
  return vendors.Vendor.create({
    _id: id,
    displayName: "Northwind Labs",
    slug: `northwind-${id.slice(-4)}`,
    contactEmail: "ada@northwind.test",
    country: "GB",
    pitch: "We build dispatch tooling.",
    appliedAt: new Date(),
    status: "verified",
    verification: {
      identity: { status: "approved", decidedAt: new Date() },
      business: { status: "approved", decidedAt: new Date() },
    },
    payout: {
      accountName: "Northwind Labs Ltd",
      accountIdentifier: "12345678",
      bankName: "Example Bank",
      country: "GB",
      updatedAt: new Date(),
    },
    ...overrides,
  });
}

/** A paid order with one vendor line, and the cleared earning it produced. */
async function clearedEarning(amountMinor = 10_000, vendorId = VENDOR) {
  const order = await commerce.Order.create({
    reference: `ORD-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
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
        unitPrice: { amount: amountMinor, currency: "GBP" },
        lineTotal: { amount: amountMinor, currency: "GBP" },
        vendorId,
        commissionBasisPoints: 3000,
      },
    ],
    subtotal: { amount: amountMinor, currency: "GBP" },
    total: { amount: amountMinor, currency: "GBP" },
    status: "paid" as const,
    paidAt: new Date(),
    billingSnapshot: {},
    paymentMethod: "online" as const,
  });

  await ledger.recordEarnings(order.toObject(), undefined);
  // Straight to cleared: the sweep is tested in `ledger.integration.test.ts`, and waiting
  // thirty days is not available to us.
  await ledgerModels.LedgerEntry.updateMany(
    { orderId: order._id },
    { $set: { status: "cleared" } },
  );

  return order;
}

/* ────────────────────────────────────────────── drafting */

describe("draftBatch", () => {
  it("drafts a payout for a payable vendor and claims the entries", async () => {
    await payableVendor();
    await clearedEarning(); // £100 at 30% ⇒ £70 to the vendor

    const outcome = await payouts.draftBatch();

    expect(outcome.drafted).toHaveLength(1);
    expect(outcome.drafted[0]!.amount.amount).toBe(7_000);
    expect(outcome.drafted[0]!.reference).toMatch(/^POU-\d{4}-\d{4}$/);

    const payout = await ledgerModels.Payout.findOne({}).lean();
    expect(payout!.status).toBe("draft");
    expect(payout!.entryIds).toHaveLength(1);

    // The claim, which is what stops a second batch seeing the same money.
    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(String(entry!.payoutId)).toBe(String(payout!._id));
    // And it is still `cleared` — only a settled transfer makes it `paid`.
    expect(entry!.status).toBe("cleared");
  });

  it("sums its entries to exactly its amount", async () => {
    await payableVendor();
    await clearedEarning(10_000);
    await clearedEarning(5_000);

    await payouts.draftBatch();

    const payout = await ledgerModels.Payout.findOne({}).lean();
    const entries = await ledgerModels.LedgerEntry.find({
      _id: { $in: payout!.entryIds },
    }).lean();

    const total = entries.reduce((acc, entry) => acc + entry.amount.amount, 0);
    expect(total).toBe(payout!.amount.amount);
    expect(total).toBe(7_000 + 3_500);
  });

  /** Guard 2: re-running the sweep produces one draft per vendor per period, not two. */
  it("is idempotent across runs", async () => {
    await payableVendor();
    await clearedEarning();

    await payouts.draftBatch();
    const second = await payouts.draftBatch();

    expect(second.drafted).toHaveLength(0);
    expect(await ledgerModels.Payout.countDocuments({})).toBe(1);
  });

  it("cannot claim an entry a previous payout already holds", async () => {
    await payableVendor();
    await clearedEarning();
    await payouts.draftBatch();

    // A different period, so the unique index does not refuse — the *claim* is what has to.
    const later = await payouts.draftBatch({
      now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
    });

    expect(later.drafted).toHaveLength(0);
    expect(await ledgerModels.Payout.countDocuments({})).toBe(1);
  });

  it("sees nothing of another vendor's entries", async () => {
    await payableVendor();
    await payableVendor({}, OTHER_VENDOR);
    await clearedEarning(10_000, OTHER_VENDOR);

    const outcome = await payouts.draftBatch();

    expect(outcome.drafted).toHaveLength(1);
    expect(outcome.drafted[0]!.vendorId).toBe(OTHER_VENDOR);
  });
});

/* ────────────────────────────────────────────── skips */

describe("skipping, with a reason the vendor can read", () => {
  async function reasonFor(vendorOverrides: Record<string, unknown>, earn = true) {
    await payableVendor(vendorOverrides);
    if (earn) await clearedEarning();

    const outcome = await payouts.draftBatch();
    const skip = await ledgerModels.PayoutSkip.findOne({}).lean();

    return { outcome, skip };
  }

  it("skips a vendor whose business verification is incomplete", async () => {
    const { outcome, skip } = await reasonFor({
      verification: {
        identity: { status: "approved" },
        business: { status: "pending" },
      },
    });

    expect(outcome.drafted).toHaveLength(0);
    expect(skip!.reason).toBe("unverified");
  });

  it("skips a vendor with no payout account", async () => {
    const { skip } = await reasonFor({ payout: undefined });
    expect(skip!.reason).toBe("no_account");
  });

  it("skips a suspended vendor", async () => {
    const { skip } = await reasonFor({ status: "suspended" });
    expect(skip!.reason).toBe("suspended");
  });

  it("skips a balance below the threshold, and records what it was", async () => {
    await payableVendor();
    await clearedEarning(1_000); // £10 ⇒ £7 earned, under the £50 default

    await payouts.draftBatch();

    const skip = await ledgerModels.PayoutSkip.findOne({}).lean();
    expect(skip!.reason).toBe("below_threshold");
    expect(skip!.balance).toMatchObject({ amount: 700, currency: "GBP" });
    // And the entry is left unclaimed, so it rolls into the next run.
    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.payoutId).toBeUndefined();
  });

  it("skips a negative balance", async () => {
    await payableVendor();
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(-2_000, "GBP"), note: "Chargeback." },
      STAFF,
    );

    await payouts.draftBatch();

    const skip = await ledgerModels.PayoutSkip.findOne({}).lean();
    expect(skip!.reason).toBe("negative_balance");
    expect(await ledgerModels.Payout.countDocuments({})).toBe(0);
  });

  it("honours a configured threshold over the default", async () => {
    await commerce.PaymentSettings.create({
      singleton: "global",
      payoutThresholds: [{ currency: "GBP", amount: 10_000 }],
    } as never);
    await payableVendor();
    await clearedEarning(10_000); // £70 earned, under a £100 threshold

    await payouts.draftBatch();

    expect((await ledgerModels.PayoutSkip.findOne({}).lean())!.reason).toBe("below_threshold");
  });

  /** One row per period, overwritten — not an ever-growing pile of identical reasons. */
  it("records one skip per period however often the batch runs", async () => {
    await payableVendor({ payout: undefined });
    await clearedEarning();

    await payouts.draftBatch();
    await payouts.draftBatch();

    expect(await ledgerModels.PayoutSkip.countDocuments({})).toBe(1);
  });
});

/* ────────────────────────────────────────────── the human path */

describe("approve, send, confirm", () => {
  async function aDraft() {
    await payableVendor();
    await clearedEarning();
    const outcome = await payouts.draftBatch();
    return outcome.drafted[0]!.payoutId;
  }

  it("cannot be sent before it is approved", async () => {
    const payoutId = await aDraft();

    // `StateTransitionError` lives in `@/lib/errors`, not in the states module — the graph
    // is data there and the error is shared with every other state machine.
    await expect(payouts.send(payoutId, STAFF)).rejects.toBeInstanceOf(
      errors.StateTransitionError,
    );
  });

  it("approves, then sends, and the manual driver leaves it sending", async () => {
    const payoutId = await aDraft();

    expect((await payouts.approve(payoutId, STAFF)).status).toBe("approved");
    expect((await payouts.send(payoutId, STAFF)).status).toBe("sending");

    // Nothing settled yet: the money has not moved, and a driver that reported `paid` here
    // would put "we paid you" on a vendor's screen on the strength of a button click.
    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.status).toBe("cleared");
  });

  it("settles the entries when the transfer is confirmed", async () => {
    const payoutId = await aDraft();
    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);

    const paid = await payouts.markPaid(payoutId, { externalReference: "FT123" }, STAFF);

    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect(paid.externalReference).toBe("FT123");

    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.status).toBe("paid");

    // And the vendor's balance has moved from payable to paid.
    const [balance] = await ledger.balanceFor({ vendorId: VENDOR });
    expect(balance!.cleared).toBe(0);
    expect(balance!.paid).toBe(7_000);
  });

  /** Guard 3: a retried confirmation changes nothing. */
  it("is idempotent on confirmation", async () => {
    const payoutId = await aDraft();
    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);

    const first = await payouts.markPaid(payoutId, { externalReference: "FT123" }, STAFF);
    const second = await payouts.markPaid(payoutId, { externalReference: "FT999" }, STAFF);

    expect(second.status).toBe("paid");
    // The second attempt did not overwrite the reference, and did not double-settle.
    expect(second.externalReference).toBe("FT123");
    expect(second.paidAt?.getTime()).toBe(first.paidAt?.getTime());
    expect(await ledgerModels.LedgerEntry.countDocuments({ status: "paid" })).toBe(1);
  });

  /**
   * The transaction guard, provoked directly.
   *
   * A refund reversing an entry between draft and confirmation is the real scenario. Paying
   * it anyway would settle money against a figure nobody can reproduce, so the whole
   * confirmation aborts.
   */
  it("refuses to settle when one of its entries is no longer payable", async () => {
    const payoutId = await aDraft();
    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);

    await ledgerModels.LedgerEntry.updateMany({}, { $set: { status: "reversed" } });

    await expect(payouts.markPaid(payoutId, {}, STAFF)).rejects.toBeInstanceOf(
      errors.ConflictError,
    );

    // Nothing moved — not the payout, not the entry.
    const payout = await payouts.findById(payoutId);
    expect(payout!.status).toBe("sending");
    expect((await ledgerModels.LedgerEntry.findOne({}).lean())!.status).toBe("reversed");
  });

  it("records who approved and who sent it", async () => {
    const payoutId = await aDraft();
    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);

    const payout = await payouts.findById(payoutId);
    expect(String(payout!.approvedByUserId)).toBe(USER);
    expect(String(payout!.sentByUserId)).toBe(USER);

    const audit = await communication.AuditLog.find({
      action: { $in: ["payout.status_changed", "payout.paid"] },
    }).lean();
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

/* ────────────────────────────────────────────── failure and cancellation */

describe("failure", () => {
  async function sendingPayout() {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();
    const payoutId = drafted[0]!.payoutId;
    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);
    return payoutId;
  }

  it("returns the payout to approved with the reason, entries still cleared", async () => {
    const payoutId = await sendingPayout();

    const after = await payouts.markFailed(payoutId, "The account number was rejected.", STAFF);

    expect(after.status).toBe("approved");
    expect(after.failureReason).toBe("The account number was rejected.");

    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.status).toBe("cleared");
    // Still claimed, so the retry pays the same entries rather than a redrafted set.
    expect(String(entry!.payoutId)).toBe(payoutId);
  });

  it("can be retried after a failure", async () => {
    const payoutId = await sendingPayout();
    await payouts.markFailed(payoutId, "Bank refused it.", STAFF);

    expect((await payouts.send(payoutId, STAFF)).status).toBe("sending");
    expect((await payouts.markPaid(payoutId, {}, STAFF)).status).toBe("paid");
    expect(await ledgerModels.LedgerEntry.countDocuments({ status: "paid" })).toBe(1);
  });
});

describe("cancellation", () => {
  it("releases the claim so a later batch redrafts the money", async () => {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();

    await payouts.cancel(drafted[0]!.payoutId, "Vendor asked us to hold it.", STAFF);

    const entry = await ledgerModels.LedgerEntry.findOne({}).lean();
    expect(entry!.payoutId).toBeUndefined();
    expect(entry!.status).toBe("cleared");

    // A later period drafts it again — the money was never lost.
    const later = await payouts.draftBatch({
      now: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
    });
    expect(later.drafted).toHaveLength(1);
  });

  it("refuses a cancellation with no reason", async () => {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();

    await expect(payouts.cancel(drafted[0]!.payoutId, "   ", STAFF)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });
});

/* ────────────────────────────────────────────── the statement */

describe("the statement", () => {
  it("reconciles against the ledger and the order lines", async () => {
    await payableVendor();
    await clearedEarning(10_000);
    const { drafted } = await payouts.draftBatch();

    const payout = await payouts.findById(drafted[0]!.payoutId);
    const built = await statement.buildStatement(payout!);

    expect(built.lines).toHaveLength(1);
    // £100 sale, £30 commission, £70 net — derived from the frozen order line, not stored.
    expect(built.lines[0]!.gross!.amount).toBe(10_000);
    expect(built.lines[0]!.commission!.amount).toBe(3_000);
    expect(built.lines[0]!.net.amount).toBe(7_000);
    expect(built.lines[0]!.orderReference).toBeTruthy();
    expect(built.lines[0]!.productName).toBe("Northwind Dispatch");

    expect(statement.statementReconciles(built)).toEqual({
      ok: true,
      lineDrift: 0,
      totalDrift: 0,
    });
  });

  it("is final once the payout is paid, and not before", async () => {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();
    const payoutId = drafted[0]!.payoutId;

    expect((await statement.buildStatement((await payouts.findById(payoutId))!)).final).toBe(
      false,
    );

    await payouts.approve(payoutId, STAFF);
    await payouts.send(payoutId, STAFF);
    await payouts.markPaid(payoutId, {}, STAFF);

    expect((await statement.buildStatement((await payouts.findById(payoutId))!)).final).toBe(
      true,
    );
  });

  it("shows the account only when asked, and always masked", async () => {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();
    const payout = await payouts.findById(drafted[0]!.payoutId);

    const forMember = await statement.buildStatement(payout!);
    expect(forMember.vendor.account).toBeUndefined();

    const forOwner = await statement.buildStatement(payout!, { includeAccount: true });
    expect(forOwner.vendor.account!.masked).toBe("••••5678");
    // The full identifier never appears anywhere in the projection.
    expect(JSON.stringify(forOwner)).not.toContain("12345678");
  });

  it("carries an adjustment as a net line with its note and no gross", async () => {
    await payableVendor();
    await clearedEarning();
    await ledger.recordAdjustment(
      { vendorId: VENDOR, amount: moneyLib.money(2_500, "GBP"), note: "Goodwill credit." },
      STAFF,
    );

    const { drafted } = await payouts.draftBatch();
    const built = await statement.buildStatement(
      (await payouts.findById(drafted[0]!.payoutId))!,
    );

    const adjustment = built.lines.find((line) => line.kind === "adjustment")!;
    expect(adjustment.gross).toBeUndefined();
    expect(adjustment.note).toBe("Goodwill credit.");
    expect(built.amount.amount).toBe(7_000 + 2_500);
    // And the totals still reconcile with an adjustment in the mix.
    expect(statement.statementReconciles(built).ok).toBe(true);
  });

  it("states what happened about tax rather than leaving it implied", async () => {
    await payableVendor();
    await clearedEarning();
    const { drafted } = await payouts.draftBatch();
    const built = await statement.buildStatement(
      (await payouts.findById(drafted[0]!.payoutId))!,
    );

    expect(built.taxNote).toBe(statement.NO_WITHHOLDING_NOTE);
  });
});

/* ────────────────────────────────────────────── references and scoping */

describe("references", () => {
  it("uses its own prefix and does not collide with inbound payments", async () => {
    await payableVendor();
    await clearedEarning();
    await payouts.draftBatch();

    const payout = await ledgerModels.Payout.findOne({}).lean();
    expect(payout!.reference.startsWith("POU-")).toBe(true);

    // The inbound counter is untouched — a shared counter would make two documents share a
    // number and a support conversation ambiguous.
    const counters = await mongoose.connection.collection("counters").find({}).toArray();
    expect(counters.map((row) => row._id)).toContain(
      `reference:POU:${new Date().getUTCFullYear()}`,
    );
    expect(counters.map((row) => row._id)).not.toContain(
      `reference:PAY:${new Date().getUTCFullYear()}`,
    );
  });
});

describe("scoping", () => {
  it("does not return one vendor's payout to another", async () => {
    await payableVendor();
    await clearedEarning();
    await payouts.draftBatch();

    const payout = await ledgerModels.Payout.findOne({}).lean();

    expect(await payouts.findByReference(payout!.reference, { vendorId: VENDOR })).toBeTruthy();
    expect(
      await payouts.findByReference(payout!.reference, { vendorId: OTHER_VENDOR }),
    ).toBeNull();
    expect(await payouts.listForVendor({ vendorId: OTHER_VENDOR })).toEqual([]);
  });

  it("refuses an empty vendor scope rather than widening", async () => {
    const scope = await import("@/lib/auth/scope");
    await expect(payouts.listForVendor({ vendorId: "" })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
  });
});
