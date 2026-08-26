import "server-only";
import type { Route } from "next";
import { connectToDatabase } from "@/lib/db/client";
import { Invoice } from "@/lib/db/models/billing";
import { FACET_PREFIX, Product, SearchLog, Taxonomy } from "@/lib/db/models/catalog";
import { Order, Payment } from "@/lib/db/models/commerce";
import { AuditLog } from "@/lib/db/models/communication";
import { Organization } from "@/lib/db/models/identity";
import { AiConversation } from "@/lib/db/models/requests";
import { Job } from "@/lib/db/models/system";
import { Vendor } from "@/lib/db/models/vendors";
import { ageBands, groupTotals, timeSeries, type GroupTotal } from "./series";
import { previousRange, type Range } from "./range";
import type { BucketRow } from "./range";

/**
 * What the platform looks like — the read layer behind `/admin/dashboard`.
 *
 * `features/reporting/headline.ts` is the four-tile version of this and stays as
 * it is; this is the screen it said belonged somewhere else. Its conventions
 * carry over unchanged, and they are worth restating because every one of them
 * is a decision somebody could reasonably get wrong:
 *
 * - **Money is never summed across currencies.** `money.ts` refuses the
 *   arithmetic and there is no FX rate anywhere in the platform, so revenue is a
 *   list keyed by currency. Adding £117,601 to $152,008 would be, in
 *   `headline.ts`'s words, a fabrication with a currency symbol on it.
 * - **Revenue is settled money**, taken from `order.total` — the frozen
 *   checkout snapshot (§61) — matched on `paidAt`. Re-pricing the catalogue
 *   cannot move last quarter's figure, and an order created in one month and paid
 *   in the next belongs to the month it was paid in.
 * - **Every figure is derived; none is a stored counter.** That includes the
 *   product ranking, which comes from order lines rather than from
 *   `Product.orderCount`. The counter exists and is roughly right, but §103's
 *   objection stands: it is a second source of truth, and the version a customer
 *   could reconcile is the one built from the orders themselves.
 * - **Ratios are basis points.** Integers in, integers out, as
 *   `analytics-service.ts` argues for the refund rate: a float percentage is a
 *   number nobody can tie back to the two counts it came from.
 *
 * ## What is deliberately absent
 *
 * **Nothing on this platform counts a page view.** No funnel, no conversion
 * rate, no traffic. `services/vendors/analytics-service.ts` reached the same wall
 * and returned `traffic: null` rather than a plausible number, on the grounds
 * that somebody making a pricing decision on a fabricated conversion rate has
 * been misled by us. The same applies here and the screen says so.
 *
 * Two smaller gaps, both surfaced as footnotes rather than smoothed over:
 * succeeded jobs are deleted after seven days by a TTL, so job history cannot go
 * deeper than that; and `SearchLog` records the term and how often it was asked
 * but not whether anything came back, so "searches that found nothing" — the
 * most useful thing a search log could tell us — is not derivable.
 */

/* ────────────────────────────────────────────── commerce */

export interface CurrencySeries {
  currency: string;
  rows: BucketRow[];
  /** Settled money in this window, minor units. */
  total: number;
  /** The same figure for the equal-length window before it, for the delta. */
  previous: number;
  orders: number;
}

export interface CommerceAnalytics {
  /** One entry per currency that traded in the window. Never combined. */
  revenue: CurrencySeries[];
  ordersByStatus: GroupTotal[];
  paymentsOverTime: BucketRow[];
  /** Succeeded over resolved attempts, in basis points. Null when nothing resolved. */
  paymentSuccessBasisPoints: number | null;
  topProducts: Array<{ productId: string; name: string; slug: string; units: number }>;
  outstanding: Array<{ currency: string; amount: number; invoices: number }>;
  outstandingAge: Array<{ label: string; from: number; count: number }>;
}

/** Money that has actually arrived. `refunded` is excluded — it came back. */
const EARNED = ["paid", "fulfilled"] as const;
const OUTSTANDING_INVOICE = ["issued", "partially_paid", "overdue"] as const;

