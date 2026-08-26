import "server-only";
import type { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { Invoice, Quote } from "@/lib/db/models/billing";
import { User } from "@/lib/db/models/identity";
import { CustomerRequest, FollowUp } from "@/lib/db/models/requests";
import { ageBands, groupTotals, timeSeries, type AgeBand, type GroupTotal } from "./series";
import type { BucketRow, Range } from "./range";

/**
 * What the work looks like — the read layer behind `/staff/dashboard`.
 *
 * The distinction from `/admin/dashboard` is not seniority, it is the question
 * being asked. Admin asks "how is the platform doing"; this asks "where is the
 * work, how old is it, and how long are we taking" — and every panel is chosen
 * because somebody could act on the answer this morning.
 *
 * ## Current state is not history, and the difference is not hidden
 *
 * Queue depth is a **now** figure: nothing anywhere records what the queue looked
 * like last Tuesday, so there is no queue-depth-over-time chart and building one
 * would mean inventing a snapshot table. What *is* historical is arrivals
 * (`submittedAt`) and quoting (`issuedAt`), and those are the two lines here.
 *
 * ## Where the durations come from, and where they cannot
 *
 * `customerRequests` carries **no per-status timestamps** beyond `submittedAt` —
 * there is no `quotedAt`, no `approvedAt`. So "how long until we quoted" is
 * measured from the quote's own `issuedAt` against the request's `submittedAt`,
 * which is a real duration between two recorded facts. Anything needing an
 * intermediate transition time — time to first response, time in technical
 * review — has no source at all, and is therefore not on the screen rather than
 * approximated from `updatedAt`. `updatedAt` moves for any edit, including an
 * internal note, so a duration built on it measures attention rather than
 * progress.
 *
 * ## The queue definitions are not re-derived
 *
 * `features/staff/queues.ts` holds one filter per queue and both the counter and
 * the queue page use it — a ticket-20 acceptance criterion. This module calls
 * `staffCounts` rather than writing its own filters, so a bar on this dashboard
 * and the page it links to cannot disagree.
 */

/** Requests a human still has to move. Matches `queues.ts`'s own `OPEN` list. */
const OPEN_STATUSES = [
  "submitted",
  "under_review",
  "waiting_for_customer",
  "technical_review",
  "quoted",
] as const;

export interface PipelineAnalytics {
  /** Arrivals over time, split by kind. */
  arrivals: BucketRow[];
  arrivalsTotal: number;
  /** How long open requests have been sitting, by last movement. */
  openAge: AgeBand[];
  openTotal: number;
  quotesByStatus: GroupTotal[];
  /** Accepted over everything that reached a decision, in basis points. */
  acceptanceBasisPoints: number | null;
  quotesOverTime: BucketRow[];
  timeToQuote: { median: number; p90: number; sample: number } | null;
  workload: Array<{ userId: string; name: string; open: number }>;
  unassigned: number;
  invoiceAge: Array<{ currency: string; bands: Array<{ label: string; amount: number }> }>;
  followUps: { open: number; overdue: number };
}

export async function pipelineAnalytics(range: Range, now: Date): Promise<PipelineAnalytics> {
  await connectToDatabase();

  const [
    arrivals,
    openAge,
    openTotal,
    quotesByStatus,
    quoteDecisions,
    quotesOverTime,
    timeToQuote,
    workload,
    unassigned,
    invoiceAge,
    openFollowUps,
    overdueFollowUps,
  ] = await Promise.all([
    timeSeries({
      model: CustomerRequest,
      dateField: "submittedAt",
      range,
      groupBy: "kind",
    }),
    ageBands({
      model: CustomerRequest,
      // Last movement, not arrival: a request touched yesterday is not stale
      // however long ago it came in, and staleness is what this panel is for.
      dateField: "updatedAt",
      match: { status: { $in: OPEN_STATUSES } },
      now,
      boundaries: [0, 3, 8, 15],
    }),
    CustomerRequest.countDocuments({ status: { $in: OPEN_STATUSES } }),
    groupTotals({
      model: Quote,
      groupBy: "status",
      match: { issuedAt: { $gte: range.from, $lt: range.to } },
    }),
    groupTotals({
      model: Quote,
      groupBy: "status",
      // Not windowed: an acceptance rate over 30 days is mostly a count of quotes
      // still out, because a quote takes weeks to be answered. The rate is only
      // meaningful over quotes that have actually been decided.
      match: { status: { $in: ["accepted", "rejected", "expired"] } },
    }),
    timeSeries({ model: Quote, dateField: "issuedAt", range, groupBy: "status" }),
    quoteLatency(range),
    assigneeWorkload(),
    CustomerRequest.countDocuments({
      status: { $in: OPEN_STATUSES },
      currentAssigneeUserId: { $exists: false },
    }),
    invoiceAgeing(now),
    FollowUp.countDocuments({ status: "open" }),
    FollowUp.countDocuments({ status: "open", dueAt: { $lt: now } }),
  ]);

  return {
    arrivals,
    arrivalsTotal: arrivals.reduce((sum, row) => sum + row.value, 0),
    openAge: openAge.filter((band) => band.count > 0),
    openTotal,
    quotesByStatus,
    acceptanceBasisPoints: acceptanceRate(quoteDecisions),
    quotesOverTime,
    timeToQuote,
    workload,
    unassigned,
    invoiceAge,
    followUps: { open: openFollowUps, overdue: overdueFollowUps },
  };
}

/**
 * Accepted over decided, in basis points.
 *
 * `issued` and `superseded` are outside the denominator on purpose: a quote still
 * out has not been turned down, and a superseded one was replaced by us rather
 * than refused by them. Counting either as a loss makes the figure drop every
 * time somebody sends a quote, which is the opposite of what it should do.
 */
function acceptanceRate(totals: readonly GroupTotal[]): number | null {
  const count = (status: string) => totals.find((row) => row.key === status)?.count ?? 0;
  const accepted = count("accepted");
  const decided = accepted + count("rejected") + count("expired");
  return decided === 0 ? null : Math.round((accepted / decided) * 10_000);
}

/**
 * Whole days from a request being submitted to its first quote being issued.
 *
 * Median and p90 rather than a mean: one request that sat over Christmas moves a
 * mean by a week and tells nobody anything, while p90 is the figure that says
 * "one in ten takes this long", which is the promise a salesperson can or cannot
 * make.
 *
 * `$lookup` on an indexed `_id` after the match has already narrowed to one
 * window's quotes, and capped — the percentiles are computed here rather than
 * with `$percentile` so the sample size travels with them. A median over four
 * quotes should be labelled as a median over four quotes.
 */
async function quoteLatency(
  range: Range,
): Promise<{ median: number; p90: number; sample: number } | null> {
  const rows = await Quote.aggregate<{ days: number }>([
    {
      $match: {
        issuedAt: { $gte: range.from, $lt: range.to },
        // Version 1 only: a revision's lag is measured from the same submission
        // and would count one request twice, weighting the sample towards the
        // requests that needed renegotiating.
        version: 1,
      },
    },
    {
      $lookup: {
        from: "customerRequests",
        localField: "requestId",
        foreignField: "_id",
        as: "request",
        pipeline: [{ $project: { submittedAt: 1 } }],
      },
    },
    { $unwind: "$request" },
    { $match: { "request.submittedAt": { $type: "date" } } },
    {
      $project: {
        days: {
          $floor: {
            $divide: [
              { $subtract: ["$issuedAt", "$request.submittedAt"] },
              24 * 60 * 60 * 1000,
            ],
          },
        },
      },
    },
    // A negative lag would mean a quote issued before its request was submitted,
    // which is a data problem rather than a fast turnaround.
    { $match: { days: { $gte: 0 } } },
    { $sort: { days: 1 } },
    { $limit: 2_000 },
  ]);

  if (rows.length === 0) return null;
  const days = rows.map((row) => row.days);
  return {
    median: percentile(days, 0.5),
    p90: percentile(days, 0.9),
    sample: days.length,
  };
}

/** Nearest-rank on an already-sorted ascending array. */
function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index]!;
}

