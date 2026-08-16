import type { Route } from "next";
import { describe, expect, it } from "vitest";
import { listHref, parseListParams, skipFor, sortSpec } from "./list-params";

const PATH = "/dashboard/orders" as Route;

describe("parseListParams — everything here is untrusted", () => {
  it("applies sane defaults for an empty query string", () => {
    const params = parseListParams({});
    expect(params).toMatchObject({ page: 1, limit: 25, direction: "desc", filters: {} });
    expect(params.sort).toBeUndefined();
    expect(params.q).toBeUndefined();
  });

  /** §94, no unbounded reads: `?limit=1000000` is a DoS wearing a preference. */
  it("clamps limit to the screen's maximum", () => {
    expect(parseListParams({ limit: "1000000" }).limit).toBe(100);
    expect(parseListParams({ limit: "1000000" }, { maxLimit: 50 }).limit).toBe(50);
    expect(parseListParams({ limit: "0" }).limit).toBe(1);
    expect(parseListParams({ limit: "-5" }).limit).toBe(1);
  });

  it("falls back rather than throwing on nonsense", () => {
    expect(parseListParams({ page: "abc" }).page).toBe(1);
    expect(parseListParams({ page: "1e400" }).page).toBe(1);
    expect(parseListParams({ limit: "not-a-number" }).limit).toBe(25);
  });

  it("caps page so an absurd skip can't be requested", () => {
    expect(parseListParams({ page: "99999999" }).page).toBe(10_000);
  });

  /** A column not offered for sorting must not reach the database. */
  it("ignores a sort column outside the allow-list", () => {
    const options = { sortable: ["createdAt", "total"], defaultSort: "createdAt" };
    expect(parseListParams({ sort: "total" }, options).sort).toBe("total");
    expect(parseListParams({ sort: "password" }, options).sort).toBe("createdAt");
    expect(parseListParams({ sort: "$where" }, options).sort).toBe("createdAt");
  });

  it("ignores a direction it doesn't recognise", () => {
    expect(parseListParams({ direction: "asc" }).direction).toBe("asc");
    expect(parseListParams({ direction: "sideways" }).direction).toBe("desc");
  });

  it("drops filter keys the screen didn't declare", () => {
    const params = parseListParams(
      { status: "paid", organizationId: "someone-elses-org" },
      { filterable: ["status"] },
    );
    expect(params.filters).toEqual({ status: "paid" });
    // The important half: scope never comes from the query string.
    expect(params.filters.organizationId).toBeUndefined();
  });

  it("trims and caps the search term", () => {
    expect(parseListParams({ q: "  crm  " }).q).toBe("crm");
    expect(parseListParams({ q: "   " }).q).toBeUndefined();
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(120);
  });

  it("takes the first value when a key is repeated", () => {
    expect(parseListParams({ page: ["3", "9"] }).page).toBe(3);
  });
});

describe("derived query pieces", () => {
  it("computes skip from page and limit", () => {
    expect(skipFor(parseListParams({ page: "1", limit: "20" }))).toBe(0);
    expect(skipFor(parseListParams({ page: "3", limit: "20" }))).toBe(40);
  });

  it("builds a Mongoose sort object, or nothing when unsorted", () => {
    const options = { sortable: ["createdAt"], defaultSort: "createdAt" };
    expect(sortSpec(parseListParams({ direction: "asc" }, options))).toEqual({ createdAt: 1 });
    expect(sortSpec(parseListParams({}, options))).toEqual({ createdAt: -1 });
    expect(sortSpec(parseListParams({}))).toBeUndefined();
  });
});

describe("listHref", () => {
  it("preserves the parameters it isn't changing", () => {
    expect(listHref(PATH, { q: "crm", status: "paid" }, { sort: "total" })).toBe(
      "/dashboard/orders?q=crm&status=paid&sort=total",
    );
  });

  /**
   * The subtle one. Filtering from page 7 down to a two-page result set would
   * otherwise land on an empty screen, which reads as a bug rather than a
   * filter.
   */
  it("resets to page 1 whenever anything but the page changes", () => {
    expect(listHref(PATH, { page: "7" }, { q: "crm" })).toBe("/dashboard/orders?q=crm");
    // …but paging itself keeps the page.
    expect(listHref(PATH, { q: "crm" }, { page: 2 })).toBe("/dashboard/orders?q=crm&page=2");
  });

  it("removes a parameter set to undefined or empty", () => {
    expect(listHref(PATH, { q: "crm", status: "paid" }, { status: undefined })).toBe(
      "/dashboard/orders?q=crm",
    );
    expect(listHref(PATH, { q: "crm" }, { q: "" })).toBe("/dashboard/orders");
  });

  it("returns a bare path when nothing is left", () => {
    expect(listHref(PATH, {}, {})).toBe("/dashboard/orders");
  });

  it("encodes values rather than pasting them in", () => {
    expect(listHref(PATH, {}, { q: "a&b=c d" })).toBe("/dashboard/orders?q=a%26b%3Dc+d");
  });
});
