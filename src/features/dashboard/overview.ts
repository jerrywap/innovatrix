import "server-only";
import { cache } from "react";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { ActivityEvent } from "@/lib/db/models/communication";
import { Entitlement, Order } from "@/lib/db/models/commerce";
import { Invoice, Quote } from "@/lib/db/models/billing";

/**
 * What the dashboard needs — §27, §102.
 *
 * ## Counts come from `countDocuments`, never from loading the rows
 *
 * The acceptance criterion is a first paint under 1.5s with fifty
 * entitlements. Reading fifty documents to display the number `50` is the
 * obvious way to miss it, and it gets slower exactly as a customer becomes more
 * valuable. Every count here is an indexed count.
 *
 * ## Every count reconciles with its list page
 *
 * Also a criterion, and easy to break: "Orders" on the dashboard and the rows
 * at `/dashboard/orders` must agree. They do because both are org-scoped with
 * the same filter — the count is not "all orders ever" while the list quietly
 * hides cancelled ones.
 *
 * ## Attention items are real actions or absent
 *
 * §102: no fabricated urgency. Each item is something the customer can *do*,
 * and links to the thing itself. A customer with nothing outstanding gets an
 * honest empty state rather than cards containing zeroes.
 */

export interface DashboardCounts {
  software: number;
  orders: number;
  quotes: number;
  invoices: number;
  requests: number;
}

export interface AttentionSource {
  kind: "quote_awaiting" | "invoice_unpaid" | "order_awaiting_payment" | "update_available";
  id: string;
  title: string;
  detail?: string;
  href: string;
  urgent: boolean;
  amount?: { amount: number; currency: string };
}

export interface RecentActivity {
  id: string;
  message: string;
  type: string;
  at: string;
}

/* ────────────────────────────────────────────── counts */

export const dashboardCounts = cache(
  async (organizationId: string): Promise<DashboardCounts> => {
    await connectToDatabase();
    const org = toObjectId(organizationId);

    // Parallel, and each one an indexed count. Sequential would be five round
    // trips for a number nobody clicks.
    const [software, orders, quotes, invoices] = await Promise.all([
      Entitlement.countDocuments({ organizationId: org, status: "active" }),
      // Excludes `draft`, which the list page also hides — an order the
      // customer never submitted is not one of "your orders".
      Order.countDocuments({ organizationId: org, status: { $ne: "draft" } }),
      Quote.countDocuments({ organizationId: org, status: "issued" }),
      Invoice.countDocuments({ organizationId: org, status: { $in: ["issued", "overdue"] } }),
    ]);

    return {
      software,
      orders,
      quotes,
      invoices,
      // Requests are ticket 17's. Zero rather than a fabricated number, and the
      // card links to a route that exists.
      requests: 0,
    };
  },
);

/* ────────────────────────────────────────────── attention */

/**
 * Only genuine actions, each linking to the record.
 *
 * Ordered by how much it costs the customer to ignore it: an overdue invoice
 * first, then money they still owe, then a quote that will expire, then a
 * payment they abandoned.
 */
export const attentionItems = cache(
  async (organizationId: string): Promise<AttentionSource[]> => {
    await connectToDatabase();
    const org = toObjectId(organizationId);
    const now = new Date();

    const [invoices, quotes, orders] = await Promise.all([
      Invoice.find({ organizationId: org, status: { $in: ["issued", "overdue"] } })
        .sort({ dueAt: 1 })
        .limit(10)
        .lean<
          Array<{
            _id: unknown;
            reference: string;
            total?: { amount: number; currency: string };
            dueAt?: Date;
          }>
        >(),

      Quote.find({ organizationId: org, status: "issued" })
        .sort({ expiresAt: 1 })
        .limit(10)
        .lean<
          Array<{
            _id: unknown;
            reference: string;
            total?: { amount: number; currency: string };
            expiresAt?: Date;
          }>
        >(),

      // An abandoned payment. The order is intact and re-payable (ticket 11),
      // so this is a genuine action rather than a notification.
      Order.find({ organizationId: org, status: "awaiting_payment" })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean<
          Array<{
            _id: unknown;
            reference: string;
            total: { amount: number; currency: string };
          }>
        >(),
    ]);

    const items: AttentionSource[] = [];

    for (const invoice of invoices) {
      const overdue = Boolean(invoice.dueAt && invoice.dueAt < now);
      items.push({
        kind: "invoice_unpaid",
        id: String(invoice._id),
        title: overdue
          ? `Invoice ${invoice.reference} is overdue`
          : `Invoice ${invoice.reference} is due`,
        ...(invoice.dueAt ? { detail: `Due ${isoDay(invoice.dueAt)}` } : {}),
        href: `/dashboard/invoices`,
        urgent: overdue,
        ...(invoice.total ? { amount: invoice.total } : {}),
      });
    }

    for (const quote of quotes) {
      // Expiring within a week reads louder — a quote that lapses costs the
      // customer a re-quote and us a sale.
      const soon = Boolean(
        quote.expiresAt && quote.expiresAt.getTime() - now.getTime() < 7 * 86_400_000,
      );
      items.push({
        kind: "quote_awaiting",
        id: String(quote._id),
        title: `Quote ${quote.reference} is waiting for you`,
        ...(quote.expiresAt
          ? {
              detail: soon
                ? `Expires ${isoDay(quote.expiresAt)}`
                : `Valid until ${isoDay(quote.expiresAt)}`,
            }
          : {}),
        href: `/dashboard/quotes`,
        urgent: soon,
        ...(quote.total ? { amount: quote.total } : {}),
      });
    }

    for (const order of orders) {
      items.push({
        kind: "order_awaiting_payment",
        id: String(order._id),
        title: `Order ${order.reference} is waiting for payment`,
        detail: "Your basket is intact — pick up where you left off.",
        href: `/dashboard/orders/${order.reference}`,
        urgent: false,
        amount: order.total,
      });
    }

    return items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  },
);

/* ────────────────────────────────────────────── activity */

/**
 * The last ten things that happened, in plain language — §70.
 *
 * `visibility: "customer"` only. `activityEvents` carries internal entries too,
 * and this is the query where forgetting that shows a customer somebody's
 * internal deliberation.
 */
export const recentActivity = cache(
  async (organizationId: string): Promise<RecentActivity[]> => {
    await connectToDatabase();

    const events = await ActivityEvent.find({
      organizationId: toObjectId(organizationId),
      visibility: "customer",
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<Array<{ _id: unknown; message: string; type: string; createdAt?: Date }>>();

    return events.map((event) => ({
      id: String(event._id),
      message: event.message,
      type: event.type,
      // Absolute, per the house rule — relative time differs between server
      // and client and flickers at hydration.
      at: event.createdAt ? isoDay(event.createdAt) : "",
    }));
  },
);

function isoDay(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
