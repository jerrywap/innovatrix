import "server-only";
import type { PipelineStage } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import type { BucketRow, Granularity, Range } from "./range";

/**
 * The one time-series pipeline, and the one grouped-total pipeline.
 *
 * Sixteen panels want the same two shapes — "this measure, bucketed by date,
 * optionally split by a second dimension" and "this measure, grouped by one
 * field" — so they are built once here rather than sixteen times with sixteen
 * chances to get the boundary conditions wrong. `$dateTrunc` had no caller
 * anywhere in this codebase before now; this is the only one it gets.
 *
 * ## Every read is windowed and capped
 *
 * The window comes from `Range`, which is itself clamped to `MAX_WINDOW_DAYS`,
 * and every grouped result is capped. `services/vendors/analytics-service.ts`
 * argues the case: an analytics page that scans every order for a busy product
 * is the query that takes the marketplace down at the worst possible time.
 *
 * ## UTC, Monday-first, and it has to match
 *
 * `$dateTrunc` is told `timezone: "UTC"` and `startOfWeek: "monday"` because
 * `range.ts` truncates the same way and `lib/dates.ts` formats the same way. If
 * these three ever disagree, a week's rows land in the bucket beside their own
 * label — a bug that shifts a chart by one column and looks like nothing.
 */

/** Structural, so any Mongoose model fits without this module importing all of them. */
interface Aggregator {
  aggregate<R>(pipeline: PipelineStage[]): Promise<R[]>;
}

/**
 * The most series one chart may draw.
 *
 * Not a performance bound — a legend of thirty statuses is unreadable long
 * before it is slow. A caller that hits this is asking the wrong question and
 * should group first.
 */
export const MAX_SERIES = 12;

/** The most rows a ranked breakdown returns. Top sellers, not every product. */
export const MAX_GROUP_ROWS = 20;

export interface TimeSeriesOptions {
  model: Aggregator;
  /** The date the measure happened on: `paidAt`, `submittedAt`, `issuedAt`, `createdAt`. */
  dateField: string;
  /** Narrowing applied *before* the window, so an index can serve both. */
  match?: Record<string, unknown>;
  range: Range;
  /** A second dimension — `currency`, `status`, `kind`. Omitted gives one series. */
  groupBy?: string;
  /**
   * A numeric field to total, in whatever unit it is stored in — minor units for
   * money, micros for AI spend. Omitted counts documents instead.
   */
  sum?: string;
}

/**
 * A measure over time, bucketed to the range's own granularity.
 *
 * Returns only the buckets that had data — which is exactly why `fillSeries`
 * exists and why no caller should render this array directly.
 */
export async function timeSeries(options: TimeSeriesOptions): Promise<BucketRow[]> {
  const { model, dateField, match = {}, range, groupBy, sum } = options;
  await connectToDatabase();

  const rows = await model.aggregate<{
    _id: { bucket: Date; key?: unknown };
    value: number;
  }>([
    {
      $match: {
        ...match,
        [dateField]: { $gte: range.from, $lt: range.to },
      },
    },
    {
      $group: {
        _id: {
          bucket: truncStage(dateField, range.granularity),
          ...(groupBy ? { key: `$${groupBy}` } : {}),
        },
        value: sum ? { $sum: `$${sum}` } : { $sum: 1 },
      },
    },
    { $sort: { "_id.bucket": 1 } },
  ]);

  return rows.map((row) => ({
    bucket: row._id.bucket,
    key: keyOf(row._id.key),
    value: row.value,
  }));
}

/**
 * Which series a chart should draw, and in what order — biggest first.
 *
 * Derived from the window's own totals rather than from the enum, so a status
 * nobody has used does not claim a colour and a legend slot. Capped at
 * `MAX_SERIES`; a caller that needs the enum order instead should pass its own
 * list to `fillSeries`, which is why that function takes the series rather than
 * inferring them.
 */
export function seriesFrom(rows: readonly BucketRow[]): string[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.key === null) continue;
    totals.set(row.key, (totals.get(row.key) ?? 0) + row.value);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SERIES)
    .map(([key]) => key);
}

