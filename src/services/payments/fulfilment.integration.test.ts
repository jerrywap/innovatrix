import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";
import { isValidLicenceKeyFormat } from "@/lib/licence-key";

/**
 * Ticket 13's guarantees — the most failure-sensitive path in the platform.
 *
 * Every case here is one where getting it wrong means either a customer paid
 * and got nothing, or got two of something they paid once for.
 *
 * The provider's HTTP is stubbed (there are no test credentials), but nothing
 * else is: the transaction, the guarded transitions, the unique indexes and the
 * race are all against a real replica set.
 */

let mongoose: typeof import("mongoose").default;
let fulfilment: typeof import("./fulfilment");
let registry: typeof import("./registry");
let paymentService: typeof import("./payment-service");
let commerce: typeof import("@/lib/db/models/commerce");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const USER = "6a80c46f6c887b38e2f0e0b2";
/** Vendor ticket 08 — the seller on the vendor-line fixtures below. */
const VENDOR = "6a80c46f6c887b38e2f0e0b5";
const ACTOR = { type: "system" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "fulfilment_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  // Both, because `env.ts` refuses a Stripe key without a webhook secret —
  // "unverified webhooks must never reach fulfilment (§87)". A boot-time guard
  // that catches a test's setup is a guard doing its job.
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_x");

  mongoose = (await import("mongoose")).default;
  fulfilment = await import("./fulfilment");
  registry = await import("./registry");
  paymentService = await import("./payment-service");
  commerce = await import("@/lib/db/models/commerce");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    commerce.Order.syncIndexes(),
    commerce.Payment.syncIndexes(),
    commerce.Entitlement.syncIndexes(),
    commerce.Licence.syncIndexes(),
    commerce.Cart.syncIndexes(),
    commerce.WebhookEvent.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await mongoose?.disconnect();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    commerce.Order.deleteMany({}),
    commerce.Payment.deleteMany({}),
    commerce.Entitlement.deleteMany({}),
    commerce.Licence.deleteMany({}),
    commerce.Cart.deleteMany({}),
    commerce.WebhookEvent.deleteMany({}),
    // Through the driver, not the model: ledger deletion is refused there by design
    // (vendor ticket 08), and relaxing that for a test would remove the guarantee.
    mongoose.connection.collection("ledgerEntries").deleteMany({}),
    mongoose.connection.collection("auditLogs").deleteMany({}),
    mongoose.connection.collection("activityEvents").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

const OID = () => new mongoose.Types.ObjectId();

async function paidableOrder(total = 29_999, lines = 1) {
  const order = await commerce.Order.create({
    reference: `ORD-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    organizationId: new mongoose.Types.ObjectId(ORG),
    userId: new mongoose.Types.ObjectId(USER),
    currency: "GBP",
    items: Array.from({ length: lines }, (_, index) => ({
      lineId: `line-${index + 1}`,
      kind: "product_licence",
      productId: OID(),
      productName: `Atlas CRM ${index + 1}`,
      productSlug: `atlas-${index + 1}`,
      versionId: OID(),
      versionNumber: "1.0.0",
      licencePackageKey: "standard",
      licencePackageName: "Standard",
      licenceType: "single_installation",
      activationLimit: 1,
      supportMonths: 12,
      updateMonths: 12,
      quantity: 1,
      unitPrice: { amount: total / lines, currency: "GBP" },
      lineTotal: { amount: total / lines, currency: "GBP" },
    })),
    subtotal: { amount: total, currency: "GBP" },
    total: { amount: total, currency: "GBP" },
    status: "awaiting_payment",
    billingSnapshot: { country: "GB" },
  });

  const payment = await commerce.Payment.create({
    reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    organizationId: new mongoose.Types.ObjectId(ORG),
    provider: "stripe",
    providerRef: `cs_test_${Math.random().toString(36).slice(2, 12)}`,
    subjectType: "order",
    subjectId: order._id,
    amount: { amount: total, currency: "GBP" },
    status: "pending",
  });

  // The basket the customer bought from, which must be cleared on confirmation
  // and not before.
  await commerce.Cart.create({
    ownerKey: `user:${USER}`,
    userId: new mongoose.Types.ObjectId(USER),
    currency: "GBP",
    items: [
      {
        lineId: "line-1",
        kind: "product_licence",
        productId: OID(),
        quantity: 1,
        unitPrice: { amount: total, currency: "GBP" },
        displayName: "Atlas CRM",
      },
    ],
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  return { order, payment };
}

/** Make `verify()` answer without a network call. */
function stubVerify(result: {
  status: "succeeded" | "pending" | "failed";
  amount: number;
  currency?: "GBP" | "NGN" | "USD";
}) {
  return vi.spyOn(registry.driverFor("stripe"), "verify").mockResolvedValue({
    status: result.status,
    amount: { amount: result.amount, currency: result.currency ?? "GBP" },
    paidAt: new Date(),
    raw: {},
  });
}

const succeed = (payment: { provider: string; providerRef: string }) =>
  fulfilment.processPaymentSucceeded({
    provider: payment.provider as "stripe",
    providerRef: payment.providerRef,
    source: "webhook",
    actor: ACTOR,
  });

/* ────────────────────────────────────────────── the happy path */

describe("a verified payment fulfils exactly once", () => {
  it("pays the order, issues a licence, and clears the basket", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    const result = await succeed(payment);
    expect(result.outcome).toBe("fulfilled");

    const paid = await commerce.Order.findById(order._id).lean();
    expect(paid!.status).toBe("paid");
    expect(paid!.paidAt).toBeInstanceOf(Date);

    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);

    // Cleared here, and only here — order creation deliberately leaves it.
    const cart = await commerce.Cart.findOne({ ownerKey: `user:${USER}` }).lean();
    expect(cart!.items).toHaveLength(0);
  });

  it("issues one entitlement per licence line", async () => {
    const { order, payment } = await paidableOrder(60_000, 3);
    stubVerify({ status: "succeeded", amount: 60_000 });

    await succeed(payment);

    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(3);
    expect(await commerce.Licence.countDocuments({})).toBe(3);
  });

  it("sets the support and update windows from the order's snapshot", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    await succeed(payment);

    const entitlement = await commerce.Entitlement.findOne({ orderId: order._id }).lean();
    // 12 months, from the order line — not from a live licence package that
    // may have been edited since.
    const months =
      (entitlement!.updatesUntil!.getUTCFullYear() - new Date().getUTCFullYear()) * 12 +
      (entitlement!.updatesUntil!.getUTCMonth() - new Date().getUTCMonth());
    expect(months).toBe(12);
  });

  it("writes a customer-visible activity event and an audit row", async () => {
    const { payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    await succeed(payment);

    const activity = await mongoose.connection
      .collection("activityEvents")
      .findOne({ type: "PaymentReceived" });
    expect(activity?.visibility).toBe("customer");

    const audit = await mongoose.connection
      .collection("auditLogs")
      .findOne({ action: "payment.succeeded" });
    // The source names which path ran — the acceptance criterion.
    expect(audit?.source).toBe("webhook");
  });
});

/* ────────────────────────────────────────────── idempotency */

describe("duplicate delivery", () => {
  it("five deliveries produce one payment, one transition, one licence", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(await succeed(payment));
    }

    expect(results.filter((r) => r.outcome === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_processed")).toHaveLength(4);

    expect(await commerce.Payment.countDocuments({ status: "succeeded" })).toBe(1);
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);

    const transitions = await mongoose.connection
      .collection("auditLogs")
      .countDocuments({ action: "payment.succeeded" });
    expect(transitions).toBe(1);
  });

  it("survives five *simultaneous* deliveries", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    const results = await Promise.all(Array.from({ length: 5 }, () => succeed(payment)));

    expect(results.filter((r) => r.outcome === "fulfilled")).toHaveLength(1);
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);
  });

  it("produces one fulfilment when a webhook and reconciliation race", async () => {
    // The explicit acceptance criterion. The sweep exists *because* webhooks
    // get dropped, so these two run against the same payment routinely.
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });

    const [viaWebhook, viaSweep] = await Promise.all([
      fulfilment.processPaymentSucceeded({
        provider: "stripe",
        providerRef: payment.providerRef,
        source: "webhook",
        actor: ACTOR,
      }),
      fulfilment.processPaymentSucceeded({
        provider: "stripe",
        providerRef: payment.providerRef,
        source: "reconciliation",
        actor: ACTOR,
      }),
    ]);

    const outcomes = [viaWebhook.outcome, viaSweep.outcome].sort();
    expect(outcomes).toEqual(["already_processed", "fulfilled"]);
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
  });
});

/* ────────────────────────────────────────────── the amount check */

describe("a mismatched amount does not fulfil", () => {
  it("holds the payment for review and issues nothing", async () => {
    const { order, payment } = await paidableOrder(29_999);
    // A valid signature, a real webhook — and the wrong number.
    stubVerify({ status: "succeeded", amount: 100 });

    const result = await succeed(payment);
    expect(result.outcome).toBe("requires_review");

    const held = await commerce.Payment.findById(payment._id).lean();
    expect(held!.status).toBe("requires_review");
    expect(held!.reviewReason).toContain("100");

    // Nothing was issued, and the order did not move.
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(0);
    expect(await commerce.Licence.countDocuments({})).toBe(0);
    expect((await commerce.Order.findById(order._id).lean())!.status).toBe("awaiting_payment");
  });

  it("raises a staff-visible audit entry", async () => {
    const { payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 1 });

    await succeed(payment);

    const alert = await mongoose.connection
      .collection("auditLogs")
      .findOne({ action: "payment.requires_review" });
    expect(alert).toBeTruthy();
  });

  it("treats a currency mismatch as a mismatch", async () => {
    const { payment } = await paidableOrder(29_999);
    // Same integer, different currency. ₦299.99 is not £299.99.
    stubVerify({ status: "succeeded", amount: 29_999, currency: "NGN" });

    expect((await succeed(payment)).outcome).toBe("requires_review");
  });

  it("does not fulfil when the provider says the payment is still pending", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "pending", amount: 29_999 });

    expect((await succeed(payment)).outcome).toBe("not_succeeded");
    expect((await commerce.Order.findById(order._id).lean())!.status).toBe("awaiting_payment");
  });
});

/* ────────────────────────────────────────────── manual payments */

describe("manual payments take the identical path", () => {
  it("creates the same entitlements without asking a provider", async () => {
    const { order } = await paidableOrder();

    const manual = await commerce.Payment.create({
      reference: "PAY-2026-9999",
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: "PAY-2026-9999",
      subjectType: "order",
      subjectId: order._id,
      amount: { amount: 29_999, currency: "GBP" },
      status: "pending",
    });

    const result = await fulfilment.processPaymentSucceeded({
      provider: "manual",
      providerRef: manual.providerRef,
      source: "manual:6a80c46f6c887b38e2f0e001",
      actor: { type: "staff", userId: "6a80c46f6c887b38e2f0e001" },
      skipVerification: true,
    });

    expect(result.outcome).toBe("fulfilled");
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);

    const audit = await mongoose.connection
      .collection("auditLogs")
      .findOne({ action: "payment.succeeded" });
    // The source names the staff member — this is a high-trust action.
    expect(audit?.source).toBe("manual:6a80c46f6c887b38e2f0e001");
  });

  it("still checks the amount, so a typo does not fulfil", async () => {
    const { order } = await paidableOrder(29_999);

    const manual = await commerce.Payment.create({
      reference: "PAY-2026-8888",
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: "PAY-2026-8888",
      subjectType: "order",
      subjectId: order._id,
      // A finger slip: 2999 instead of 29999.
      amount: { amount: 2_999, currency: "GBP" },
      status: "pending",
    });

    const result = await fulfilment.processPaymentSucceeded({
      provider: "manual",
      providerRef: manual.providerRef,
      source: "manual:staff",
      actor: { type: "staff", userId: "6a80c46f6c887b38e2f0e001" },
      skipVerification: true,
    });

    expect(result.outcome).toBe("requires_review");
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(0);
  });
});

/* ────────────────────────────────────────────── failure & refund */

describe("failure and refund", () => {
  it("leaves the order payable after a failed payment", async () => {
    const { order, payment } = await paidableOrder();

    await fulfilment.processPaymentFailed({
      provider: "stripe",
      providerRef: payment.providerRef,
      reason: "Card declined.",
      source: "webhook",
      actor: ACTOR,
    });

    expect((await commerce.Payment.findById(payment._id).lean())!.status).toBe("failed");
    // Still payable. Cancelling for them would throw away a sale over a
    // declined card.
    expect((await commerce.Order.findById(order._id).lean())!.status).toBe("awaiting_payment");
  });

  it("suspends entitlements on a refund rather than deleting them", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });
    await succeed(payment);

    await fulfilment.processPaymentRefunded({
      provider: "stripe",
      providerRef: payment.providerRef,
      source: "webhook",
      actor: ACTOR,
    });

    const entitlement = await commerce.Entitlement.findOne({ orderId: order._id }).lean();
    // Suspended, not revoked or deleted: a refund may be a chargeback under
    // dispute, and destroying the record is not reversible.
    expect(entitlement!.status).toBe("suspended");
    expect((await commerce.Licence.findOne({}).lean())!.status).toBe("suspended");
    expect((await commerce.Order.findById(order._id).lean())!.status).toBe("refunded");
  });
});

/* ────────────────────────────────────────────── ticket 14 */

describe("entitlements and licences — §64, §65", () => {
  it("dates the windows from the order's snapshot", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });
    await succeed(payment);

    const entitlement = await commerce.Entitlement.findOne({ orderId: order._id }).lean();
    const licence = await commerce.Licence.findOne({}).lean();

    // 12 months, from `supportMonths`/`updateMonths` on the order line — not
    // from a live licence package that may have been edited since.
    expect(monthsBetween(new Date(), entitlement!.updatesUntil!)).toBe(12);
    expect(monthsBetween(new Date(), entitlement!.supportUntil!)).toBe(12);
    expect(licence!.activationLimit).toBe(1);
    expect(licence!.type).toBe("single_installation");
    // The version bought is recorded, because §45 says they keep it forever.
    expect(String(entitlement!.purchasedVersionId)).toBe(String(order.items[0]!.versionId));
  });

  it("refuses a second entitlement for the same order line", async () => {
    const { order, payment } = await paidableOrder();
    stubVerify({ status: "succeeded", amount: 29_999 });
    await succeed(payment);

    // The unique index on `(orderId, orderLineId)` is the last of the three
    // guards, and the only one that holds if the other two are ever removed.
    await expect(
      commerce.Entitlement.create({
        organizationId: order.organizationId,
        productId: order.items[0]!.productId,
        orderId: order._id,
        orderLineId: order.items[0]!.lineId,
        status: "active",
      }),
    ).rejects.toThrow(/E11000|duplicate/i);
  });

  it("gives every licence a distinct key", async () => {
    const { payment } = await paidableOrder(60_000, 3);
    stubVerify({ status: "succeeded", amount: 60_000 });
    await succeed(payment);

    const keys = (await commerce.Licence.find({}).lean()).map((licence) => licence.key);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(isValidLicenceKeyFormat(key)).toBe(true);
    }
  });
});

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  );
}

/**
 * Paying by bank transfer — the offline route.
 *
 * The guarantee that matters is the negative one: **an offline order delivers
 * nothing until somebody records the payment.** Anyone can create one, so if
 * that ever stops holding, the platform gives software away to whoever asks.
 *
 * The positive one matters too and is easy to get wrong by building a parallel
 * path: what a recorded transfer produces must be byte-for-byte what a card
 * payment produces, because there is one `processPaymentSucceeded`.
 */
describe("offline payment — the transfer route", () => {
  /** An order placed by transfer: no payment record at all, by design. */
  async function offlineOrder(total = 29_999) {
    const order = await commerce.Order.create({
      reference: `ORD-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      userId: new mongoose.Types.ObjectId(USER),
      currency: "GBP",
      items: [
        {
          lineId: "line-1",
          kind: "product_licence",
          productId: OID(),
          productName: "Atlas CRM",
          productSlug: "atlas-crm",
          versionId: OID(),
          versionNumber: "1.0.0",
          licencePackageKey: "standard",
          licencePackageName: "Standard",
          licenceType: "single_installation",
          activationLimit: 1,
          supportMonths: 12,
          updateMonths: 12,
          quantity: 1,
          unitPrice: { amount: total, currency: "GBP" },
          lineTotal: { amount: total, currency: "GBP" },
        },
      ],
      subtotal: { amount: total, currency: "GBP" },
      total: { amount: total, currency: "GBP" },
      status: "awaiting_payment",
      paymentMethod: "offline",
      billingSnapshot: { country: "GB" },
    });

    return order;
  }

  it("delivers nothing while it sits unpaid", async () => {
    // The whole safety argument for "anyone may choose this".
    const order = await offlineOrder();

    expect(order.status).toBe("awaiting_payment");
    expect(order.paymentMethod).toBe("offline");
    expect(await commerce.Payment.countDocuments({ subjectId: order._id })).toBe(0);
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(0);
    expect(await commerce.Licence.countDocuments({})).toBe(0);
  });

  it("produces exactly what a card payment produces once recorded", async () => {
    const order = await offlineOrder();

    // What `recordManualPaymentAction` does: a manual payment record, then the
    // one fulfilment path with verification skipped.
    const payment = await commerce.Payment.create({
      reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: `manual-${Math.random().toString(36).slice(2, 12)}`,
      subjectType: "order",
      subjectId: order._id,
      amount: order.total,
      status: "pending",
      recordedByUserId: new mongoose.Types.ObjectId(USER),
    });

    const result = await fulfilment.processPaymentSucceeded({
      provider: "manual",
      providerRef: payment.providerRef,
      source: `manual:${USER}`,
      actor: ACTOR,
      skipVerification: true,
    });

    expect(result.outcome).toBe("fulfilled");

    const after = await commerce.Order.findById(order._id).lean();
    expect(after!.status).toBe("paid");
    expect(after!.paidAt).toBeInstanceOf(Date);
    // Unchanged: how they paid is a fact about the order, not a status.
    expect(after!.paymentMethod).toBe("offline");

    // The §64 chain, identical to the card path.
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    const licence = await commerce.Licence.findOne({}).lean();
    expect(licence).not.toBeNull();
    expect(isValidLicenceKeyFormat(licence!.key)).toBe(true);
  });

  /**
   * Vendor ticket 08's criterion, stated as a test rather than as "same function".
   *
   * A bank transfer has no provider behind it, which is exactly why this is worth
   * asserting: if the earning had been written by a provider webhook handler rather than by
   * fulfilment, a vendor selling to a customer who pays by transfer would never be paid, and
   * nothing would look broken.
   */
  it("writes the vendor's earning for a recorded transfer, like any other payment", async () => {
    const order = await offlineOrder(10_000);
    await commerce.Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "items.0.vendorId": new mongoose.Types.ObjectId(VENDOR),
          "items.0.commissionBasisPoints": 3000,
        },
      },
    );

    const payment = await commerce.Payment.create({
      reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: `manual-${Math.random().toString(36).slice(2, 12)}`,
      subjectType: "order",
      subjectId: order._id,
      amount: order.total,
      status: "pending",
      recordedByUserId: new mongoose.Types.ObjectId(USER),
    });

    await fulfilment.processPaymentSucceeded({
      provider: "manual",
      providerRef: payment.providerRef,
      source: `manual:${USER}`,
      actor: ACTOR,
      skipVerification: true,
    });

    const entries = await mongoose.connection.collection("ledgerEntries").find({}).toArray();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toMatchObject({ amount: 7_000, currency: "GBP" });
    expect(entries[0]!.status).toBe("pending");
  });

  it("refuses a mismatched amount without fulfilling anything", async () => {
    // A staff typo must not create licences. There is no provider to catch it,
    // so this check is the only thing standing between a fat finger and a
    // wrongly-fulfilled order.
    const order = await offlineOrder(29_999);

    const payment = await commerce.Payment.create({
      reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: `manual-${Math.random().toString(36).slice(2, 12)}`,
      subjectType: "order",
      subjectId: order._id,
      // £2.99 instead of £299.99 — a decimal-point slip.
      amount: { amount: 299, currency: "GBP" },
      status: "pending",
      recordedByUserId: new mongoose.Types.ObjectId(USER),
    });

    const result = await fulfilment.processPaymentSucceeded({
      provider: "manual",
      providerRef: payment.providerRef,
      source: `manual:${USER}`,
      actor: ACTOR,
      skipVerification: true,
    });

    expect(result.outcome).toBe("requires_review");

    const after = await commerce.Order.findById(order._id).lean();
    expect(after!.status).toBe("awaiting_payment");
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("does not double-fulfil when the same transfer is recorded twice", async () => {
    // Two staff both checking the bank on a Monday morning.
    const order = await offlineOrder();

    const payment = await commerce.Payment.create({
      reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: `manual-${Math.random().toString(36).slice(2, 12)}`,
      subjectType: "order",
      subjectId: order._id,
      amount: order.total,
      status: "pending",
      recordedByUserId: new mongoose.Types.ObjectId(USER),
    });

    const once = {
      provider: "manual" as const,
      providerRef: payment.providerRef,
      source: `manual:${USER}` as const,
      actor: ACTOR,
      skipVerification: true,
    };

    await fulfilment.processPaymentSucceeded(once);
    await fulfilment.processPaymentSucceeded(once);

    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);
  });

  it("keeps the evidence key on the payment, and nothing resembling a URL", async () => {
    // The field is a key precisely so nothing can accidentally render an
    // address for it — the bucket serves any known key unsigned.
    const order = await offlineOrder();

    const payment = await commerce.Payment.create({
      reference: `PAY-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      provider: "manual",
      providerRef: `manual-${Math.random().toString(36).slice(2, 12)}`,
      subjectType: "order",
      subjectId: order._id,
      amount: order.total,
      status: "pending",
      evidence: {
        storageKey: `innovatrix/test/payments/${OID()}/abc-receipt.pdf`,
        filename: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 12_345,
        uploadedAt: new Date(),
      },
    });

    const stored = await commerce.Payment.findById(payment._id).lean();
    expect(stored!.evidence!.storageKey).toMatch(/^innovatrix\//);
    expect(JSON.stringify(stored!.evidence)).not.toMatch(/https?:\/\//);
  });
});

/* ────────────────────────────────────────────── the vendor's earning */

/** A payable order whose single line belongs to a vendor at 30%. */
async function vendorOrder(total = 10_000) {
  const { order, payment } = await paidableOrder(total, 1);

  await commerce.Order.updateOne(
    { _id: order._id },
    {
      $set: {
        "items.0.vendorId": new mongoose.Types.ObjectId(VENDOR),
        "items.0.commissionBasisPoints": 3000,
      },
    },
  );

  return { order, payment };
}

/**
 * Vendor ticket 08 — the earning is written by fulfilment, or it is not written at all.
 *
 * These live here rather than in `ledger.integration.test.ts` because the claim is about
 * *fulfilment*: that the earning shares the entitlement's transaction and the payment's
 * idempotency guards. Testing `recordEarnings` in isolation proves the arithmetic; only this
 * proves a retried webhook cannot pay a vendor twice.
 */
describe("a vendor's earning rides the fulfilment transaction", () => {
  it("writes one earning when the order is paid", async () => {
    const { payment } = await vendorOrder();
    stubVerify({ status: "succeeded", amount: 10_000 });

    await succeed(payment);

    const entries = await mongoose.connection.collection("ledgerEntries").find({}).toArray();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("earning");
    expect(entries[0]!.amount).toMatchObject({ amount: 7_000, currency: "GBP" });
    expect(entries[0]!.status).toBe("pending");
    expect(String(entries[0]!.vendorId)).toBe(VENDOR);
  });

  it("writes nothing for a first-party order", async () => {
    const { payment } = await paidableOrder(10_000, 1);
    stubVerify({ status: "succeeded", amount: 10_000 });

    await succeed(payment);

    expect(await mongoose.connection.collection("ledgerEntries").countDocuments({})).toBe(0);
  });

  /** The retried-webhook case, through the real path rather than the service alone. */
  it("produces one earning across five deliveries", async () => {
    const { payment } = await vendorOrder();
    stubVerify({ status: "succeeded", amount: 10_000 });

    for (let attempt = 0; attempt < 5; attempt += 1) await succeed(payment);

    expect(await mongoose.connection.collection("ledgerEntries").countDocuments({})).toBe(1);
  });

  it("produces one earning across five simultaneous deliveries", async () => {
    const { payment } = await vendorOrder();
    stubVerify({ status: "succeeded", amount: 10_000 });

    await Promise.allSettled(Array.from({ length: 5 }, () => succeed(payment)));

    expect(await mongoose.connection.collection("ledgerEntries").countDocuments({})).toBe(1);
  });

  /**
   * A rolled-back fulfilment leaves **no** ledger entry.
   *
   * The criterion the ticket states, and the reason the write is inside the transaction
   * rather than after it. The failure is injected where a real one would land — the
   * entitlement write — so the earning is already in the session when the abort happens.
   */
  it("leaves no entry when the transaction rolls back", async () => {
    const { payment } = await vendorOrder();
    stubVerify({ status: "succeeded", amount: 10_000 });

    const boom = vi
      .spyOn(commerce.Licence, "create")
      .mockRejectedValue(new Error("injected failure"));

    await expect(succeed(payment)).rejects.toThrow(/injected failure/);
    boom.mockRestore();

    expect(await mongoose.connection.collection("ledgerEntries").countDocuments({})).toBe(0);

    // And the payment is back to `pending` so the sweep retries — the existing
    // behaviour, restated here because the earning now depends on it.
    const after = await commerce.Payment.findById(payment._id).lean();
    expect(after!.status).toBe("pending");
  });

  /** A refund reverses it, through the same path a provider webhook takes. */
  it("claws the earning back on a refund", async () => {
    const { payment } = await vendorOrder();
    stubVerify({ status: "succeeded", amount: 10_000 });
    await succeed(payment);

    await fulfilment.processPaymentRefunded({
      provider: "stripe",
      providerRef: payment.providerRef,
      source: "webhook",
      actor: ACTOR,
    });

    const entries = await mongoose.connection
      .collection("ledgerEntries")
      .find({})
      .sort({ kind: 1 })
      .toArray();

    expect(entries.map((entry) => entry.kind)).toEqual(["earning", "refund"]);
    expect(entries.find((entry) => entry.kind === "earning")!.status).toBe("reversed");
    expect(entries.find((entry) => entry.kind === "refund")!.amount.amount).toBe(-7_000);
  });
});

/**
 * A £0 order — a free script whose plugins are all free too.
 *
 * The point of these two is that fulfilment did not change to allow it: the
 * amount match was already `0 === 0`, and `settleFreeOrder` mints a real
 * `free` Payment so the same `pending → succeeded` claim is the concurrency
 * gate. What is asserted is that the entitlement arrives and that a real order
 * can never take this path.
 */
describe("a free order settles through the same path", () => {
  async function freeOrder(total = 0) {
    return commerce.Order.create({
      reference: `ORD-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      organizationId: new mongoose.Types.ObjectId(ORG),
      userId: new mongoose.Types.ObjectId(USER),
      currency: "GBP",
      items: [
        {
          lineId: "line-1",
          kind: "product_licence",
          productId: OID(),
          productName: "Storefront Starter",
          productSlug: "storefront-starter",
          versionId: OID(),
          versionNumber: "1.0.0",
          licencePackageKey: "standard",
          licencePackageName: "Standard",
          licenceType: "single_installation",
          activationLimit: 1,
          supportMonths: 12,
          updateMonths: 12,
          quantity: 1,
          unitPrice: { amount: total, currency: "GBP" },
          lineTotal: { amount: total, currency: "GBP" },
        },
      ],
      subtotal: { amount: total, currency: "GBP" },
      total: { amount: total, currency: "GBP" },
      status: "awaiting_payment",
      billingSnapshot: { country: "GB" },
    });
  }

  it("issues the entitlement and licence, with a zero payment behind it", async () => {
    const order = await freeOrder();

    const result = await paymentService.settleFreeOrder({
      orderReference: order.reference,
      organizationId: ORG,
      actor: ACTOR,
    });

    expect(result.outcome).toBe("settled");

    // `paid`, not `fulfilled` — the same transition a card payment makes.
    const reread = await commerce.Order.findById(order._id).lean();
    expect(reread!.status).toBe("paid");

    // The licence line got its entitlement, exactly as a paid one would.
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
    expect(await commerce.Licence.countDocuments({})).toBe(1);

    // And there is a real Payment, of zero, so fulfilment had a claim to make.
    const payment = await commerce.Payment.findOne({ subjectId: order._id }).lean();
    expect(payment!.provider).toBe("free");
    expect(payment!.amount.amount).toBe(0);
    expect(payment!.status).toBe("succeeded");
  });

  it("is idempotent, so a double submit does not fulfil twice", async () => {
    const order = await freeOrder();
    const first = await paymentService.settleFreeOrder({
      orderReference: order.reference,
      organizationId: ORG,
      actor: ACTOR,
    });
    const second = await paymentService.settleFreeOrder({
      orderReference: order.reference,
      organizationId: ORG,
      actor: ACTOR,
    });

    expect(first.outcome).toBe("settled");
    expect(second.outcome).toBe("already_settled");
    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(1);
  });

  it("refuses an order that has something to pay", async () => {
    // The second of the two locks against a paid order settling for nothing.
    // The first is that `free` is not in `DRIVERS`, so routing cannot pick it.
    const order = await freeOrder(29_999);

    await expect(
      paymentService.settleFreeOrder({
        orderReference: order.reference,
        organizationId: ORG,
        actor: ACTOR,
      }),
    ).rejects.toThrow(/cannot be settled free/);

    expect(await commerce.Entitlement.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("has no driver, so nothing can route a real payment to it", async () => {
    expect(() => registry.driverFor("free")).toThrow(/no provider driver/);
  });
});
