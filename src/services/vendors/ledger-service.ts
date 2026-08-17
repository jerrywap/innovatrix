import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { LedgerEntry, type LedgerEntryDoc } from "@/lib/db/models/ledger";
import { Order, type OrderDoc } from "@/lib/db/models/commerce";
import type { LedgerEntryKind, LedgerEntryStatus } from "@/lib/db/enums";
import { ValidationError } from "@/lib/errors";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";
import { fromDocument, money, negate, toDocument, type Money } from "@/lib/money";
import { splitLineTotal, netOfDiscount } from "./commission-service";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * What a vendor is owed — vendor ticket 08.
 *
 * Once a vendor is owed money the platform has to answer *how much, for what, and when it
 * became payable* — and answer it the same way twice, six months apart, after a refund.
 * That is what the append-only design is for, and everything here follows from it.
 */

/**
 * How long an earning sits before it is payable — decision **V2**.
 *
 * ## This must exceed the refund window, and nothing enforced that
 *
 * Paying out money that is still refundable turns a refund into a debt: the vendor has the
 * cash, the customer is owed it back, and the platform is between them. So the clearance
 * period has to be longer than the window in which a refund can arrive.
 *
 * The refund window (main decision #5, 14 days) existed **only as prose** — no constant, no
 * setting, nothing in `src/`. `/terms` deliberately states no number of days. So this
 * ticket introduces it, because a relationship between two numbers cannot be enforced when
 * one of them is a sentence in a markdown file.
 *
 * The assertion below is not decoration: it runs at module load, so getting this wrong is a
 * boot failure rather than a vendor paid out of money we then have to claw back.
 */
export const REFUND_WINDOW_DAYS = 14;
export const CLEARANCE_DAYS = 30;

if (CLEARANCE_DAYS <= REFUND_WINDOW_DAYS) {
  throw new Error(
    `CLEARANCE_DAYS (${CLEARANCE_DAYS}) must exceed REFUND_WINDOW_DAYS ` +
      `(${REFUND_WINDOW_DAYS}). Clearing an earning while it is still refundable turns a ` +
      `refund into a debt owed by somebody who has already been paid.`,
  );
}

export function clearanceDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + CLEARANCE_DAYS * 24 * 60 * 60 * 1000);
}

/* ────────────────────────────────────────────── writing earnings */

/**
 * Write one `earning` per vendor line on a paid order.
 *
 * **Called inside `processPaymentSucceeded`'s transaction**, on its session. That is not
 * tidiness: a payment that committed without its earning is a vendor silently not paid, and
 * no sweep can reliably find it later — the order is `paid`, the entitlement exists, and
 * nothing anywhere says money was owed. The audit log makes the same argument for throwing
 * when handed a session.
 *
 * ## The rate comes off the line, never from the vendor
 *
 * `commissionBasisPoints` was snapshotted at checkout (vendor ticket 07) and is read, not
 * resolved. Resolving here would mean a rate change silently rewrote what a vendor earned
 * on an order placed last month — in the platform's favour, which is the worst direction
 * for a mistake in a revenue share.
 *
 * ## Idempotency
 *
 * The unique `(orderId, orderLineId, kind)` index. A retried webhook's second attempt
 * throws a duplicate key, which aborts the transaction — exactly as a duplicate entitlement
 * does — and `processPaymentSucceeded` resets the payment to `pending` so the sweep
 * retries, where the status pre-check short-circuits it. One earning, not two.
 */
export async function recordEarnings(
  order: OrderDoc,
  session: ClientSession | undefined,
): Promise<{ written: number }> {
  const vendorLines = order.items.filter(
    (item) => item.vendorId && typeof item.commissionBasisPoints === "number",
  );
  if (vendorLines.length === 0) return { written: 0 };

  const subtotal = fromDocument(order.subtotal);
  const discount =
    order.discount?.amount && order.discount.amount > 0
      ? money(order.discount.amount, order.currency as never)
      : null;

  const clearsAt = clearanceDate();

  const rows = vendorLines.map((line) => {
    const lineTotal = fromDocument(line.lineTotal)!;
    // The fee is taken on the net line total: after discount, before tax. Tax is never our
    // revenue, and a platform-funded discount should not be charged to the vendor.
    const net = subtotal ? netOfDiscount(lineTotal, subtotal, discount) : lineTotal;
    const { earning } = splitLineTotal(net, line.commissionBasisPoints!);

    return {
      vendorId: line.vendorId!,
      kind: "earning" as const,
      amount: toDocument(earning),
      status: "pending" as const,
      clearsAt,
      orderId: order._id,
      orderLineId: line.lineId,
    };
  });

  await LedgerEntry.create(rows, session ? { session, ordered: true } : { ordered: true });

  return { written: rows.length };
}