export async function commerceAnalytics(range: Range, now: Date): Promise<CommerceAnalytics> {
  await connectToDatabase();
  const before = previousRange(range);

  const [
    revenueRows,
    previousRows,
    ordersByStatus,
    paymentsOverTime,
    paymentTotals,
    topProducts,
    outstanding,
    outstandingAge,
  ] = await Promise.all([
    timeSeries({
      model: Order,
      dateField: "paidAt",
      match: { status: { $in: EARNED } },
      range,
      groupBy: "currency",
      sum: "total.amount",
    }),
    groupTotals({
      model: Order,
      groupBy: "currency",
      match: { status: { $in: EARNED }, paidAt: { $gte: before.from, $lt: before.to } },
      sum: "total.amount",
    }),
    groupTotals({
      model: Order,
      groupBy: "status",
      match: { createdAt: { $gte: range.from, $lt: range.to } },
    }),
    timeSeries({
      model: Payment,
      dateField: "createdAt",
      range,
      groupBy: "status",
    }),
    groupTotals({
      model: Payment,
      groupBy: "status",
      match: { createdAt: { $gte: range.from, $lt: range.to } },
    }),
    productRanking(range),
    // Not windowed, and that is the point: an invoice from eight months ago that
    // is still unpaid is exactly the one worth seeing, and a date filter here
    // would hide the worst of it.
    outstandingByCurrency(),
    ageBands({
      model: Invoice,
      dateField: "dueAt",
      match: { status: { $in: OUTSTANDING_INVOICE }, dueAt: { $lt: now } },
      now,
      boundaries: [0, 8, 31, 91],
    }),
  ]);

  const previousByCurrency = new Map(previousRows.map((row) => [row.key, row.value]));
  const currencies = [...new Set(revenueRows.map((row) => row.key).filter(isPresent))].sort();

  const revenue: CurrencySeries[] = currencies.map((currency) => {
    const rows = revenueRows.filter((row) => row.key === currency);
    return {
      currency,
      rows,
      total: rows.reduce((sum, row) => sum + row.value, 0),
      previous: previousByCurrency.get(currency) ?? 0,
      orders: 0,
    };
  });

  // The order count per currency is a second `$group` on the same match, so it
  // rides along with the revenue rather than costing its own round trip.
  const countsByCurrency = await groupTotals({
    model: Order,
    groupBy: "currency",
    match: { status: { $in: EARNED }, paidAt: { $gte: range.from, $lt: range.to } },
  });
  for (const entry of revenue) {
    entry.orders = countsByCurrency.find((row) => row.key === entry.currency)?.count ?? 0;
  }

  return {
    revenue,
    ordersByStatus,
    paymentsOverTime,
    paymentSuccessBasisPoints: successRate(paymentTotals),
    topProducts,
    outstanding,
    outstandingAge: outstandingAge.filter((band) => band.count > 0),
  };
}

/**
 * Succeeded over everything that reached an outcome, in basis points.
 *
 * `pending` and `requires_review` are excluded from the denominator rather than
 * counted as failures: a bank transfer that has not arrived yet has not failed,
 * and counting it as one makes the rate a measure of how recently somebody
 * checked out. Returns `null` rather than `0` when nothing has resolved, because
 * "no attempts" and "every attempt failed" must not render the same.
 */
function successRate(totals: readonly GroupTotal[]): number | null {
  const count = (status: string) => totals.find((row) => row.key === status)?.count ?? 0;
  const succeeded = count("succeeded");
  const resolved = succeeded + count("failed") + count("refunded");
  return resolved === 0 ? null : Math.round((succeeded / resolved) * 10_000);
}

/**
 * What sold, from the order lines themselves.
 *
 * `Product.orderCount` is right there and is not used, for §103's reason — and
 * for a second one that matters more on a dashboard: the counter is all-time, so
 * it cannot answer "in this window", which is the only question this panel asks.
 *
 * `$unwind` on `items` before grouping, because an order can carry more than one
 * product and attributing the whole order to the first line would quietly favour
 * whatever sorts first in a cart.
 */
async function productRanking(
  range: Range,
): Promise<Array<{ productId: string; name: string; slug: string; units: number }>> {
  const rows = await Order.aggregate<{
    _id: { productId: unknown; name: string; slug: string };
    units: number;
  }>([
    { $match: { status: { $in: EARNED }, paidAt: { $gte: range.from, $lt: range.to } } },
    { $unwind: "$items" },
    { $match: { "items.kind": "product_licence" } },
    {
      $group: {
        _id: {
          productId: "$items.productId",
          name: "$items.productName",
          slug: "$items.productSlug",
        },
        units: { $sum: "$items.quantity" },
      },
    },
    { $sort: { units: -1 } },
    { $limit: 8 },
  ]);

  return rows.map((row) => ({
    productId: String(row._id.productId),
    name: row._id.name,
    slug: row._id.slug,
    units: row.units,
  }));
}

/**
 * Outstanding invoice value per currency, net of part payments.
 *
 * The subtraction has to happen inside the pipeline — `groupTotals` can only sum
 * one stored field, and there is no stored "outstanding" column because there
 * should not be: it is `total` minus `amountPaid`, and a third column holding the
 * difference is a third thing to keep in step. Mirrors `staffHeadline` exactly, so
 * the two screens cannot disagree about what is owed.
 */
async function outstandingByCurrency(): Promise<
  Array<{ currency: string; amount: number; invoices: number }>
