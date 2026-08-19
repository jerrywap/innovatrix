import "server-only";
import { LedgerEntry, type LedgerEntryDoc, type PayoutDoc } from "@/lib/db/models/ledger";
import { Order, type OrderDoc } from "@/lib/db/models/commerce";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import { connectToDatabase } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import {
  isCurrencyCode,
  money,
  percentage,
  subtract,
  sum,
  type CurrencyCode,
  type Money,
} from "@/lib/money";
import { netOfDiscount } from "@/services/vendors/commission-service";

/**
 * The self-billed statement — vendor ticket 09.
 *
 * The platform is merchant of record (decision **V4**), so the vendor never invoiced the
 * customer and cannot invoice us for a share of something they did not bill. We therefore
 * issue the document *on their behalf*, which is what "self-billed" means, and it says so on
 * its face — a document that looks like a vendor invoice but was written by us would
 * misrepresent who charged whom.
 *
 * ## Derived, not stored
 *
 * There is no statement collection. The statement is a **projection of the payout and the
 * ledger entries it settles**, and that is what makes "immutable once paid" true rather than
 * promised: a paid payout's `entryIds` never change, ledger entries are append-only, and the
 * order lines behind them were frozen at checkout (§61). Re-rendering next year produces the
 * same document because every input is immutable.
 *
 * Storing a rendered copy would add a second source of truth whose only advantage — "the
 * vendor downloads exactly what they were sent" — is already guaranteed by the data. This is
 * the same argument ticket 22 settled for quotes, and the reason the statement is
 * print-styled HTML rather than a generated PDF.
 */

export interface StatementLine {
  entryId: string;
  kind: LedgerEntryDoc["kind"];
  /** The order the earning came from, where there is one. */
  orderReference?: string;
  productName?: string;
  /** What the customer paid for the line, net of discount and before tax. */
  gross?: Money;
  /** What CoSetup kept. */
  commission?: Money;
  /** What the vendor earned — the figure this payout settles. */
  net: Money;
  note?: string;
  at: Date;
}

export interface Statement {
  reference: string;
  status: PayoutDoc["status"];
  method: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt?: Date;
  externalReference?: string;
  amount: Money;
  /** Sums across the lines, for the box at the bottom. */
  totals: { gross: Money; commission: Money; net: Money };
  lines: StatementLine[];
  vendor: {
    id: string;
    displayName: string;
    contactEmail: string;
    country: string;
    account?: { accountName?: string; bankName?: string; masked?: string };
  };
  /** Immutable once paid — the screen says so, and the reason is above. */
  final: boolean;
  /**
   * What we did about tax — decision **V5**.
   *
   * Stated rather than left implied, even though the answer is "nothing": a statement that
   * is silent about withholding invites a vendor to assume whichever answer suits them.
   */
  taxNote: string;
}

export const NO_WITHHOLDING_NOTE =
  "No tax has been withheld from this payout. You are responsible for accounting for your " +
  "own tax on these earnings.";

