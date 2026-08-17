import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/dates";
import type { OrderStatus } from "@/lib/db/enums";
import type { Money } from "@/lib/money";
import { Order, Payment, type OrderDoc, type PaymentDoc } from "@/lib/db/models/commerce";
import { Entitlement, type EntitlementDoc } from "@/lib/db/models/commerce";

/**
 * One order, from the customer's side — §61, §14.
 *
 * ## Separate from `features/payments/orders-view.ts`, deliberately
 *
 * That module is the admin's, and its loader is **not** org-scoped: staff read
 * across organisations, which is legitimate for them and would be a breach
 * here. Reusing it with an added filter would put the safe and the unsafe path
 * one argument apart; a customer loader that cannot be called without an
 * organisation id is the safer shape.
 *
 * ## Scope comes from the session
 *
 * `organizationId` is supplied by `requireOrg()` at the page, never from the
 * URL. The reference alone is not an authorisation — it is printed on emails
 * and quoted in support threads.
 *
 * ## Nothing is recomputed
 *
 * Line prices are the frozen snapshot written at checkout (§61). A product
 * repriced since must not change what this says was paid.
 */

export interface CustomerOrderLine {
  productName: string;
  packageName?: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  addons: Array<{ name: string; price: Money }>;
}

export interface CustomerOrderDetail {
  id: string;
  reference: string;
  status: OrderStatus;
  paymentMethod: "online" | "offline";
  currency: string;
  placedAt: string;
  paidAt?: string;
  lines: CustomerOrderLine[];
  subtotal: Money;
  discount?: Money;
  tax?: Money;
  total: Money;
  billing: OrderDoc["billingSnapshot"];
  /** Newest last — this is a history, not a queue. */
  payments: Array<{
    id: string;
    reference: string;
    status: string;
    amount: Money;
    at: string;
  }>;
  /** What the order actually produced, once it is paid. */
  entitlements: Array<{ id: string; productName: string }>;
  /** True while the customer still owes money on it. */
  awaitingPayment: boolean;
}

export async function loadCustomerOrder(
  reference: string,
  organizationId: string,
): Promise<CustomerOrderDetail | null> {
  await connectToDatabase();

  const order = await Order.findOne({
    reference: reference.toUpperCase(),
    // Both halves matter. Without the organisation this is an enumeration of
    // every order on the platform by a reference that appears in emails.
    organizationId: toObjectId(organizationId),
  }).lean<OrderDoc & { createdAt: Date }>();

  if (!order) return null;

  const [payments, entitlements] = await Promise.all([
    Payment.find({ subjectType: "order", subjectId: order._id })
      .sort({ createdAt: 1 })
      .lean<Array<PaymentDoc & { createdAt: Date }>>(),
    Entitlement.find({ orderId: order._id, organizationId: order.organizationId }).lean<
      EntitlementDoc[]
    >(),
  ]);

  return {
    id: String(order._id),
    reference: order.reference,
    status: order.status,
    paymentMethod: order.paymentMethod ?? "online",
    currency: order.currency,
    placedAt: formatDateTime(order.createdAt),
    ...(order.paidAt ? { paidAt: formatDateTime(order.paidAt) } : {}),
    // Add-ons are order *lines* with a `parentLineId`, not a field on the line
    // they belong to — so they are nested here for rendering rather than in the
    // schema, where flat lines are what keeps §61's snapshot simple.
    lines: order.items
      .filter((item) => !item.parentLineId)
      .map((item) => ({
        productName: item.productName,
        ...(item.licencePackageName ? { packageName: item.licencePackageName } : {}),
        quantity: item.quantity,
        unitPrice: toMoney(item.unitPrice),
        lineTotal: toMoney(item.lineTotal),
        addons: order.items
          .filter((addon) => addon.parentLineId === item.lineId)
          .map((addon) => ({
            name: addon.addonName ?? addon.productName,
            price: toMoney(addon.lineTotal),
          })),
      })),
    subtotal: toMoney(order.subtotal),
    // `?.amount`, not `?`: Mongoose materialises an unset nested path as `{}`,
    // so the object is always truthy. The model says so at `discount`.
    ...(order.discount?.amount ? { discount: toMoney(order.discount) } : {}),
    ...(order.tax?.amount ? { tax: toMoney(order.tax) } : {}),
    total: toMoney(order.total),
    billing: order.billingSnapshot,
    payments: payments
      .filter((payment) => payment.status !== "pending" || payment.provider !== "manual")
      .map((payment) => ({
        id: String(payment._id),
        reference: payment.reference,
        status: payment.status,
        amount: toMoney(payment.amount),
        at: formatDateTime(payment.createdAt),
      })),
    // The name comes from the order line the entitlement was issued for, which
    // is the frozen snapshot — not from the product, which may have been
    // renamed since.
    entitlements: entitlements.map((entitlement) => ({
      id: String(entitlement._id),
      productName:
        order.items.find((item) => item.lineId === entitlement.orderLineId)?.productName ??
        "Your software",
    })),
    awaitingPayment: order.status === "awaiting_payment",
  };
}

/**
 * The stored shape into the `Money` type.
 *
 * `MoneyDocument.currency` is a `string` because that is what BSON gives back;
 * `Money.currency` is the eight-member union the formatter switches on. The
 * cast is confined here rather than repeated at every render, and it is honest:
 * the value was written by `money.ts` in the first place.
 */
function toMoney(value: { amount: number; currency: string }): Money {
  return { amount: value.amount, currency: value.currency as Money["currency"] };
}