> {
  const rows = await Invoice.aggregate<{ _id: string; amount: number; invoices: number }>([
    { $match: { status: { $in: OUTSTANDING_INVOICE } } },
    {
      $group: {
        _id: "$currency",
        amount: {
          $sum: { $subtract: ["$total.amount", { $ifNull: ["$amountPaid.amount", 0] }] },
        },
        invoices: { $sum: 1 },
      },
    },
    { $sort: { amount: -1 } },
  ]);
  return rows.map((row) => ({ currency: row._id, amount: row.amount, invoices: row.invoices }));
}

/* ────────────────────────────────────────────── catalogue and demand */

export interface CatalogueAnalytics {
  productsByStatus: GroupTotal[];
  categories: Array<{ slug: string; name: string; products: number }>;
  publishedOverTime: BucketRow[];
  searches: Array<{ term: string; count: number }>;
  vendorsByStatus: GroupTotal[];
  newOrganizations: BucketRow[];
  newOrganizationsTotal: number;
  newOrganizationsPrevious: number;
}

export async function catalogueAnalytics(range: Range): Promise<CatalogueAnalytics> {
  await connectToDatabase();
  const before = previousRange(range);

  const [
    productsByStatus,
    categories,
    publishedOverTime,
    searches,
    vendorsByStatus,
    newOrganizations,
    previousOrganizations,
  ] = await Promise.all([
    groupTotals({ model: Product, groupBy: "status", match: { deletedAt: null } }),
    categoryCounts(),
    timeSeries({
      model: Product,
      dateField: "publishedAt",
      match: { status: "published", deletedAt: null },
      range,
    }),
    SearchLog.find({})
      .select({ term: 1, count: 1 })
      .sort({ count: -1 })
      // §94 — bounded, like every other read here. A search log is unbounded by
      // nature and this panel only ever shows the head of it.
      .limit(10)
      .lean<Array<{ term: string; count: number }>>(),
    groupTotals({ model: Vendor, groupBy: "status", match: { deletedAt: null } }),
    timeSeries({
      model: Organization,
      dateField: "createdAt",
      match: { deletedAt: null },
      range,
    }),
    Organization.countDocuments({
      deletedAt: null,
      createdAt: { $gte: before.from, $lt: before.to },
    }),
  ]);

  return {
    productsByStatus,
    categories,
    publishedOverTime,
    searches: searches.map((row) => ({ term: row.term, count: row.count })),
    vendorsByStatus,
    newOrganizations,
    newOrganizationsTotal: newOrganizations.reduce((sum, row) => sum + row.value, 0),
    newOrganizationsPrevious: previousOrganizations,
  };
}

/**
 * How the published catalogue divides by category.
 *
 * Counted off the flattened `facets` array rather than `categoryIds`, because
 * that array is what the marketplace filters on — so this panel and the filter
 * rail cannot disagree about how many products a category has, which is the
 * failure a reader would notice first. `marketplace/pipeline.ts` established the
 * `$unwind`-then-`$group` shape.
 *
 * Names are resolved in a second query rather than a `$lookup`: the slugs are
 * inside a prefixed string, so joining would mean string surgery in the pipeline
 * for a lookup of at most ten rows.
 */
async function categoryCounts(): Promise<
  Array<{ slug: string; name: string; products: number }>
> {
  const prefix = `${FACET_PREFIX.category}:`;

  const rows = await Product.aggregate<{ _id: string; products: number }>([
    { $match: { status: "published", deletedAt: null } },
    { $unwind: "$facets" },
    { $match: { facets: { $regex: `^${prefix}` } } },
    { $group: { _id: "$facets", products: { $sum: 1 } } },
    { $sort: { products: -1 } },
    { $limit: 10 },
  ]);

  const slugs = rows.map((row) => row._id.slice(prefix.length));
  const terms = await Taxonomy.find({ kind: "category", slug: { $in: slugs } })
    .select({ slug: 1, name: 1 })
    .lean<Array<{ slug: string; name: string }>>();
  const nameBySlug = new Map(terms.map((term) => [term.slug, term.name]));

  return rows.map((row) => {
    const slug = row._id.slice(prefix.length);
    return { slug, name: nameBySlug.get(slug) ?? slug, products: row.products };
  });
}

/* ────────────────────────────────────────────── platform health */

export interface PlatformAnalytics {
  /** Job counts by name, from the existing overview rather than a second derivation. */
  jobTotals: Record<string, number>;
  deadJobs: number;
  jobsByName: Array<{ name: string; succeeded: number; failed: number; dead: number }>;
  auditOverTime: BucketRow[];
  auditActions: GroupTotal[];
  /** AI spend in micros — not a `Money`, and must not be rendered as one. */
  aiSpendMicros: number;
  aiSpendOverTime: BucketRow[];
  aiConversations: number;
}