/**
 * Open requests per assignee.
 *
 * Only the people who currently hold something. A roster of every staff member
 * with a zero beside most of them is a chart about headcount, not about load, and
 * it grows a row every time somebody joins.
 */
async function assigneeWorkload(): Promise<
  Array<{ userId: string; name: string; open: number }>
> {
  const rows = await CustomerRequest.aggregate<{ _id: Types.ObjectId; open: number }>([
    {
      $match: {
        status: { $in: OPEN_STATUSES },
        currentAssigneeUserId: { $exists: true },
      },
    },
    { $group: { _id: "$currentAssigneeUserId", open: { $sum: 1 } } },
    { $sort: { open: -1 } },
    { $limit: 15 },
  ]);

  if (rows.length === 0) return [];

  // One batch lookup rather than one per row — the N+1 that `queues.ts` and
  // `customer-360.ts` both go out of their way to avoid.
  const people = await User.find({ _id: { $in: rows.map((row) => row._id) } })
    .select({ name: 1, email: 1 })
    .lean<Array<{ _id: unknown; name?: string; email: string }>>();
  const nameById = new Map(people.map((row) => [String(row._id), row.name ?? row.email]));

  return rows.map((row) => ({
    userId: String(row._id),
    name: nameById.get(String(row._id)) ?? "Unknown",
    open: row.open,
  }));
}

