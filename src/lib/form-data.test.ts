import { describe, expect, it } from "vitest";
import { parseNestedFormData } from "./form-data";

function form(pairs: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
}

describe("parseNestedFormData", () => {
  it("keeps a flat form flat", () => {
    expect(
      parseNestedFormData(
        form([
          ["name", "Atlas CRM"],
          ["slug", "atlas-crm"],
        ]),
      ),
    ).toEqual({
      name: "Atlas CRM",
      slug: "atlas-crm",
    });
  });

  it("builds arrays of objects from indexed names", () => {
    const parsed = parseNestedFormData(
      form([
        ["prices[0][currency]", "GBP"],
        ["prices[0][amount]", "299.99"],
        ["prices[1][currency]", "USD"],
        ["prices[1][amount]", "380.00"],
      ]),
    );
    expect(parsed.prices).toEqual([
      { currency: "GBP", amount: "299.99" },
      { currency: "USD", amount: "380.00" },
    ]);
  });

  /**
   * The bug this module exists for. With `formDataToObject`, a blank amount in
   * the middle row shifts every later amount up one — NGN silently takes the
   * USD row's price. Here the hole stays a hole.
   */
  it("does not shift values when a row omits a field", () => {
    const parsed = parseNestedFormData(
      form([
        ["prices[0][currency]", "GBP"],
        ["prices[0][amount]", "299.99"],
        ["prices[1][currency]", "USD"],
        // no amount for USD — the input was left blank
        ["prices[2][currency]", "NGN"],
        ["prices[2][amount]", "598000"],
      ]),
    );

    expect(parsed.prices).toEqual([
      { currency: "GBP", amount: "299.99" },
      { currency: "USD" },
      { currency: "NGN", amount: "598000" },
    ]);
  });

  it("closes gaps in the indices, because Zod arrays reject sparse input", () => {
    const parsed = parseNestedFormData(
      form([
        ["features[0][title]", "Roles"],
        ["features[3][title]", "Reports"],
      ]),
    );
    expect(parsed.features).toEqual([{ title: "Roles" }, { title: "Reports" }]);
  });

  it("still collapses a repeated leaf name — a checkbox group", () => {
    const parsed = parseNestedFormData(
      form([
        ["categoryIds", "a"],
        ["categoryIds", "b"],
      ]),
    );
    expect(parsed.categoryIds).toEqual(["a", "b"]);
  });

  it("nests deeply", () => {
    const parsed = parseNestedFormData(
      form([
        ["licencePackages[0][key]", "single"],
        ["licencePackages[0][prices][0][currency]", "GBP"],
        ["licencePackages[0][prices][0][amount]", "299.99"],
      ]),
    );
    expect(parsed.licencePackages).toEqual([
      { key: "single", prices: [{ currency: "GBP", amount: "299.99" }] },
    ]);
  });

  it("accepts dot notation as well as brackets", () => {
    expect(parseNestedFormData(form([["seo.title", "Atlas CRM"]]))).toEqual({
      seo: { title: "Atlas CRM" },
    });
  });

  /* ────────────────────────────────────────── prototype pollution */

  it("drops __proto__ rather than mutating Object.prototype", () => {
    const parsed = parseNestedFormData(form([["__proto__[polluted]", "yes"]]));

    expect(parsed).toEqual({});
    // The actual danger: a later plain object inheriting the key.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("drops constructor and prototype at any depth", () => {
    const parsed = parseNestedFormData(
      form([
        ["a[constructor][x]", "1"],
        ["b[prototype][y]", "2"],
        ["ok", "kept"],
      ]),
    );
    expect(parsed).toEqual({ ok: "kept" });
  });

  it("refuses absurd nesting depth", () => {
    const deep = Array.from({ length: 40 }, (_, i) => `k${i}`).join("][");
    const parsed = parseNestedFormData(form([[`${deep}`, "v"]]));
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it("ignores empty field names", () => {
    expect(
      parseNestedFormData(
        form([
          ["", "v"],
          ["[]", "v"],
        ]),
      ),
    ).toEqual({});
  });
});
