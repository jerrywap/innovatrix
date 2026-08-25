import "server-only";
import type { ClientSession, Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { alert, ALERTS } from "@/lib/alerts";
// The single implementation. This file grew its own in ticket 13, before
// `lib/licence-key.ts` existed — and the two then drifted: fulfilment kept
// producing keys with no check character, which ticket 14's validator rejected.
// A licence that cannot be activated is not a licence.
import { generateLicenceKey } from "@/lib/licence-key";
import { ActivityEvent, type ActivityEventDoc } from "@/lib/db/models/communication";
import {
  Cart,
  Entitlement,
  Licence,
  Order,
  Payment,
  type OrderDoc,
  type PaymentDoc,
} from "@/lib/db/models/commerce";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { orders } from "@/repositories/order.repository";
import { payments } from "@/repositories/payment.repository";
import { clawBackEarnings, recordEarnings } from "@/services/vendors/ledger-service";
import { driverFor } from "./registry";
import {
  cancelProvisioning,
  requestProvisioning,
} from "@/services/checkout/provisioning-service";

/**
 * The one fulfilment path — §13, §62, §87, §64.
 *
 * ## Everything goes through here
 *
 * A webhook, the reconciliation sweep, and a staff member recording a bank
 * transfer all call `processPaymentSucceeded`. Three entry points, one path —
 * so entitlements are created identically however the money was confirmed, and
 * there is exactly one place where "a paid order becomes a licence" is written.
 *
 * ## Why it can be called twice safely
 *
 * Three independent guards, and all three are needed:
 *
 * 1. **`setStatusIfCurrent(pending → succeeded)`** on the payment. The second
 *    caller gets `null` and returns without doing anything.
 * 2. **`setStatusIfCurrent(awaiting_payment → paid)`** on the order, inside the
 *    transaction.
 * 3. **A unique index on `entitlements (orderId, orderLineId)`**, so even if
 *    both got past the first two, the database refuses the second set.
 *
 * The webhook and the sweep racing is not a hypothetical — the sweep exists
 * precisely because webhooks get dropped, so the two run against the same
 * payment routinely.
 *
 * ## The amount is re-verified, and a mismatch does not fulfil
 *
 * §13: "do not trust the webhook payload's amount alone". The provider is asked
 * directly, and the answer must match the order **exactly** — same integer,
 * same currency. Anything else parks the payment in `requires_review` for a
 * human, because a payment that does not match its order is either a bug or an
 * attack and neither should ship licences.
 */

export type FulfilmentSource =
  | "webhook"
  | "reconciliation"
  /** A £0 order, settled in-process by `settleFreeOrder`. No third party asked. */
  | "free"
  | `manual:${string}`;

export interface FulfilmentResult {
  outcome:
    "fulfilled" | "already_processed" | "requires_review" | "not_found" | "not_succeeded";
  paymentId?: string;
  orderReference?: string;
  invoiceReference?: string;
  reason?: string;
}

export async function processPaymentSucceeded(input: {
  provider: PaymentDoc["provider"];
  providerRef: string;
  /** From the webhook, used only as a fallback lookup — never as the amount. */
  fallbackReference?: string;
  source: FulfilmentSource;
  actor: AuditActor;
  /**
   * Manual payments have no provider to ask; staff confirmation is the proof.
   * A `free` payment has none either, and its amount is zero on our own record.
   */
  skipVerification?: boolean;
}): Promise<FulfilmentResult> {
  await connectToDatabase();

  const payment = await findPayment(input.provider, input.providerRef, input.fallbackReference);
  if (!payment) {
    return {
      outcome: "not_found",
      reason: `No payment for ${input.provider}:${input.providerRef}`,
    };
  }

  if (payment.status === "succeeded") {
    // Not an error. A duplicate delivery is normal (§87), and the correct
    // response is to acknowledge and do nothing.
    return { outcome: "already_processed", paymentId: String(payment._id) };
  }

  /* ── independent verification (§13) ────────────────────── */

  let verifiedAmount = payment.amount;
  let paidAt = new Date();

  if (!input.skipVerification) {
    const driver = driverFor(payment.provider);
    const verified = await driver.verify(payment.providerRef);

    if (verified.status !== "succeeded") {
      return {
        outcome: "not_succeeded",
        paymentId: String(payment._id),
        reason: `Provider reports ${verified.status}`,
      };
    }

    verifiedAmount = verified.amount;
    if (verified.paidAt) paidAt = verified.paidAt;
  }

  /* ── an invoice payment settles a balance, not an order ─ */

  if (payment.subjectType === "invoice") {
    return settleInvoice(payment, verifiedAmount, input);
  }

  const order = await Order.findById(payment.subjectId).lean<OrderDoc>();
  if (!order) {
    return { outcome: "not_found", reason: `Payment ${payment.reference} has no order.` };
  }

  /* ── the amount must match exactly ─────────────────────── */

  const matches =
    verifiedAmount.amount === order.total.amount &&
    verifiedAmount.currency.toUpperCase() === order.total.currency.toUpperCase();

  if (!matches) {
    const reason =
      `Verified ${verifiedAmount.amount} ${verifiedAmount.currency} against an order total of ` +
      `${order.total.amount} ${order.total.currency}.`;

    await payments.setStatusIfCurrent(String(payment._id), payment.status, "requires_review", {
      reviewReason: reason,
      verifiedAt: new Date(),
    });

    await writeAuditLog({
      action: "payment.requires_review",
      actor: input.actor,
      subject: { type: "payment", id: String(payment._id) },
      organizationId: String(payment.organizationId),
      after: { reason, provider: payment.provider, orderReference: order.reference },
      source: input.source,
    });

    // Deliberately not thrown: the webhook must still return 200, or the
    // provider retries a payload that will mismatch again every time.
    /*
     * An alert — §95 names `requires_review` explicitly.
     *
     * Money arrived and nothing was released. Every minute this sits unlooked-at
     * is a paying customer with no software, and there is no automatic path out
     * of the state: it exists precisely because a human has to decide.
     */
    alert(ALERTS.paymentRequiresReview, "Payment amount mismatch — nothing fulfilled", {
      payment: payment.reference,
      order: order.reference,
      reason,
    });

    return {
      outcome: "requires_review",
      paymentId: String(payment._id),
      orderReference: order.reference,
      reason,
    };
  }

  /* ── the claim ─────────────────────────────────────────── */

  // Outside the transaction on purpose: it is the gate, and a second caller
  // must be turned away *before* doing any work rather than rolling back after.
  const claimed = await payments.setStatusIfCurrent(
    String(payment._id),
    payment.status,
    "succeeded",
    { verifiedAt: new Date(), paidAt },
  );

  if (!claimed) {
    return { outcome: "already_processed", paymentId: String(payment._id) };
  }

  /* ── one transaction ───────────────────────────────────── */

  try {
    await withTransaction(async (session) => {
      const paidOrder = await orders.setStatusIfCurrent(
        String(order._id),
        "awaiting_payment",
        "paid",
        { paidAt, paymentId: payment._id },
        session,
      );

      // Already paid by the other racer. The payment claim above should have
      // caught it, so this is belt and braces — and cheap.
      if (!paidOrder) return;

      await createEntitlements(order, session);

      /*
       * The vendor's earning — vendor ticket 08.
       *
       * Inside this transaction, on this session, for the same reason the
       * entitlements are: a payment that committed without its earning is a
       * vendor silently not paid, and nothing afterwards can find it. The order
       * is `paid`, the licence exists, and no record anywhere says money was
       * owed.
       *
       * Reads the rate off the line rather than resolving it — the snapshot was
       * taken at checkout and must not be re-derived here, or a rate change
       * would rewrite what a vendor earned on an order placed last month.
       *
       * No-op on a first-party order, which is every order today.
       */
      await recordEarnings(order, session);

      await clearTheCart(order, session);

      await ActivityEvent.create(
        [
          {
            organizationId: order.organizationId,
            subjectType: "order",
            subjectId: order._id,
            type: "PaymentReceived",
            message: `Payment received for ${order.reference}.`,
            actorType: input.source === "webhook" ? "webhook" : "system",
            visibility: "customer",
            payload: { provider: payment.provider, amount: order.total.amount },
          } satisfies Partial<ActivityEventDoc>,
        ],
        { session, ordered: true },
      );

      await writeAuditLog(
        {
          action: "payment.succeeded",
          actor: input.actor,
          subject: { type: "payment", id: String(payment._id) },
          organizationId: String(order.organizationId),
          before: { status: payment.status },
          after: {
            status: "succeeded",
            orderReference: order.reference,
            amount: order.total.amount,
            currency: order.total.currency,
          },
          source: input.source,
        },
        session,
      );
    });
  } catch (error) {
    // The claim already moved the payment to `succeeded`. Rolling it back would
    // let the sweep try again — which is what we want, because the money did
    // arrive and the order is not yet fulfilled.
    await payments.setStatusIfCurrent(String(payment._id), "succeeded", "pending", {
      failureReason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  /*
   * A paid plugin needs somebody to hand over a key — **after** the commit.
   *
   * Deliberately outside the transaction, per the dispatch-after-commit rule in
   * `lib/events`: a notification sent from inside a transaction that then aborts
   * has told a vendor about work that does not exist. The line was already
   * stamped `pending` at checkout, so nothing is lost if this throws — the queue
   * query finds it regardless, and it is the queue, not the notification, that is
   * the record.
   */
  await requestProvisioning(order);

  return {
    outcome: "fulfilled",
    paymentId: String(payment._id),
    orderReference: order.reference,
  };
}

/* ────────────────────────────────────────────── invoices */

/**
 * The invoice half of the same entry point — §63.
 *
 * ## Why this is a branch rather than a second webhook route
 *
 * A provider does not know what it charged for. The webhook says "this
 * `providerRef` succeeded", and which of our records that settles is ours to
 * decide — so the decision is made here, once, off `payment.subjectType`, and
 * every driver, the reconciliation sweep and the manual path all inherit it.
 *
 * ## An invoice payment may legitimately be partial
 *
 * Unlike an order, where the amount must equal the total or nothing ships, an
 * instalment against an invoice is ordinary. What must still match exactly is
 * the amount **we asked the provider for**: `verifiedAmount` against
 * `payment.amount`. A difference there is the provider charging something other
 * than what we initiated, which is the same class of problem as an order
 * mismatch and gets the same answer — a human.
 */
async function settleInvoice(
  payment: PaymentDoc,
  verifiedAmount: { amount: number; currency: string },
  input: { source: FulfilmentSource; actor: AuditActor },
): Promise<FulfilmentResult> {
  const matches =
    verifiedAmount.amount === payment.amount.amount &&
    verifiedAmount.currency.toUpperCase() === payment.amount.currency.toUpperCase();

  if (!matches) {
    const reason =
      `Verified ${verifiedAmount.amount} ${verifiedAmount.currency} against an initiated ` +
      `amount of ${payment.amount.amount} ${payment.amount.currency}.`;

    await payments.setStatusIfCurrent(String(payment._id), payment.status, "requires_review", {
      reviewReason: reason,
      verifiedAt: new Date(),
    });

    return { outcome: "requires_review", paymentId: String(payment._id), reason };
  }

  // The claim, before any work — same reasoning as the order path. Two webhook
  // deliveries for one payment must not apply the money twice.
  const claimed = await payments.setStatusIfCurrent(
    String(payment._id),
    payment.status,
    "succeeded",
    { verifiedAt: new Date(), paidAt: new Date() },
  );

  if (!claimed) return { outcome: "already_processed", paymentId: String(payment._id) };

  try {
    const { applyPayment } = await import("@/services/invoices/invoice-service");

    const result = await applyPayment(
      {
        invoiceId: String(payment.subjectId),
        amount: verifiedAmount.amount,
        currency: verifiedAmount.currency.toUpperCase(),
        paymentReference: payment.reference,
      },
      input.actor,
    );

    return {
      outcome: "fulfilled",
      paymentId: String(payment._id),
      invoiceReference: result.invoice.reference,
    };
  } catch (error) {
    /*
     * The money arrived and we could not record it — an overpayment, a
     * currency mismatch, or a concurrent payment that won the guard. Putting
     * the payment back to `pending` would have the sweep retry something that
     * will fail identically, so it parks in `requires_review` where somebody
     * sees it.
     */
    const reason = error instanceof Error ? error.message : String(error);

    await payments.setStatusIfCurrent(String(payment._id), "succeeded", "requires_review", {
      reviewReason: reason,
    });

    await writeAuditLog({
      action: "payment.requires_review",
      actor: input.actor,
      subject: { type: "payment", id: String(payment._id) },
      organizationId: String(payment.organizationId),
      after: { reason, invoiceId: String(payment.subjectId) },
      source: input.source,
    });

    alert(ALERTS.paymentRequiresReview, "Invoice payment held for review", {
      payment: payment.reference,
      reason,
    });

    return { outcome: "requires_review", paymentId: String(payment._id), reason };
  }
}

/* ────────────────────────────────────────────── entitlements */

/**
 * One entitlement per licence line, with its licence — §64, §65.
 *
 * ## The dates come from the **order**, not from the product
 *
 * `supportMonths` and `updateMonths` were snapshotted at checkout (§61). Reading
 * them off the live licence package here would mean a package edited last week
 * silently shortens a window somebody already paid for.
 *
 * ## Add-on lines produce no entitlement
 *
 * An installation service is work, not a licence. Ticket 19 turns those into
 * project tasks; creating an entitlement for one would put "Installation" in My
 * Software with a download button and nothing behind it.
 */
async function createEntitlements(order: OrderDoc, session: ClientSession): Promise<void> {
  const licenceLines = order.items.filter((item) => item.kind === "product_licence");

  for (const line of licenceLines) {
    const now = new Date();

    const [entitlement] = await Entitlement.create(
      [
        {
          organizationId: order.organizationId,
          productId: line.productId,
          orderId: order._id,
          orderLineId: line.lineId,
          ...(line.versionId ? { purchasedVersionId: line.versionId } : {}),
          ...(line.updateMonths ? { updatesUntil: addMonths(now, line.updateMonths) } : {}),
          ...(line.supportMonths ? { supportUntil: addMonths(now, line.supportMonths) } : {}),
          status: "active",
        },
      ],
      { session, ordered: true },
    );

    await Licence.create(
      [
        {
          key: generateLicenceKey(),
          organizationId: order.organizationId,
          productId: line.productId,
          entitlementId: entitlement!._id,
          type: line.licenceType ?? "single_installation",
          activationLimit: line.activationLimit ?? 1,
          activations: [],
          status: "active",
          ...(line.supportMonths
            ? { supportExpiresAt: addMonths(now, line.supportMonths) }
            : {}),
        },
      ],
      { session, ordered: true },
    );
  }
}

/**
 * Months, calendar-aware.
 *
 * `Date.setMonth` overflows — 31 January plus one month is 3 March — so the day
 * is clamped to the target month's length. A support window that ends two days
 * late is not a disaster; one that silently jumps a month is a billing dispute.
 */
function addMonths(from: Date, months: number): Date {
  const result = new Date(from);
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));

  return result;
}

/**
 * Clear the basket — §13, and **only** here.
 *
 * Not at order creation: an abandoned payment must leave the cart intact and
 * re-purchasable. This runs when the money is confirmed and not before.
 */
async function clearTheCart(order: OrderDoc, session: ClientSession): Promise<void> {
  // The basket the order was actually built from. The `user:` form is the
  // fallback for orders written before `ownerKey` was recorded — and deriving it
  // was what let a free claim, built in a throwaway cart, empty the customer's
  // real basket on the way past (COS-12).
  await Cart.updateOne(
    { ownerKey: order.ownerKey ?? `user:${String(order.userId)}` },
    { $set: { items: [] }, $unset: { discountCode: "" } },
    { session },
  );
}

/* ────────────────────────────────────────────── failure & refund */

export async function processPaymentFailed(input: {
  provider: PaymentDoc["provider"];
  providerRef: string;
  reason?: string;
  actor: AuditActor;
  source: FulfilmentSource;
}): Promise<FulfilmentResult> {
  await connectToDatabase();

  const payment = await findPayment(input.provider, input.providerRef);
  if (!payment) return { outcome: "not_found" };

  const failed = await payments.setStatusIfCurrent(String(payment._id), "pending", "failed", {
    ...(input.reason ? { failureReason: input.reason } : {}),
  });

  if (!failed) return { outcome: "already_processed", paymentId: String(payment._id) };

  await writeAuditLog({
    action: "payment.failed",
    actor: input.actor,
    subject: { type: "payment", id: String(payment._id) },
    organizationId: String(payment.organizationId),
    after: { reason: input.reason ?? "Provider reported a failure." },
    source: input.source,
  });

  // The order stays `awaiting_payment` on purpose: the customer can retry, and
  // cancelling it for them would throw away a sale over a declined card.
  return { outcome: "not_succeeded", paymentId: String(payment._id) };
}

export async function processPaymentRefunded(input: {
  provider: PaymentDoc["provider"];
  providerRef: string;
  actor: AuditActor;
  source: FulfilmentSource;
}): Promise<FulfilmentResult> {
  await connectToDatabase();

  const payment = await findPayment(input.provider, input.providerRef);
  if (!payment) return { outcome: "not_found" };

  const refunded = await payments.setStatusIfCurrent(
    String(payment._id),
    "succeeded",
    "refunded",
  );
  if (!refunded) return { outcome: "already_processed", paymentId: String(payment._id) };

  await withTransaction(async (session) => {
    const order = await Order.findById(payment.subjectId).session(session).lean<OrderDoc>();
    if (!order) return;

    await orders.setStatusIfCurrent(String(order._id), order.status, "refunded", {}, session);

    // Suspended, not revoked. A refund may be a chargeback under dispute, and
    // deleting somebody's licence before that resolves is not reversible.
    await Entitlement.updateMany(
      { orderId: order._id },
      { $set: { status: "suspended" } },
      { session },
    );
    await Licence.updateMany(
      { entitlementId: { $in: await entitlementIds(String(order._id), session) } },
      { $set: { status: "suspended" } },
      { session },
    );

    /*
     * A plugin nobody handed over yet is cancelled, in the same transaction and
     * for the same reason the entitlements are suspended: a refunded order must
     * not leave an open obligation in somebody's queue.
     *
     * Only `pending` lines move. A key already sent cannot be unsent, so
     * `provided` has no outbound edge — that case is a conversation.
     */
    await cancelProvisioning(order, session);

    /*
     * Claw back the vendor's earning — vendor ticket 08.
     *
     * A negative entry beside the earning, never a deletion: if it had not
     * cleared the two net to zero, and if it had already been paid the balance
     * goes negative and the next payout is reduced. The entitlement is
     * *suspended* rather than revoked above for the chargeback-under-dispute
     * case, and the ledger takes the same view — the reversal is recorded, not
     * hidden, so a reinstated licence has a history to read.
     */
    await clawBackEarnings(order, session);

    await writeAuditLog(
      {
        action: "payment.refunded",
        actor: input.actor,
        subject: { type: "payment", id: String(payment._id) },
        organizationId: String(order.organizationId),
        after: { orderReference: order.reference, entitlements: "suspended" },
        source: input.source,
      },
      session,
    );
  });

  return { outcome: "fulfilled", paymentId: String(payment._id) };
}

async function entitlementIds(
  orderId: string,
  session: ClientSession,
): Promise<Types.ObjectId[]> {
  const rows = await Entitlement.find({ orderId: toObjectId(orderId) })
    .select({ _id: 1 })
    .session(session)
    .lean<Array<{ _id: Types.ObjectId }>>();
  return rows.map((row) => row._id);
}

/**
 * Find our payment record.
 *
 * `(provider, providerRef)` first, then the reference the driver echoed into
 * provider metadata. The fallback exists for one real failure: the initiate
 * call succeeded, our `providerRef` write did not, and the webhook then arrives
 * carrying an id we never stored.
 */
async function findPayment(
  provider: PaymentDoc["provider"],
  providerRef: string,
  fallbackReference?: string,
): Promise<PaymentDoc | null> {
  const direct = await payments.findByProviderRef(provider, providerRef);
  if (direct) return direct;

  // The provider ref may itself *be* our reference — Paystack works this way.
  const byOwnReference = await payments.findByReference(providerRef);
  if (byOwnReference) return byOwnReference;

  if (fallbackReference) {
    return payments.findByReference(fallbackReference);
  }

  return null;
}

export { Payment };
