import "server-only";
import type { Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { Download } from "@/lib/db/models/commerce";
import { LedgerEntry } from "@/lib/db/models/ledger";
import { Review } from "@/lib/db/models/reviews";
import { Payout, PayoutSkip } from "@/lib/db/models/ledger";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";

/**
 * What a vendor's own dashboard reports — vendor ticket 12.
 *
 * ## Every figure is derived, and none is a counter
 *
 * Units, earnings, refunds, ratings and downloads all come from the ledger, the reviews or the
 * download log. There is no `salesThisMonth` field anywhere, because a stored counter is a
 * second source of truth (§103) that drifts silently — and the drift is only ever discovered by
 * a vendor who adds their own figures up and disagrees with us.
 *
 * ## Bounded and time-boxed
 *
 * Every read here is limited *and* windowed. A vendor analytics page that scans every order for
 * a busy product is the query that takes the marketplace down at the worst possible time, and
 * §94 has already had to bound the notification recipient reads for the same reason.
 *
 * ## Traffic figures are absent, and that is the honest answer
 *
 * The ticket asked for storefront and product views with view-to-purchase conversion, and
 * **nothing in the platform counts a page view**. `SearchLog` records searches;
 * `Product.orderCount` counts orders; there is no view counter, sampled or otherwise.
 *
 * Building one is a real subsystem — a per-product-per-day aggregate with no per-visitor record,
 * a write path on the hottest public page, and a privacy position to take — and it is not
 * something to bolt onto an analytics read. So this returns no traffic block at all and the
 * screen says why. The ticket is explicit that the alternative is worse: "It does not stub a
 * number that looks real."
 */

/** The longest window a vendor may ask for. §94 — no unbounded reads, including by date. */
export const MAX_WINDOW_DAYS = 365;
export const DEFAULT_WINDOW_DAYS = 90;

/** Per-product rows are capped: a vendor with 500 products gets their top sellers, not all. */
const MAX_PRODUCT_ROWS = 50;
const MAX_VERSION_ROWS = 50;

export interface ProductPerformance {
  productId: string;
  name: string;
  slug: string;
  /** Licence lines sold in the window — one per earning entry. */
  units: number;
  /** What the vendor earned on them, in minor units, per currency. */
  earnings: Array<{ currency: string; amount: number }>;
  /** Refunds against them, as a positive figure. */
  refunded: Array<{ currency: string; amount: number }>;
  rating: { average: number; count: number } | null;
  listingSuppressed: boolean;
}

export interface VendorAnalytics {
  windowDays: number;
  from: Date;
  /** Sales and earnings by product, best first, capped. */
  products: ProductPerformance[];
  /** Downloads by version, which is how a vendor learns an update is not being taken up. */
  downloads: Array<{ versionId: string; version: string; productName: string; count: number }>;
  /**
   * Refunds as a proportion of earnings, per currency, in basis points.
   *
   * Basis points rather than a float percentage, for the reason §84 gives about money: the
   * inputs are integers and the ratio is displayed, so there is no reason to introduce a float.
   */
  refundRateBasisPoints: Array<{ currency: string; rate: number }>;
  /**
   * Traffic is deliberately `null` — see the module comment. The screen renders the reason
   * rather than a zero.
   */
  traffic: null;
}

export async function vendorAnalytics(
  scope: VendorScope,
  options: { windowDays?: number } = {},
): Promise<VendorAnalytics> {
  await connectToDatabase();

  const windowDays = Math.min(
    Math.max(1, options.windowDays ?? DEFAULT_WINDOW_DAYS),
    MAX_WINDOW_DAYS,
  );
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const filter = vendorFilter(scope);

  /*
   * Earnings and refunds per product, from the **ledger**.
   *
   * Not from orders: a "units sold" counted there would include a line the vendor was never
   * paid for (a first-party add-on on their product, an order that later failed), and would
   * need their product list resolved first. Every figure a vendor sees should be the same
   * number the money came from.
   */
  const rows = await LedgerEntry.aggregate<{
    _id: { productId?: Types.ObjectId; kind: string; currency: string };
    total: number;
    count: number;
  }>([
    {
      $match: {
        ...filter,
        kind: { $in: ["earning", "refund"] },
        createdAt: { $gte: from },
      },
    },
    // The product is on the *order line*, not on the entry — so the join is through the order.
    // One `$lookup` on an indexed `_id`, after the match has already narrowed to one vendor's
    // entries inside the window.
    {
      $lookup: {
        from: "orders",
        localField: "orderId",
        foreignField: "_id",
        as: "order",
        pipeline: [{ $project: { items: 1 } }],
      },
    },
    { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        line: {
          $first: {
            $filter: {
              input: { $ifNull: ["$order.items", []] },
              as: "item",
              cond: { $eq: ["$$item.lineId", "$orderLineId"] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: { productId: "$line.productId", kind: "$kind", currency: "$amount.currency" },
        total: { $sum: "$amount.amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const productIds = [
    ...new Set(
      rows
        .map((row) => row._id.productId)
        .filter(Boolean)
        .map(String),
    ),
  ].slice(0, MAX_PRODUCT_ROWS);

  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select({
          name: 1,
          slug: 1,
          ratingSum: 1,
          ratingCount: 1,
          listingSuppressed: 1,
        })
        .lean<
          Array<{
            _id: unknown;
            name: string;
            slug: string;
            ratingSum?: number;
            ratingCount?: number;
            listingSuppressed?: boolean;
          }>
        >()
    : [];

  const performance = new Map<string, ProductPerformance>(
    products.map((product) => [
      String(product._id),
      {
        productId: String(product._id),
        name: product.name,
        slug: product.slug,
        units: 0,
        earnings: [],
        refunded: [],
        rating:
          product.ratingCount && product.ratingSum
            ? {
                average: Math.round((product.ratingSum / product.ratingCount) * 10) / 10,
                count: product.ratingCount,
              }
            : null,
        listingSuppressed: Boolean(product.listingSuppressed),
      },
    ]),
  );

  for (const row of rows) {
    const key = String(row._id.productId ?? "");
    const entry = performance.get(key);
    if (!entry) continue;

    if (row._id.kind === "earning") {
      entry.units += row.count;
      entry.earnings.push({ currency: row._id.currency, amount: row.total });
    } else {
      // Reported as a positive figure: "£40 refunded" reads better than "-£40 refunded", and
      // the sign is already carried by the ledger it came from.
      entry.refunded.push({ currency: row._id.currency, amount: Math.abs(row.total) });
    }
  }

  const refundRateBasisPoints = rateFrom(rows);
  const downloads = await downloadsByVersion(productIds, from);

  return {
    windowDays,
    from,
    products: [...performance.values()].sort((a, b) => b.units - a.units),
    downloads,
    refundRateBasisPoints,
    traffic: null,
  };
}

/**
 * Refunds over earnings, per currency, in basis points.
 *
 * Integer arithmetic on two integers. A float percentage would be a number nobody can reconcile
 * against the ledger it came from, and §84's argument about money applies to a ratio *of* money.
 */
function rateFrom(
  rows: ReadonlyArray<{ _id: { kind: string; currency: string }; total: number }>,
): Array<{ currency: string; rate: number }> {
  const earned = new Map<string, number>();
  const refunded = new Map<string, number>();

  for (const row of rows) {
    const target = row._id.kind === "earning" ? earned : refunded;
    target.set(row._id.currency, (target.get(row._id.currency) ?? 0) + Math.abs(row.total));
  }

  return [...earned.entries()]
    .filter(([, total]) => total > 0)
    .map(([currency, total]) => ({
      currency,
      rate: Math.round(((refunded.get(currency) ?? 0) / total) * 10_000),
    }));
}

/**
 * Downloads by version — the figure that tells a vendor an update is not being taken up.
 *
 * Windowed and capped like everything else. `Download` is append-only (§66) and already indexed
 * by entitlement; this reads by product through the entitlement, which is the only join
 * available and is why the version label is resolved separately rather than in the pipeline.
 */
async function downloadsByVersion(
  productIds: readonly string[],
  from: Date,
): Promise<Array<{ versionId: string; version: string; productName: string; count: number }>> {
  if (productIds.length === 0) return [];

  const rows = await Download.aggregate<{
    _id: { versionId: Types.ObjectId; productId: Types.ObjectId };
    count: number;
  }>([
    { $match: { createdAt: { $gte: from } } },
    {
      $lookup: {
        from: "productFiles",
        localField: "productFileId",
        foreignField: "_id",
        as: "file",
        pipeline: [{ $project: { versionId: 1, productId: 1 } }],
      },
    },
    { $unwind: "$file" },
    {
      $match: {
        "file.productId": { $in: productIds.map((id) => toObjectId(id)) },
      },
    },
    {
      $group: {
        _id: { versionId: "$file.versionId", productId: "$file.productId" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: MAX_VERSION_ROWS },
  ]);

  if (rows.length === 0) return [];

  const { ProductVersion } = await import("@/lib/db/models/catalog");
  const [versions, products] = await Promise.all([
    ProductVersion.find({ _id: { $in: rows.map((row) => row._id.versionId) } })
      .select({ version: 1 })
      .lean<Array<{ _id: unknown; version: string }>>(),
    Product.find({ _id: { $in: rows.map((row) => row._id.productId) } })
      .select({ name: 1 })
      .lean<Array<{ _id: unknown; name: string }>>(),
  ]);

  const versionById = new Map(versions.map((row) => [String(row._id), row.version]));
  const nameById = new Map(products.map((row) => [String(row._id), row.name]));

  return rows.map((row) => ({
    versionId: String(row._id.versionId),
    version: versionById.get(String(row._id.versionId)) ?? "unknown",
    productName: nameById.get(String(row._id.productId)) ?? "Unknown product",
    count: row.count,
  }));
}

/* ────────────────────────────────────────────── what needs doing */

export interface ActionItem {
  kind:
    | "changes_requested"
    | "unanswered_review"
    | "payout_blocked"
    | "listing_suppressed"
    | "agreement_stale";
  count: number;
  /** A sentence, in the second person, saying what to do. */
  message: string;
  href: string;
}

/**
 * The top of the vendor dashboard — §102.
 *
 * A dashboard leads with what needs doing, not with a number. Figures are for a vendor who came
 * to check on things; action items are for the far more common case of a vendor who came because
 * something is waiting on them and does not know it.
 *
 * Every count is one indexed `countDocuments` against a narrow filter, run in parallel — the
 * whole block costs one round trip.
 */
export async function actionItems(scope: VendorScope): Promise<ActionItem[]> {
  await connectToDatabase();

  const filter = vendorFilter(scope);

  const [changesRequested, unansweredReviews, suppressed, latestSkip, failedPayouts] =
    await Promise.all([
      Product.countDocuments({ ...filter, status: "changes_requested", deletedAt: null }),
      Review.countDocuments({
        ...filter,
        status: "published",
        vendorResponse: { $exists: false },
        // Only bad ones. A five-star review with no reply is not a task, and a dashboard that
        // says "you have 240 unanswered reviews" teaches a vendor to ignore the whole panel.
        rating: { $lte: 3 },
      }),
      Product.countDocuments({ ...filter, listingSuppressed: true }),
      PayoutSkip.findOne(filter).sort({ createdAt: -1 }).lean(),
      Payout.countDocuments({ ...filter, status: "failed" }),
    ]);

  const items: ActionItem[] = [];

  if (changesRequested > 0) {
    items.push({
      kind: "changes_requested",
      count: changesRequested,
      message:
        changesRequested === 1
          ? "One product needs changes before it can go on sale."
          : `${changesRequested} products need changes before they can go on sale.`,
      href: "/dashboard/selling/products?status=changes_requested",
    });
  }

  if (unansweredReviews > 0) {
    items.push({
      kind: "unanswered_review",
      count: unansweredReviews,
      message:
        unansweredReviews === 1
          ? "A critical review has no reply. Your answer is often what the next buyer reads."
          : `${unansweredReviews} critical reviews have no reply.`,
      href: "/dashboard/selling/reviews",
    });
  }

  if (latestSkip || failedPayouts > 0) {
    items.push({
      kind: "payout_blocked",
      count: failedPayouts || 1,
      message:
        failedPayouts > 0
          ? "A payout to you did not go through. Check your account details."
          : "The last payout run passed you over — see why.",
      href: "/dashboard/selling/payouts",
    });
  }

  if (suppressed > 0) {
    items.push({
      kind: "listing_suppressed",
      count: suppressed,
      message:
        "Your products are not currently listed on the marketplace. Existing customers keep " +
        "their downloads.",
      href: "/dashboard/selling",
    });
  }

  return items;
}
