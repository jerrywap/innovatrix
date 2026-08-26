import type { RawSearchParams } from "@/lib/list-params";

/**
 * The window a dashboard is looking at, and the buckets inside it.
 *
 * ## Pure, and given the clock rather than reading it
 *
 * Every function here takes `now` as an argument. That is not fastidiousness: a
 * Server Component that reads `new Date()` during a prerender makes Next 16 fail
 * the render outright — *"encountered the unstable value `new Date()` while
 * prerendering"* — which `features/reporting/headline.ts` hit six times before
 * adding its `atRequestTime()` (`await connection()`) guard. Taking the clock as
 * a parameter puts that call in the page, where the boundary is, and leaves this
 * module a pile of arithmetic that a unit test can pin without a database, a
 * request, or a fake timer.
 *
 * ## Granularity is derived, not chosen
 *
 * There is one control, not two. A separate granularity picker is a second
 * dimension of state to carry in the URL, and its main use in practice is
 * asking for 365 daily bars — a chart nobody can read, off a pipeline nobody
 * wants to run. So the range implies its own resolution and the two cannot
 * disagree.
 *
 * ## Everything is clamped
 *
 * `parseListParams` makes the argument in full: a query string is untrusted, and
 * `?range=` is no different. An unrecognised value falls back to the default
 * rather than erroring, because a dashboard is not the place to punish a
 * mistyped URL, and `MAX_WINDOW_DAYS` bounds the read the same way
 * `services/vendors/analytics-service.ts` already bounds a vendor's.
 */

/** The offered windows. Anything else in `?range=` is ignored. */
export const RANGES = ["7d", "30d", "90d", "12m"] as const;
export type RangeKey = (typeof RANGES)[number];

export type Granularity = "day" | "week" | "month";

/**
 * The longest window anyone may ask for, matching the vendor analytics ceiling.
 * No unbounded reads, and that includes unbounded by date.
 */
export const MAX_WINDOW_DAYS = 365;

export const DEFAULT_RANGE: RangeKey = "90d";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How each window is spelled on the screen, and how deep it goes. */
const SHAPES: Record<RangeKey, { label: string; days: number; granularity: Granularity }> = {
  "7d": { label: "7 days", days: 7, granularity: "day" },
  "30d": { label: "30 days", days: 30, granularity: "day" },
  "90d": { label: "90 days", days: 90, granularity: "week" },
  "12m": { label: "12 months", days: 365, granularity: "month" },
};

export interface Range {
  key: RangeKey;
  /** For the filter chip and for a heading that says what it is showing. */
  label: string;
  /** Inclusive lower bound: the start of the first bucket. */
  from: Date;
  /** Exclusive upper bound. Always the start of the bucket *after* the last. */
  to: Date;
  granularity: Granularity;
  days: number;
}

/**
 * `?range=` → a window, defaulting to 90 days.
 *
 * `to` is the start of the bucket after the one containing `now`, not `now`
 * itself. Half a bucket of data plotted at full width reads as a collapse in the
 * final period — the classic "our revenue fell off a cliff" chart, where the
 * cliff is that today is Tuesday. The last bucket is still included; it is
 * simply the whole bucket, and the caller can say so.
 */
export function parseRange(raw: RawSearchParams, now: Date): Range {
  const requested = first(raw.range);
  const key: RangeKey = isRangeKey(requested) ? requested : DEFAULT_RANGE;
  const shape = SHAPES[key];

  const to = addBuckets(truncate(now, shape.granularity), shape.granularity, 1);
  const from = startFor(to, shape);

  return {
    key,
    label: shape.label,
    from,
    to,
    granularity: shape.granularity,
    days: shape.days,
  };
}

/**
 * The equal-length window immediately before this one — what "up 12% on the
 * previous period" is measured against.
 *
 * Aligned to bucket boundaries rather than subtracting a fixed number of
 * milliseconds, so a monthly comparison lines February up against January
 * instead of against "the 28 days before the 1st".
 */
export function previousRange(range: Range): Range {
  const buckets = denseBuckets(range).length;
  return {
    ...range,
    from: addBuckets(range.from, range.granularity, -buckets),
    to: range.from,
  };
}

/**
 * Every bucket start in the window, in order, with none missing.
 *
 * The whole point of the module. `$dateTrunc` returns only buckets that had
 * something in them, so a series taken straight from a pipeline has no gaps —
 * it has *closed* its gaps, silently, by putting Monday next to the Monday three
 * weeks later and drawing a straight line between them. That is not a rendering
 * detail; it is a chart that reports a different shape from the data.
 */