/**
 * Claw back the earnings on a refunded order.
 *
 * A **negative entry**, never a deletion or an amendment. If the earning is still `pending`
 * the two net to zero and nothing was ever payable; if it has already been paid out the
 * balance goes negative and the next payout is reduced — recovered from future earnings
 * rather than invoiced.
 *
 * The original is marked `reversed` when it had not cleared, so a balance query does not
 * have to sum a positive and a negative that cancel. When it *had* been paid, the original
 * stays `paid` and the negative row stands on its own — the money genuinely left, and
 * pretending otherwise would make the payout unreconcilable.
 *
 * A vendor whose balance is persistently negative is a commercial conversation, not a code
 * path. This surfaces it; vendor ticket 12 is where staff act on it.
 */
export async function clawBackEarnings(
  order: OrderDoc,
  session: ClientSession | undefined,
): Promise<{ reversed: number }> {
  const earnings = await LedgerEntry.find({ orderId: order._id, kind: "earning" })
    .session(session ?? null)
    .lean<LedgerEntryDoc[]>();

  if (earnings.length === 0) return { reversed: 0 };

  const rows = earnings.map((earning) => ({
    vendorId: earning.vendorId,
    kind: "refund" as const,
    amount: toDocument(negate(fromDocument(earning.amount)!)),
    // A clawback is immediately effective — there is nothing to wait for, and a `clearsAt`
    // would make a debt look like a future credit.
    status: "cleared" as const,
    orderId: earning.orderId,
    orderLineId: earning.orderLineId,
    note: `Refund of order ${order.reference}`,
  }));

  await LedgerEntry.create(rows, session ? { session, ordered: true } : { ordered: true });

  // Only the ones that never became money. A `paid` earning stays `paid`.
  const unpaid = earnings.filter((e) => e.status === "pending" || e.status === "cleared");
  if (unpaid.length > 0) {
    await LedgerEntry.updateMany(
      { _id: { $in: unpaid.map((e) => e._id) } },
      { $set: { status: "reversed" } },
      session ? { session } : {},
    );
  }

  return { reversed: rows.length };
}

/* ────────────────────────────────────────────── clearance */

/**
 * Move earnings whose time has come — the scheduled sweep.
 *
 * **Idempotent by construction**: the filter is `{ status: "pending", clearsAt: { $lte: now } }`,
 * so running it twice in a day changes nothing the second time. One `updateMany`, the same
 * shape as `mark-invoices-overdue`, which is the precedent for a sweep in this codebase.
 *
 * Bounded is not needed here and would be wrong: this is a single indexed `updateMany`
 * rather than a per-document loop, and a batch cap would mean some vendors' money cleared a
 * day late for no reason.
 */
export async function clearDueEarnings(now: Date = new Date()): Promise<{ cleared: number }> {
  await connectToDatabase();

  const result = await LedgerEntry.updateMany(
    { status: "pending", clearsAt: { $lte: now } },
    { $set: { status: "cleared" } },
  );

  return { cleared: result.modifiedCount ?? 0 };
}

/* ────────────────────────────────────────────── adjustments */

/**
 * A staff-created entry, for what the automatic path cannot express.
 *
 * Goodwill credits, chargeback fees, corrections. A ledger without an adjustment path grows
 * a spreadsheet beside it, and then the spreadsheet is the real ledger.
 *
 * A note is **required** — an unexplained adjustment is the row somebody has to reconstruct
 * a year later from an email thread — and the whole thing is audited.
 */
export async function recordAdjustment(
  input: { vendorId: string; amount: Money; note: string },
  actor: AuditActor,
): Promise<LedgerEntryDoc> {
  await connectToDatabase();

  if (!input.note.trim()) {
    throw new ValidationError("An adjustment needs a note saying why.", {
      note: ["Required. Somebody will read this a year from now."],
    });
  }
  if (input.amount.amount === 0) {
    throw new ValidationError("An adjustment of zero changes nothing.", {
      amount: ["Use a non-zero amount."],
    });
  }

  const [entry] = await LedgerEntry.create([
    {
      vendorId: toObjectId(input.vendorId),
      kind: "adjustment",
      amount: toDocument(input.amount),
      // Immediately payable or immediately owed. An adjustment is a decision somebody has
      // already made, so making it wait 30 days would be a second decision nobody took.
      status: "cleared",
      note: input.note.trim(),
    },
  ]);

  if (!entry) throw new Error("LedgerEntry.create returned nothing.");

  await writeAuditLog({
    action: "ledger.adjusted",
    actor,
    subject: { type: "vendor", id: input.vendorId },
    after: { amount: input.amount.amount, currency: input.amount.currency, note: input.note },
  });

  return entry.toObject() as LedgerEntryDoc;
}