export async function platformAnalytics(range: Range): Promise<PlatformAnalytics> {
  await connectToDatabase();

  const [jobRows, auditOverTime, auditActions, aiOverTime, aiTotals] = await Promise.all([
    Job.aggregate<{ _id: { name: string; status: string }; count: number }>([
      { $group: { _id: { name: "$name", status: "$status" }, count: { $sum: 1 } } },
    ]),
    timeSeries({ model: AuditLog, dateField: "createdAt", range }),
    groupTotals({
      model: AuditLog,
      groupBy: "action",
      match: { createdAt: { $gte: range.from, $lt: range.to } },
      limit: 10,
    }),
    timeSeries({
      model: AiConversation,
      dateField: "createdAt",
      range,
      sum: "totalCostMicros",
    }),
    groupTotals({
      model: AiConversation,
      groupBy: "contextType",
      match: { createdAt: { $gte: range.from, $lt: range.to } },
      sum: "totalCostMicros",
    }),
  ]);

  const totals: Record<string, number> = {};
  const byName = new Map<
    string,
    { name: string; succeeded: number; failed: number; dead: number }
  >();

  for (const row of jobRows) {
    totals[row._id.status] = (totals[row._id.status] ?? 0) + row.count;
    const entry = byName.get(row._id.name) ?? {
      name: row._id.name,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    if (row._id.status === "succeeded") entry.succeeded += row.count;
    if (row._id.status === "failed") entry.failed += row.count;
    if (row._id.status === "dead") entry.dead += row.count;
    byName.set(row._id.name, entry);
  }

  return {
    jobTotals: totals,
    deadJobs: totals.dead ?? 0,
    jobsByName: [...byName.values()].sort(
      (a, b) => b.dead - a.dead || b.failed - a.failed || b.succeeded - a.succeeded,
    ),
    auditOverTime,
    auditActions,
    aiSpendMicros: aiTotals.reduce((sum, row) => sum + row.value, 0),
    aiSpendOverTime: aiOverTime,
    aiConversations: aiTotals.reduce((sum, row) => sum + row.count, 0),
  };
}

/* ────────────────────────────────────────────── what needs doing */

export interface AdminAttentionItem {
  kind: string;
  message: string;
  /** Typed, so `typedRoutes` catches a screen that has been renamed or removed. */
  href: Route;
  count: number;
}

/**
 * The top of the screen — §102's "lead with what needs doing".
 *
 * `analytics-service.ts` built the vendor version of this and its reasoning is
 * the same: figures are for somebody who came to check on things, and action
 * items are for the far more common case of somebody who came because something
 * is waiting on them and does not know it. Renders nothing when there is nothing,
 * rather than a permanent "0 items" panel that teaches a reader to skip the one
 * place the important thing will appear.
 */
export async function adminAttention(): Promise<AdminAttentionItem[]> {
  await connectToDatabase();

  const [deadJobs, reviewPayments, awaitingProducts, overdueInvoices] = await Promise.all([
    Job.countDocuments({ status: "dead" }),
    Payment.countDocuments({ status: "requires_review" }),
    Product.countDocuments({ status: "submitted", deletedAt: null }),
    Invoice.countDocuments({ status: "overdue" }),
  ]);

  const items: AdminAttentionItem[] = [];

  if (deadJobs > 0) {
    items.push({
      kind: "dead_jobs",
      count: deadJobs,
      message:
        deadJobs === 1
          ? "A background job has exhausted its retries and stopped."
          : `${deadJobs} background jobs have exhausted their retries and stopped.`,
      href: "/admin/jobs",
    });
  }

  if (reviewPayments > 0) {
    items.push({
      kind: "payments_review",
      count: reviewPayments,
      message:
        reviewPayments === 1
          ? "A payment is held for review and nothing has been fulfilled against it."
          : `${reviewPayments} payments are held for review.`,
      href: "/admin/payments",
    });
  }

  if (awaitingProducts > 0) {
    items.push({
      kind: "products_submitted",
      count: awaitingProducts,
      message:
        awaitingProducts === 1
          ? "A product is waiting to be reviewed before it can go on sale."
          : `${awaitingProducts} products are waiting to be reviewed.`,
      href: "/staff/vendor-submissions",
    });
  }

  if (overdueInvoices > 0) {
    items.push({
      kind: "invoices_overdue",
      count: overdueInvoices,
      message:
        overdueInvoices === 1
          ? "An invoice is past its due date."
          : `${overdueInvoices} invoices are past their due date.`,
      href: "/staff/invoices",
    });
  }

  return items;
}

function isPresent(value: string | null): value is string {
  return value !== null;
}