export async function buildStatement(
  payout: PayoutDoc,
  options: { includeAccount?: boolean } = {},
): Promise<Statement> {
  await connectToDatabase();

  const currency = payout.amount.currency;
  if (!isCurrencyCode(currency)) {
    // `MoneySchema` validated it on the way in, so this is unreachable rather than defensive
    // — and throwing is right, because the alternative is guessing an exponent and
    // misstating somebody's income.
    throw new NotFoundError("payout", { id: String(payout._id) });
  }

  const [vendor, entries] = await Promise.all([
    Vendor.findById(payout.vendorId).lean<VendorDoc>(),
    LedgerEntry.find({ _id: { $in: payout.entryIds } })
      .sort({ createdAt: 1 })
      .lean<LedgerEntryDoc[]>(),
  ]);

  if (!vendor) throw new NotFoundError("vendor", { id: String(payout.vendorId) });

  // One query for every order behind the entries, not one per line.
  const orderIds = [
    ...new Set(
      entries
        .map((e) => e.orderId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const orders = orderIds.length
    ? await Order.find({ _id: { $in: orderIds } })
        .select({ reference: 1, items: 1, subtotal: 1, discount: 1, currency: 1 })
        .lean<OrderDoc[]>()
    : [];
  const ordersById = new Map(orders.map((order) => [String(order._id), order]));

  const lines = entries.map((entry) =>
    lineFor(entry, ordersById.get(String(entry.orderId)), currency),
  );

  const zero = money(0, currency);
  const totals = {
    gross: sum(
      lines.map((line) => line.gross ?? zero),
      currency,
    ),
    commission: sum(
      lines.map((line) => line.commission ?? zero),
      currency,
    ),
    net: sum(
      lines.map((line) => line.net),
      currency,
    ),
  };

  return {
    reference: payout.reference,
    status: payout.status,
    method: payout.method,
    periodStart: payout.periodStart,
    periodEnd: payout.periodEnd,
    ...(payout.paidAt ? { paidAt: payout.paidAt } : {}),
    ...(payout.externalReference ? { externalReference: payout.externalReference } : {}),
    amount: money(payout.amount.amount, currency),
    totals,
    lines,
    vendor: {
      id: String(vendor._id),
      displayName: vendor.displayName,
      contactEmail: vendor.contactEmail,
      country: vendor.country,
      // Only when the caller is the owner. A statement is readable by any member (they need
      // to reconcile it), and the account is not — so the field is opt-in rather than
      // filtered out by whoever renders it.
      ...(options.includeAccount && vendor.payout
        ? {
            account: {
              ...(vendor.payout.accountName ? { accountName: vendor.payout.accountName } : {}),
              ...(vendor.payout.bankName ? { bankName: vendor.payout.bankName } : {}),
              ...(vendor.payout.accountIdentifier
                ? { masked: maskAccount(vendor.payout.accountIdentifier) }
                : {}),
            },
          }
        : {}),
    },
    final: payout.status === "paid",
    taxNote: NO_WITHHOLDING_NOTE,
  };
}

/**
 * One line, reconciled back to the order line that produced it.
 *
 * The gross and the commission are **recomputed** from the order line using the same
 * `netOfDiscount` and the rate snapshotted at checkout, rather than stored on the entry. The
 * entry holds the vendor's net, which is the money; deriving the other two from the frozen
 * order means the statement reconciles against the ledger *and* against the original order,
 * which is exactly the acceptance criterion. Storing all three would let them drift.
 */
function lineFor(
  entry: LedgerEntryDoc,
  order: OrderDoc | undefined,
  currency: CurrencyCode,
): StatementLine {
  const net = money(entry.amount.amount, currency);

  const base: StatementLine = {
    entryId: String(entry._id),
    kind: entry.kind,
    net,
    at: entry.createdAt,
    ...(entry.note ? { note: entry.note } : {}),
    ...(order ? { orderReference: order.reference } : {}),
  };

  // An adjustment has no order line, and inventing a gross for it would be a fiction. It
  // shows as a net figure and its note, which is all there is.
  if (!order || !entry.orderLineId) return base;

  const line = order.items.find((item) => item.lineId === entry.orderLineId);
  if (!line || typeof line.commissionBasisPoints !== "number") return base;

  const lineTotal = money(line.lineTotal.amount, currency);
  const subtotal = money(order.subtotal.amount, currency);
  const discount =
    order.discount?.amount && order.discount.amount > 0
      ? money(order.discount.amount, currency)
      : null;

  const gross = netOfDiscount(lineTotal, subtotal, discount);
  const commission = percentage(gross, line.commissionBasisPoints);

  return {
    ...base,
    productName: line.productName,
    // A refund line is negative, and so are its gross and commission — the statement reads
    // as arithmetic rather than as a mystery deduction.
    ...(entry.kind === "refund"
      ? { gross: negateMoney(gross), commission: negateMoney(commission) }
      : { gross, commission }),
  };
}

function negateMoney(value: Money): Money {
  return money(-value.amount, value.currency);
}

/**
 * Last four characters only.
 *
 * Enough to confirm "yes, that is my account" and not enough to be worth stealing. The full
 * identifier lives behind the owner-only settings form and is never rendered anywhere else.
 */
function maskAccount(identifier: string): string {
  const trimmed = identifier.replace(/\s+/g, "");
  return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`;
}

/**
 * Does the statement add up?
 *
 * `gross - commission === net`, per line, and the line nets sum to the payout amount. Used by
 * the integration suite and available to a staff screen — the acceptance criterion asks for
 * statement lines that reconcile against the ledger *and* against the order lines, and this
 * is that question asked in one call.
 */
export function statementReconciles(statement: Statement): {
  ok: boolean;
  lineDrift: number;
  totalDrift: number;
} {
  let lineDrift = 0;
  for (const line of statement.lines) {
    if (!line.gross || !line.commission) continue;
    lineDrift += subtract(subtract(line.gross, line.commission), line.net).amount;
  }

  const totalDrift = subtract(statement.totals.net, statement.amount).amount;
  return { ok: lineDrift === 0 && totalDrift === 0, lineDrift, totalDrift };
}