export interface GroupTotal {
  key: string;
  value: number;
  count: number;
}

export interface GroupTotalsOptions {
  model: Aggregator;
  /** The field to group on. A dotted path is fine: `amount.currency`. */
  groupBy: string;
  match?: Record<string, unknown>;
  /** Total this field instead of counting documents. Both are always returned. */
  sum?: string;
  limit?: number;
}

/**
 * One measure grouped by one field — a composition, or a ranking.
 *
 * `value` and `count` are both returned always, because the two questions
 * ("how much" and "how many") arrive together on nearly every panel and asking
 * twice is a second round trip for a second `$group` over the same documents.
 */
export async function groupTotals(options: GroupTotalsOptions): Promise<GroupTotal[]> {
  const { model, groupBy, match = {}, sum, limit = MAX_GROUP_ROWS } = options;
  await connectToDatabase();

  const rows = await model.aggregate<{ _id: unknown; value: number; count: number }>([
    { $match: match },
    {
      $group: {
        _id: `$${groupBy}`,
        value: sum ? { $sum: `$${sum}` } : { $sum: 1 },
        count: { $sum: 1 },
      },
    },
    { $sort: { value: -1, count: -1 } },
    { $limit: Math.min(Math.max(1, limit), MAX_GROUP_ROWS) },
  ]);

  return rows
    .filter((row) => keyOf(row._id) !== null)
    .map((row) => ({ key: String(row._id), value: row.value, count: row.count }));
}

/**
 * A histogram of how long something has been sitting, in whole days.
 *
 * `$bucket` needs its boundaries ascending and finite, so the open-ended top
 * bucket is `default`. The age is computed in the pipeline rather than filtered
 * per bucket, which is one pass instead of one query per band.
 */
export interface AgeBand {
  label: string;
  /** Inclusive lower bound, in days. */
  from: number;
  count: number;
}

export async function ageBands(options: {
  model: Aggregator;
  dateField: string;
  match?: Record<string, unknown>;
  now: Date;
  /** Ascending lower bounds in days. `[0, 3, 8, 15]` gives 0–2, 3–7, 8–14, 15+. */
  boundaries: readonly number[];
}): Promise<AgeBand[]> {
  const { model, dateField, match = {}, now, boundaries } = options;
  await connectToDatabase();

  const rows = await model.aggregate<{ _id: number | "older"; count: number }>([
    { $match: match },
    {
      $addFields: {
        __ageDays: {
          $floor: {
            $divide: [{ $subtract: [now, `$${dateField}`] }, 24 * 60 * 60 * 1000],
          },
        },
      },
    },
    {
      $bucket: {
        groupBy: "$__ageDays",
        boundaries: [...boundaries, Number.MAX_SAFE_INTEGER],
        default: "older",
        output: { count: { $sum: 1 } },
      },
    },
  ]);

  const counts = new Map(rows.map((row) => [String(row._id), row.count]));

  return boundaries.map((from, index) => {
    const next = boundaries[index + 1];
    return {
      label:
        next === undefined
          ? `${from}+ days`
          : next - from === 1
            ? `${from} days`
            : `${from}–${next - 1} days`,
      from,
      // Anything past the last boundary lands in `default` rather than in a
      // numbered bucket, so the top band has to look in both places.
      count:
        (counts.get(String(from)) ?? 0) + (next === undefined ? (counts.get("older") ?? 0) : 0),
    };
  });
}

/* ────────────────────────────────────────────── internals */

function truncStage(dateField: string, granularity: Granularity) {
  return {
    $dateTrunc: {
      date: `$${dateField}`,
      unit: granularity,
      timezone: "UTC",
      // Ignored for day and month, load-bearing for week — and it must agree with
      // `truncate()` in `range.ts`, which also starts a week on Monday.
      startOfWeek: "monday",
    },
  };
}

/**
 * A grouping key, as a string, or `null` when there isn't one.
 *
 * `null` covers three cases that all mean "no series here": an ungrouped
 * pipeline, a document missing the field, and an explicit null in the data. A
 * `$group` on an absent path yields `null` rather than skipping the document, so
 * without this a breakdown grows a phantom "null" column.
 */
function keyOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