/**
 * Money owed, by how late it is, per currency.
 *
 * Per currency because it is money and `money.ts` will not combine it; by band
 * because "£40,000 outstanding" and "£40,000 outstanding for over three months"
 * are different conversations. `amountPaid` is netted off inside the pipeline for
 * the same reason as on the admin side — there is no stored outstanding column
 * and there should not be.
 */
async function invoiceAgeing(
  now: Date,
): Promise<Array<{ currency: string; bands: Array<{ label: string; amount: number }> }>> {
  const rows = await Invoice.aggregate<{
    _id: { currency: string; band: string };
    amount: number;
  }>([
    { $match: { status: { $in: ["issued", "partially_paid", "overdue"] } } },
    {
      $addFields: {
        __outstanding: {
          $subtract: ["$total.amount", { $ifNull: ["$amountPaid.amount", 0] }],
        },
        __lateDays: {
          $cond: [
            { $eq: [{ $type: "$dueAt" }, "date"] },
            { $floor: { $divide: [{ $subtract: [now, "$dueAt"] }, 24 * 60 * 60 * 1000] } },
            // No due date is not the same as not late, and it is not overdue
            // either. Filed as "not yet due" rather than guessed at.
            -1,
          ],
        },
      },
    },
    {
      $addFields: {
        __band: {
          $switch: {
            branches: [
              { case: { $lt: ["$__lateDays", 1] }, then: "Not yet due" },
              { case: { $lt: ["$__lateDays", 31] }, then: "1–30 days late" },
              { case: { $lt: ["$__lateDays", 91] }, then: "31–90 days late" },
            ],
            default: "Over 90 days late",
          },
        },
      },
    },
    {
      $group: {
        _id: { currency: "$currency", band: "$__band" },
        amount: { $sum: "$__outstanding" },
      },
    },
  ]);

  const ORDER = ["Not yet due", "1–30 days late", "31–90 days late", "Over 90 days late"];
  const byCurrency = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bands = byCurrency.get(row._id.currency) ?? new Map<string, number>();
    bands.set(row._id.band, (bands.get(row._id.band) ?? 0) + row.amount);
    byCurrency.set(row._id.currency, bands);
  }

  return [...byCurrency.entries()]
    .map(([currency, bands]) => ({
      currency,
      bands: ORDER.filter((label) => (bands.get(label) ?? 0) !== 0).map((label) => ({
        label,
        amount: bands.get(label) ?? 0,
      })),
    }))
    .sort((a, b) => total(b.bands) - total(a.bands));
}

function total(bands: ReadonlyArray<{ amount: number }>): number {
  return bands.reduce((sum, band) => sum + band.amount, 0);
}