export function denseBuckets(range: Range): Date[] {
  const buckets: Date[] = [];
  let cursor = truncate(range.from, range.granularity);

  // Bounded by the window, which is itself bounded by MAX_WINDOW_DAYS — so the
  // ceiling here is 365 daily buckets and the loop cannot run away on a bad date.
  while (cursor < range.to && buckets.length <= MAX_WINDOW_DAYS) {
    buckets.push(cursor);
    cursor = addBuckets(cursor, range.granularity, 1);
  }

  return buckets;
}

/** One `(bucket, series)` total, as a pipeline returns it. */
export interface BucketRow {
  /** The bucket start, as `$dateTrunc` produced it. */
  bucket: Date;
  /** The second dimension — a currency, a status, a kind. `null` when ungrouped. */
  key: string | null;
  value: number;
}

/** One bucket, with a slot for every series, ready for a chart. */
export interface FilledRow {
  /** Machine-readable, and a stable React key. */
  at: string;
  /** Pre-formatted for the axis — see `chart-data.ts` for why the server does this. */
  label: string;
  values: Record<string, number>;
}

/**
 * Rows from a pipeline, laid onto every bucket in the window.
 *
 * A bucket with no data gets `0` for every series, not an absent key: a missing
 * point and a zero point draw differently, and only one of them is true. Series
 * are passed in rather than inferred from the rows, for the same reason — a
 * currency that had no sales in the window still deserves its flat line, and
 * inferring the series list from the data means it silently disappears instead.
 */
export function fillSeries(
  buckets: readonly Date[],
  rows: readonly BucketRow[],
  series: readonly string[],
  labelFor: (bucket: Date) => string,
): FilledRow[] {
  const byBucket = new Map<number, Map<string, number>>();

  for (const row of rows) {
    const at = row.bucket.getTime();
    const bucket = byBucket.get(at) ?? new Map<string, number>();
    const key = row.key ?? UNGROUPED;
    bucket.set(key, (bucket.get(key) ?? 0) + row.value);
    byBucket.set(at, bucket);
  }

  return buckets.map((bucket) => {
    const found = byBucket.get(bucket.getTime());
    const values: Record<string, number> = {};
    for (const name of series) values[name] = found?.get(name) ?? 0;
    return { at: bucket.toISOString(), label: labelFor(bucket), values };
  });
}

/** The series name `fillSeries` uses for rows with no grouping dimension. */
export const UNGROUPED = "total";

/* ────────────────────────────────────────────── arithmetic */

/**
 * The start of the bucket containing `date`, in **UTC**.
 *
 * UTC throughout, matching `lib/dates.ts`, so a bucket boundary means the same
 * thing on the server that produced it and the client that labels it. Weeks
 * start on Monday, which is also what the `$dateTrunc` stage is told, because
 * the two must agree or a week's rows land in the bucket beside their label.
 */
export function truncate(date: Date, granularity: Granularity): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (granularity === "month") return new Date(Date.UTC(year, month, 1));
  if (granularity === "day") return new Date(Date.UTC(year, month, day));

  // Monday-first: getUTCDay() is 0 for Sunday, which is the end of the week here
  // and not the start of it.
  const weekday = date.getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  return new Date(Date.UTC(year, month, day - backToMonday));
}

/**
 * `count` buckets forward from a bucket start. Negative goes back.
 *
 * Months advance through `Date.UTC`'s own overflow handling rather than by
 * adding days, so a 31-day month does not drag the boundary. Days and weeks are
 * safe as millisecond arithmetic precisely because everything here is UTC —
 * there is no hour that exists twice.
 */
export function addBuckets(bucket: Date, granularity: Granularity, count: number): Date {
  if (granularity === "month") {
    return new Date(Date.UTC(bucket.getUTCFullYear(), bucket.getUTCMonth() + count, 1));
  }
  const step = granularity === "week" ? 7 : 1;
  return new Date(bucket.getTime() + count * step * MS_PER_DAY);
}

/**
 * Where the window opens, given where it closes.
 *
 * Monthly windows count months, so "12 months" is twelve labelled columns
 * whatever their lengths. Everything else counts days back from the exclusive
 * end and then truncates, so a 90-day window opens on a Monday rather than
 * mid-week with a stub bucket.
 */
function startFor(to: Date, shape: (typeof SHAPES)[RangeKey]): Date {
  if (shape.granularity === "month") return addBuckets(to, "month", -12);
  return truncate(new Date(to.getTime() - shape.days * MS_PER_DAY), shape.granularity);
}

function isRangeKey(value: string | undefined): value is RangeKey {
  return value !== undefined && (RANGES as readonly string[]).includes(value);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