/* ────────────────────────────────────────────── reading */

export interface Balance {
  currency: string;
  pending: number;
  cleared: number;
  paid: number;
}

/**
 * A vendor's balance, **derived by summing entries**.
 *
 * No stored balance anywhere. A stored one is a number that can disagree with its own
 * history, and the first time it does you have two figures and no way to know which is the
 * lie.
 *
 * Grouped by currency because `money.ts` refuses cross-currency arithmetic and it is right
 * to: there is no rate to add GBP to NGN at, and inventing one here would be an FX decision
 * nobody took. What happens at payout is decision **V5**.
 */
export async function balanceFor(scope: VendorScope): Promise<Balance[]> {
  await connectToDatabase();

  const rows = await LedgerEntry.aggregate<{
    _id: { currency: string; status: LedgerEntryStatus };
    total: number;
  }>([
    { $match: { ...vendorFilter(scope) } },
    {
      $group: {
        _id: { currency: "$amount.currency", status: "$status" },
        total: { $sum: "$amount.amount" },
      },
    },
  ]);

  const byCurrency = new Map<string, Balance>();
  for (const row of rows) {
    const currency = row._id.currency;
    const balance = byCurrency.get(currency) ?? { currency, pending: 0, cleared: 0, paid: 0 };

    // `reversed` is deliberately in none of the three buckets: it and its negative
    // counterpart cancel, and counting both would show a vendor a pending figure that
    // includes money nobody owes them.
    if (row._id.status === "pending") balance.pending += row.total;
    if (row._id.status === "cleared") balance.cleared += row.total;
    if (row._id.status === "paid") balance.paid += row.total;

    byCurrency.set(currency, balance);
  }

  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface LedgerRow {
  id: string;
  kind: LedgerEntryKind;
  status: LedgerEntryStatus;
  amount: { amount: number; currency: string };
  clearsAt?: Date;
  orderId?: string;
  orderLineId?: string;
  /**
   * The order's reference, resolved for display.
   *
   * A vendor is entitled to know *which sale* a figure came from — without it, an entries
   * list is a column of numbers nobody can check against anything. The customer's order
   * *page* stays theirs; this is the reference and nothing else.
   */
  orderReference?: string;
  payoutId?: string;
  note?: string;
  createdAt: Date;
}

/** Entries for one vendor, newest first, bounded (§94). */
export async function listEntries(
  scope: VendorScope,
  options: { kind?: LedgerEntryKind; status?: LedgerEntryStatus; limit?: number } = {},
): Promise<LedgerRow[]> {
  await connectToDatabase();

  const rows = await LedgerEntry.find({
    ...vendorFilter(scope),
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.status ? { status: options.status } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(options.limit ?? 100, 500))
    .lean<LedgerEntryDoc[]>();

  // One query for the references, not one per row. The alternative — denormalising the
  // reference onto every entry — would put a second copy of a mutable-looking field in an
  // append-only collection, and the join is cheap on a page of fifty.
  const orderIds = [
    ...new Set(
      rows
        .map((row) => row.orderId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const references = new Map<string, string>();
  if (orderIds.length > 0) {
    const orders = await Order.find({ _id: { $in: orderIds } })
      .select({ reference: 1 })
      .lean<Array<{ _id: unknown; reference: string }>>();
    for (const order of orders) references.set(String(order._id), order.reference);
  }

  return rows.map((row) => ({
    id: String(row._id),
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    ...(row.clearsAt ? { clearsAt: row.clearsAt } : {}),
    ...(row.orderId ? { orderId: String(row.orderId) } : {}),
    ...(row.orderLineId ? { orderLineId: row.orderLineId } : {}),
    ...(row.orderId && references.has(String(row.orderId))
      ? { orderReference: references.get(String(row.orderId))! }
      : {}),
    ...(row.payoutId ? { payoutId: String(row.payoutId) } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt,
  }));
}

/**
 * Cleared entries for one vendor in one currency, for a payout to claim.
 *
 * Sorted oldest first so a payout settles the longest-owed money, and the ids are what the
 * payout stores — a payout recording only a total cannot be reconciled against the ledger,
 * and reconciling is the entire reason the ledger is append-only.
 */
export async function clearedEntriesFor(
  vendorId: string,
  currency: string,
  session?: ClientSession,
): Promise<LedgerEntryDoc[]> {
  await connectToDatabase();

  return LedgerEntry.find({
    vendorId: toObjectId(vendorId),
    status: "cleared",
    "amount.currency": currency,
    // Unclaimed only. An entry a draft payout is already holding is not available to a
    // second one — vendor ticket 09's first idempotency guard, and the reason `payoutId` is
    // stamped at draft time rather than at payment.
    payoutId: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .session(session ?? null)
    .lean<LedgerEntryDoc[]>();
}

export interface ReconciliationRow {
  currency: string;
  /** What the vendor lines on paid orders in the window came to, net of discount. */
  orderedNet: number;
  /** What the ledger says the vendors earned. */
  ledgerEarnings: number;
  /** What the platform kept, derived the same way. */
  platformFees: number;
  /** `orderedNet - (ledgerEarnings + platformFees)`. Must be zero. */
  drift: number;
  lines: number;
  entries: number;
  /** Vendor lines with no ledger entry at all — the failure that matters most. */
  missingEntries: string[];
}

/** No reconciliation reads more orders than this in one pass (§94). */
const RECONCILE_LIMIT = 5_000;

/**
 * The ledger against the orders that produced it, for a period.
 *
 * ## Why this recomputes rather than aggregates
 *
 * Summing the ledger and summing the orders in two `$group` stages would answer a weaker
 * question: whether two totals happen to match. What can actually go wrong is *per line* —
 * a rounding rule that drifts a penny, a line whose earning was never written, a discount
 * apportioned twice — and a total can hide all three by cancelling them out.
 *
 * So this walks the vendor lines, applies the **same** `netOfDiscount` and `splitLineTotal`
 * the fulfilment path used, and compares. Reusing those functions is the point: a bug in
 * them would produce a matching wrong answer here, but a bug *between* checkout and the
 * ledger — the far likelier one — shows up as drift or a missing entry.
 *
 * Bounded, and honest about it: `truncated` is returned rather than a silently short answer,
 * because a reconciliation that quietly stopped at five thousand orders and reported zero
 * drift is worse than no reconciliation at all.
 */
export async function reconcile(
  from: Date,
  to: Date,
): Promise<{ rows: ReconciliationRow[]; ordersRead: number; truncated: boolean }> {
  await connectToDatabase();

  const orders = await Order.find({
    status: { $in: ["paid", "fulfilled", "refunded"] },
    paidAt: { $gte: from, $lte: to },
  })
    .select({ items: 1, subtotal: 1, discount: 1, currency: 1, reference: 1 })
    .limit(RECONCILE_LIMIT + 1)
    .lean<OrderDoc[]>();

  const truncated = orders.length > RECONCILE_LIMIT;
  const considered = truncated ? orders.slice(0, RECONCILE_LIMIT) : orders;

  const byCurrency = new Map<string, ReconciliationRow>();
  const row = (currency: string): ReconciliationRow => {
    const existing = byCurrency.get(currency);
    if (existing) return existing;
    const fresh: ReconciliationRow = {
      currency,
      orderedNet: 0,
      ledgerEarnings: 0,
      platformFees: 0,
      drift: 0,
      lines: 0,
      entries: 0,
      missingEntries: [],
    };
    byCurrency.set(currency, fresh);
    return fresh;
  };

  // One query for every entry in the window's orders, rather than one per line.
  const entries = await LedgerEntry.find({
    kind: "earning",
    orderId: { $in: considered.map((order) => order._id) },
  }).lean<LedgerEntryDoc[]>();

  const entryByLine = new Map(
    entries.map((entry) => [`${String(entry.orderId)}:${entry.orderLineId}`, entry]),
  );

  for (const order of considered) {
    const subtotal = fromDocument(order.subtotal);
    const discount =
      order.discount?.amount && order.discount.amount > 0
        ? money(order.discount.amount, order.currency as never)
        : null;

    for (const line of order.items) {
      if (!line.vendorId || typeof line.commissionBasisPoints !== "number") continue;

      const lineTotal = fromDocument(line.lineTotal)!;
      const net = subtotal ? netOfDiscount(lineTotal, subtotal, discount) : lineTotal;
      const { fee, earning } = splitLineTotal(net, line.commissionBasisPoints);

      const current = row(net.currency);
      current.lines += 1;
      current.orderedNet += net.amount;
      current.platformFees += fee.amount;

      const entry = entryByLine.get(`${String(order._id)}:${line.lineId}`);
      if (!entry) {
        // The one finding that is never a rounding question: money was owed and the ledger
        // does not know. Named by order reference and line, so it can be repaired.
        current.missingEntries.push(`${order.reference}:${line.lineId}`);
        // The expected earning still counts, so the drift shows the size of the hole.
        current.drift += earning.amount;
        continue;
      }

      current.entries += 1;
      current.ledgerEarnings += entry.amount.amount;
      current.drift += earning.amount - entry.amount.amount;
    }
  }

  return {
    rows: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    ordersRead: considered.length,
    truncated,
  };
}
