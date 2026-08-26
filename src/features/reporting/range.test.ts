import { describe, expect, it } from "vitest";
import { toDateInputValue } from "@/lib/dates";
import {
  DEFAULT_RANGE,
  MAX_WINDOW_DAYS,
  RANGES,
  UNGROUPED,
  addBuckets,
  denseBuckets,
  fillSeries,
  parseRange,
  previousRange,
  truncate,
  type BucketRow,
} from "./range";

/**
 * The arithmetic behind every chart, tested here because it is the only part of
 * the dashboards a test can reach — both vitest projects are
 * `environment: "node"` with no jsdom, so nothing renders. That is not a reason
 * to test less; it is the reason the risk was pushed into a pure module in the
 * first place.
 *
 * `fillSeries` is the one that earns this file. Everything else would announce a
 * bug loudly; a series that quietly drops its empty buckets draws a plausible
 * chart of the wrong shape, and nobody would look twice at it.
 */

// A Wednesday, mid-month, mid-afternoon — so a truncation that forgets to zero
// the time, or a week boundary that lands on the wrong day, has somewhere to show.
const NOW = new Date("2026-08-26T14:37:11.000Z");

describe("parseRange", () => {
  it("defaults to 90 days when nothing is asked for", () => {
    expect(parseRange({}, NOW).key).toBe(DEFAULT_RANGE);
    expect(parseRange({}, NOW).key).toBe("90d");
  });

  it("ignores a range it does not offer rather than erroring", () => {
    // A query string is untrusted, and a dashboard is the wrong place to punish a
    // typo — `parseListParams` makes the same call for `?sort=`.
    expect(parseRange({ range: "all-time" }, NOW).key).toBe(DEFAULT_RANGE);
    expect(parseRange({ range: "" }, NOW).key).toBe(DEFAULT_RANGE);
    expect(parseRange({ range: "10y" }, NOW).key).toBe(DEFAULT_RANGE);
  });

  it("takes the first value when a key arrives twice", () => {
    expect(parseRange({ range: ["7d", "12m"] }, NOW).key).toBe("7d");
  });

  it("derives granularity from the range, so the two cannot disagree", () => {
    expect(parseRange({ range: "7d" }, NOW).granularity).toBe("day");
    expect(parseRange({ range: "30d" }, NOW).granularity).toBe("day");
    expect(parseRange({ range: "90d" }, NOW).granularity).toBe("week");
    expect(parseRange({ range: "12m" }, NOW).granularity).toBe("month");
  });

  it("offers every range a label, so a chip never renders a raw key", () => {
    for (const key of RANGES) expect(parseRange({ range: key }, NOW).label).not.toBe(key);
  });

  it("ends at the start of the bucket after now, not at now", () => {
    // A part-finished bucket drawn at full width reads as a collapse. The 27th is
    // the day after our Wednesday; the last *daily* bucket is the 26th, whole.
    const daily = parseRange({ range: "7d" }, NOW);
    expect(daily.to.toISOString()).toBe("2026-08-27T00:00:00.000Z");

    // 2026-08-26 is a Wednesday, so its week began Monday the 24th and the next
    // begins Monday the 31st.
    const weekly = parseRange({ range: "90d" }, NOW);
    expect(weekly.to.toISOString()).toBe("2026-08-31T00:00:00.000Z");

    const monthly = parseRange({ range: "12m" }, NOW);
    expect(monthly.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("opens a window on a bucket boundary rather than mid-bucket", () => {
    for (const key of RANGES) {
      const range = parseRange({ range: key }, NOW);
      expect(truncate(range.from, range.granularity).getTime()).toBe(range.from.getTime());
      expect(range.from.getTime()).toBeLessThan(range.to.getTime());
    }
  });

  it("counts months for a monthly window, so every column is one month", () => {
    const range = parseRange({ range: "12m" }, NOW);
    expect(range.from.toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(denseBuckets(range)).toHaveLength(12);
  });
});

describe("denseBuckets", () => {
  it("returns one entry per bucket with nothing missing", () => {
    expect(denseBuckets(parseRange({ range: "7d" }, NOW))).toHaveLength(7);
    expect(denseBuckets(parseRange({ range: "30d" }, NOW))).toHaveLength(30);
    expect(denseBuckets(parseRange({ range: "12m" }, NOW))).toHaveLength(12);
  });

  it("steps by exactly one bucket, in order, with no repeats", () => {
    for (const key of RANGES) {
      const range = parseRange({ range: key }, NOW);
      const buckets = denseBuckets(range);
      for (let i = 1; i < buckets.length; i += 1) {
        expect(buckets[i]!.getTime()).toBeGreaterThan(buckets[i - 1]!.getTime());
        expect(buckets[i]!.getTime()).toBe(
          addBuckets(buckets[i - 1]!, range.granularity, 1).getTime(),
        );
      }
    }
  });

  it("stays inside the window it was given", () => {
    for (const key of RANGES) {
      const range = parseRange({ range: key }, NOW);
      const buckets = denseBuckets(range);
      expect(buckets[0]!.getTime()).toBe(range.from.getTime());
      expect(buckets.at(-1)!.getTime()).toBeLessThan(range.to.getTime());
    }
  });

  it("crosses a month boundary without duplicating or skipping a day", () => {
    // A daily window spanning the end of February in a non-leap year, which is
    // where a naive "add 30 days then re-truncate" goes wrong.
    const range = parseRange({ range: "7d" }, new Date("2026-03-02T09:00:00.000Z"));
    expect(denseBuckets(range).map(toDateInputValue)).toEqual([
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("keeps every monthly bucket on the first, whatever the month's length", () => {
    const range = parseRange({ range: "12m" }, new Date("2026-01-31T23:59:59.000Z"));
    const buckets = denseBuckets(range);
    expect(buckets.every((d) => d.getUTCDate() === 1)).toBe(true);
    expect(buckets.map((d) => toDateInputValue(d).slice(0, 7))).toEqual([
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });

  it("never returns more buckets than the window ceiling allows", () => {
    for (const key of RANGES) {
      expect(denseBuckets(parseRange({ range: key }, NOW)).length).toBeLessThanOrEqual(
        MAX_WINDOW_DAYS,
      );
    }
  });
});

describe("previousRange", () => {
  it("is the equal-length window immediately before, touching it exactly", () => {
    for (const key of RANGES) {
      const range = parseRange({ range: key }, NOW);
      const before = previousRange(range);
      expect(before.to.getTime()).toBe(range.from.getTime());
      expect(denseBuckets(before)).toHaveLength(denseBuckets(range).length);
    }
  });

  it("compares month against month rather than against a fixed 28 days", () => {
    const range = parseRange({ range: "12m" }, NOW);
    const before = previousRange(range);
    expect(before.from.toISOString()).toBe("2024-09-01T00:00:00.000Z");
    expect(before.to.toISOString()).toBe("2025-09-01T00:00:00.000Z");
  });
});

describe("truncate", () => {
  it("puts a week on its Monday, and leaves a Monday alone", () => {
    // 2026-08-23 is a Sunday: the *end* of its week, six days after the Monday.
    expect(truncate(new Date("2026-08-23T22:00:00.000Z"), "week").toISOString()).toBe(
      "2026-08-17T00:00:00.000Z",
    );
    expect(truncate(new Date("2026-08-24T00:00:00.000Z"), "week").toISOString()).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });

  it("drops the time, so two moments in one bucket land on one key", () => {
    const morning = truncate(new Date("2026-08-26T00:00:01.000Z"), "day");
    const evening = truncate(new Date("2026-08-26T23:59:59.000Z"), "day");
    expect(morning.getTime()).toBe(evening.getTime());
  });
});

describe("addBuckets", () => {
  it("advances a month without a 31-day month dragging the boundary", () => {
    expect(addBuckets(new Date("2026-01-01T00:00:00.000Z"), "month", 1).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(addBuckets(new Date("2026-12-01T00:00:00.000Z"), "month", 1).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(addBuckets(new Date("2026-01-01T00:00:00.000Z"), "month", -1).toISOString()).toBe(
      "2025-12-01T00:00:00.000Z",
    );
  });
});

describe("fillSeries", () => {
  const buckets = denseBuckets(parseRange({ range: "7d" }, NOW));
  const label = (d: Date) => toDateInputValue(d);

  it("gives an empty bucket a zero, not an absent key", () => {
    // The bug this file exists for. A pipeline returns only buckets that had
    // something in them; a chart drawn off that closes its own gaps and reports a
    // shape the data never had.
    const rows: BucketRow[] = [{ bucket: buckets[0]!, key: "GBP", value: 500 }];
    const filled = fillSeries(buckets, rows, ["GBP"], label);

    expect(filled).toHaveLength(7);
    expect(filled[0]!.values.GBP).toBe(500);
    for (const row of filled.slice(1)) expect(row.values.GBP).toBe(0);
  });

  it("keeps a series that appears nowhere in the rows", () => {
    // A currency with no sales this period still deserves its flat line. Inferring
    // the series list from the data would make it vanish from the legend instead.
    const filled = fillSeries(buckets, [], ["GBP", "USD"], label);
    expect(Object.keys(filled[0]!.values).sort()).toEqual(["GBP", "USD"]);
    expect(filled.every((row) => row.values.USD === 0)).toBe(true);
  });

  it("ignores a series the caller did not ask for", () => {
    const rows: BucketRow[] = [{ bucket: buckets[0]!, key: "JPY", value: 900 }];
    expect(fillSeries(buckets, rows, ["GBP"], label)[0]!.values).toEqual({ GBP: 0 });
  });

  it("sums two rows landing in the same bucket and series", () => {
    const rows: BucketRow[] = [
      { bucket: buckets[2]!, key: "GBP", value: 100 },
      { bucket: buckets[2]!, key: "GBP", value: 250 },
    ];
    expect(fillSeries(buckets, rows, ["GBP"], label)[2]!.values.GBP).toBe(350);
  });

  it("files an ungrouped row under the total series", () => {
    const rows: BucketRow[] = [{ bucket: buckets[1]!, key: null, value: 7 }];
    expect(fillSeries(buckets, rows, [UNGROUPED], label)[1]!.values[UNGROUPED]).toBe(7);
  });

  it("drops a row from outside the window rather than inventing a bucket for it", () => {
    const rows: BucketRow[] = [
      { bucket: new Date("2020-01-01T00:00:00.000Z"), key: "GBP", value: 999 },
    ];
    const filled = fillSeries(buckets, rows, ["GBP"], label);
    expect(filled).toHaveLength(7);
    expect(filled.every((row) => row.values.GBP === 0)).toBe(true);
  });

  it("carries a stable key and a formatted label for every bucket", () => {
    const filled = fillSeries(buckets, [], ["GBP"], label);
    expect(new Set(filled.map((row) => row.at)).size).toBe(filled.length);
    expect(filled.at(-1)!.label).toBe("2026-08-26");
  });
});
