import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { OrderStatus } from "@/lib/db/enums";
import { Order, Payment, type OrderDoc, type PaymentDoc } from "@/lib/db/models/commerce";
import { Organization, User } from "@/lib/db/models/identity";

/**
 * Orders, for the admin side — ticket 11 plus offline payment.
 *
 * ## Awaiting a transfer sorts first, and that is the whole point of the screen
 *
 * An order paid by card needs nobody. An order awaiting a bank transfer is
 * work: somebody has to check the account, match the reference, and record it.
 * A list sorted newest-first buries those under a week of card orders, so they
 * lead — the same reasoning as the staff queues being oldest-first.
 */

export interface AdminOrderRow {
  id: string;
  reference: string;
  organizationName: string;
  status: OrderStatus;
  paymentMethod: "online" | "offline";
  total: { amount: number; currency: string };
  createdAt: string;
  /** Days since it was placed — only meaningful while it is unpaid. */
  ageDays: number;
}

export interface AdminOrderList {
  awaitingTransfer: AdminOrderRow[];
  others: AdminOrderRow[];
}

export async function listAdminOrders(
  filter: { status?: OrderStatus } = {},
): Promise<AdminOrderList> {
  await connectToDatabase();

  const rows = await Order.find({
    status: filter.status ?? { $ne: "draft" },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean<Array<OrderDoc & { createdAt: Date }>>();

  if (rows.length === 0) return { awaitingTransfer: [], others: [] };

  // One lookup for the page, not one per row.
  const organizations = await Organization.find({
    _id: { $in: rows.map((row) => row.organizationId) },
  })
    .select({ name: 1 })
    .lean<{ _id: unknown; name: string }[]>();
  const orgName = new Map(organizations.map((org) => [String(org._id), org.name]));

  const now = Date.now();
  const mapped: AdminOrderRow[] = rows.map((row) => ({
    id: String(row._id),
    reference: row.reference,
    organizationName: orgName.get(String(row.organizationId)) ?? "Unknown",
    status: row.status,
    paymentMethod: row.paymentMethod ?? "online",
    total: row.total,
    createdAt: new Date(row.createdAt).toISOString().slice(0, 10),
    ageDays: Math.floor((now - new Date(row.createdAt).getTime()) / 86_400_000),
  }));

  const awaiting = (row: AdminOrderRow) =>
    row.status === "awaiting_payment" && row.paymentMethod === "offline";

  return {
    // Oldest first within the group: the transfer that has been outstanding
    // longest is the one most likely to be a problem.
    awaitingTransfer: mapped.filter(awaiting).sort((a, b) => b.ageDays - a.ageDays),
    others: mapped.filter((row) => !awaiting(row)),
  };
}

/* ────────────────────────────────────────────── detail */

export interface AdminOrderDetail {
  id: string;
  reference: string;
  organizationName: string;
  status: OrderStatus;
  paymentMethod: "online" | "offline";
  currency: string;
  items: OrderDoc["items"];
  subtotal: { amount: number; currency: string };
  total: { amount: number; currency: string };
  billing: OrderDoc["billingSnapshot"];
  createdAt: string;
  paidAt?: string;
  payments: Array<{
    id: string;
    reference: string;
    provider: string;
    status: string;
    amount: { amount: number; currency: string };
    recordedByName?: string;
    hasEvidence: boolean;
    evidenceFilename?: string;
    at: string;
  }>;
}

export async function loadAdminOrder(reference: string): Promise<AdminOrderDetail | null> {
  await connectToDatabase();

  const order = await Order.findOne({ reference: reference.toUpperCase() }).lean<
    OrderDoc & { createdAt: Date }
  >();
  if (!order) return null;

  const [organization, payments] = await Promise.all([
    Organization.findById(order.organizationId).select({ name: 1 }).lean<{ name: string }>(),
    Payment.find({ subjectType: "order", subjectId: order._id })
      .sort({ createdAt: 1 })
      .lean<Array<PaymentDoc & { createdAt: Date }>>(),
  ]);

  const recorders = await User.find({
    _id: {
      $in: payments
        .map((payment) => payment.recordedByUserId)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    },
  })
    .select({ name: 1 })
    .lean<{ _id: unknown; name?: string }[]>();
  const recorderName = new Map(
    recorders.map((user) => [String(user._id), user.name ?? "Staff"]),
  );

  return {
    id: String(order._id),
    reference: order.reference,
    organizationName: organization?.name ?? "Unknown",
    status: order.status,
    paymentMethod: order.paymentMethod ?? "online",
    currency: order.currency,
    items: order.items,
    subtotal: order.subtotal,
    total: order.total,
    billing: order.billingSnapshot,
    createdAt: new Date(order.createdAt).toISOString().slice(0, 10),
    ...(order.paidAt ? { paidAt: new Date(order.paidAt).toISOString().slice(0, 10) } : {}),
    payments: payments.map((payment) => ({
      id: String(payment._id),
      reference: payment.reference,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      ...(payment.recordedByUserId
        ? { recordedByName: recorderName.get(String(payment.recordedByUserId)) ?? "Staff" }
        : {}),
      // A boolean and a filename. **Never the storage key** — this view object
      // crosses to a client component, and the key is the one thing that must
      // stay server-side.
      hasEvidence: Boolean(payment.evidence?.storageKey),
      ...(payment.evidence?.filename ? { evidenceFilename: payment.evidence.filename } : {}),
      at: new Date(payment.createdAt).toISOString().slice(0, 10),
    })),
  };
}

export { toObjectId };
