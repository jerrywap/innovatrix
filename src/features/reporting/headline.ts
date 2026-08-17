import "server-only";
import { connection } from "next/server";
import { connectToDatabase } from "@/lib/db/client";
import { Order } from "@/lib/db/models/commerce";
import { Invoice } from "@/lib/db/models/billing";
import { Product } from "@/lib/db/models/catalog";
import { CustomerRequest } from "@/lib/db/models/requests";
import { Organization } from "@/lib/db/models/identity";
import { Job } from "@/lib/db/models/system";
import type { Money } from "@/lib/money";

/**
 * Headline figures for the two portal landings — §31, §102.
 *
 * ## Deliberately small
 *
 * §102 is emphatic that a dashboard prioritises **actions** over decorative
 * statistics, and `/staff` is already the action-oriented screen it asks for: a
 * queue board where every counter clicks into the queue it counts. This adds a
 * row above that, not a replacement for it.
 *
 * A reporting layer — time series, cohorts, per-product revenue, date-range
 * pickers — is explicitly **not** here. It would be the first aggregation
 * pipeline in the codebase and deserves its own design rather than arriving as
 * a side effect of a smoke-test follow-up.
 *
 * ## Money is never summed across currencies
 *
 * `money.ts` refuses cross-currency arithmetic for good reason, and there is no
 * FX rate anybody has agreed. So revenue comes back as a list, one entry per
 * currency, and the screen shows them side by side. A single number would be a
 * fabrication.
 *
 * ## Summed from frozen order lines
 *
 * §61 — `order.total` is the snapshot taken at checkout. Repricing the
 * catalogue must not move last month's revenue.
 */

export interface RevenueByCurrency {
  currency: string;
  amount: number;
  orders: number;
}

export interface AdminHeadline {
  revenueThisMonth: RevenueByCurrency[];
  revenueLastMonth: RevenueByCurrency[];
  ordersPaid: number;
  ordersAwaitingPayment: number;
  publishedProducts: number;
  productsInDraft: number;
  newOrganizationsThisMonth: number;
  jobsQueued: number;
  jobsFailed: number;
}

export interface StaffHeadline {
  waitingOnUs: number;
  waitingOnCustomer: number;
  quotesIssued: number;
  invoicesOutstanding: number;
  /** Outstanding invoice value, per currency — never one summed number. */
  outstandingValue: RevenueByCurrency[];
}

/**
 * The first instant of a month, `offset` months from now, in UTC.
 *
 * `new Date()` is an *unstable* read: Next refuses it during a prerender,
 * because a value that changes between renders cannot be baked into static
 * output. Callers therefore `await connection()` first — see below.
 */
function startOfMonth(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/**
 * Mark this read as request-time.
 *
 * Both functions here ask "how are we doing *now*", which means reading the
 * clock — and Next treats `new Date()` during a prerender as an error:
 *
 * > Route "/staff": Next.js encountered the unstable value `new Date()` while
 * > prerendering.
 *
 * Which it did, six times, until this was added. `connection()` is the
 * documented fix and the honest one: these figures are dynamic by nature, and
 * the alternative — caching them — would mean a dashboard that reports last
 * hour's numbers as though they were current.
 *
 * The pages keep their static shell regardless, because both callers sit inside
 * their own `<Suspense>`; only that subtree becomes dynamic.
 */
async function atRequestTime(): Promise<void> {
  await connection();
}

/**
 * Paid orders in a window, grouped by currency.
 *
 * The first `$group` in the codebase, and the reason a `$facet`-style
 * multi-metric pipeline is not used: two small grouped counts are easier to
 * read, and the index on `(status, paidAt)` serves both.
 */
async function revenueBetween(from: Date, to: Date): Promise<RevenueByCurrency[]> {
  const rows = await Order.aggregate<{ _id: string; amount: number; orders: number }>([
    { $match: { status: { $in: ["paid", "fulfilled"] }, paidAt: { $gte: from, $lt: to } } },
    { $group: { _id: "$currency", amount: { $sum: "$total.amount" }, orders: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);

  return rows.map((row) => ({ currency: row._id, amount: row.amount, orders: row.orders }));
}

export async function adminHeadline(): Promise<AdminHeadline> {
  await atRequestTime();
  await connectToDatabase();

  const thisMonth = startOfMonth();
  const lastMonth = startOfMonth(-1);
  const nextMonth = startOfMonth(1);

  const [
    revenueThisMonth,
    revenueLastMonth,
    ordersPaid,
    ordersAwaitingPayment,
    publishedProducts,
    productsInDraft,
    newOrganizationsThisMonth,
    jobsQueued,
    jobsFailed,
  ] = await Promise.all([
    revenueBetween(thisMonth, nextMonth),
    revenueBetween(lastMonth, thisMonth),
    Order.countDocuments({ status: { $in: ["paid", "fulfilled"] } }),
    Order.countDocuments({ status: "awaiting_payment" }),
    Product.countDocuments({ status: "published", deletedAt: null }),
    Product.countDocuments({ status: "draft", deletedAt: null }),
    Organization.countDocuments({ createdAt: { $gte: thisMonth } }),
    Job.countDocuments({ status: "pending" }),
    Job.countDocuments({ status: "failed" }),
  ]);

  return {
    revenueThisMonth,
    revenueLastMonth,
    ordersPaid,
    ordersAwaitingPayment,
    publishedProducts,
    productsInDraft,
    newOrganizationsThisMonth,
    jobsQueued,
    jobsFailed,
  };
}

/**
 * §31's central distinction: who is the next move on.
 *
 * A team that cannot see how much is sitting with *them* rather than with the
 * customer has no way to tell a busy week from a stuck one.
 */
export async function staffHeadline(): Promise<StaffHeadline> {
  // Not because this one reads the clock — it does not — but because
  // `staffCounts()` beside it counts overdue follow-ups against `new Date()`,
  // and the same page renders both.
  await atRequestTime();
  await connectToDatabase();

  const [waitingOnUs, waitingOnCustomer, quotesIssued, outstanding] = await Promise.all([
    CustomerRequest.countDocuments({
      status: { $in: ["submitted", "under_review", "technical_review", "approved"] },
    }),
    CustomerRequest.countDocuments({ status: "waiting_for_customer" }),
    // Kept in step with `staffCounts`, which counts the same thing for its own
    // card — one definition would be better and is a refactor, not a fix.
    CustomerRequest.countDocuments({ status: "quoted" }),
    Invoice.aggregate<{ _id: string; amount: number; orders: number }>([
      { $match: { status: { $in: ["issued", "partially_paid", "overdue"] } } },
      {
        $group: {
          _id: "$currency",
          // What is still owed, not what was billed — a part-paid invoice is
          // outstanding only for its balance.
          amount: {
            $sum: { $subtract: ["$total.amount", { $ifNull: ["$amountPaid.amount", 0] }] },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]),
  ]);

  const outstandingValue = outstanding.map(
    (row: { _id: string; amount: number; orders: number }) => ({
      currency: row._id,
      amount: row.amount,
      orders: row.orders,
    }),
  );

  return {
    waitingOnUs,
    waitingOnCustomer,
    quotesIssued,
    invoicesOutstanding: outstandingValue.reduce((sum, row) => sum + row.orders, 0),
    outstandingValue,
  };
}

/** A `RevenueByCurrency` row as the `Money` the display component wants. */
export function asMoney(row: RevenueByCurrency): Money {
  return { amount: row.amount, currency: row.currency as Money["currency"] };
}
