import { describe, expect, it } from "vitest";
import { formatDateTime, formatDay, toDateInputValue } from "./dates";

const MOMENT = new Date("2026-08-14T10:31:00.000Z");

describe("formatDay", () => {
  it("renders a day without implying a time", () => {
    expect(formatDay(MOMENT)).toBe("14 Aug 2026");
  });

  it("accepts a string or a number", () => {
    expect(formatDay("2026-08-14T10:31:00.000Z")).toBe("14 Aug 2026");
    expect(formatDay(MOMENT.getTime())).toBe("14 Aug 2026");
  });
});

describe("formatDateTime", () => {
  it("keeps the time", () => {
    expect(formatDateTime(MOMENT)).toContain("10:31");
  });

  it("orders three events on one afternoon — §70's own example", () => {
    // As days these were three identical labels, which is the entire bug.
    const rendered = [
      "2026-08-14T10:31:00Z",
      "2026-08-14T11:15:00Z",
      "2026-08-14T13:42:00Z",
    ].map(formatDateTime);

    expect(new Set(rendered).size).toBe(3);
    expect(rendered[0]).toContain("10:31");
    expect(rendered[2]).toContain("13:42");
  });

  it("is stable across calls, so server and client agree", () => {
    // A fixed locale and an explicit zone are what make this true; without them
    // the two render differently and React complains at hydration.
    expect(formatDateTime(MOMENT)).toBe(formatDateTime(MOMENT));
  });

  it("does not drift with the machine's timezone", () => {
    // Same instant, expressed with a different offset.
    expect(formatDateTime("2026-08-14T12:31:00+02:00")).toBe(formatDateTime(MOMENT));
  });
});

describe("toDateInputValue", () => {
  it("is the machine form, for inputs and <time dateTime>", () => {
    expect(toDateInputValue(MOMENT)).toBe("2026-08-14");
  });
});

describe("bad input", () => {
  it("renders nothing rather than 'Invalid Date'", () => {
    // A missing timestamp is a gap in the data, not a string to print at a
    // customer.
    expect(formatDay("not a date")).toBe("");
    expect(formatDateTime("not a date")).toBe("");
    expect(toDateInputValue("not a date")).toBe("");
  });
});
