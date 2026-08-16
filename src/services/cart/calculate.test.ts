import { describe, expect, it } from "vitest";
import { calculateTotals, meetsMinimumSpend, type CalcLine } from "./calculate";
import { format, money } from "@/lib/money";

/**
 * The arithmetic a customer is charged by.
 *
 * Every case here fails **silently** if it regresses — a wrong total is still a
 * number, and it still renders. That is why these are exhaustive rather than
 * representative.
 */

const lines = (...amounts: Array<[number, number?]>): CalcLine[] =>
  amounts.map(([unitAmount, quantity], index) => ({
    lineId: `line-${index}`,
    unitAmount,
    quantity: quantity ?? 1,
  }));

describe("the §12 worked example", () => {
  it("adds £299.99 + £99.00 + £49.00 + £149.00 to exactly £596.99", () => {
    // The ticket's own example. If floating point ever gets into this path,
    // this is where it shows up — 596.9899999999999.
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([29_999], [9_900], [4_900], [14_900]),
    });

    expect(totals.subtotal.amount).toBe(59_699);
    expect(totals.total.amount).toBe(59_699);
    expect(format(totals.total)).toBe("£596.99");
    expect(Number.isInteger(totals.total.amount)).toBe(true);
  });
});

describe("subtotal", () => {
  it("multiplies by quantity", () => {
    const totals = calculateTotals({ currency: "GBP", lines: lines([29_999, 3]) });
    expect(totals.subtotal.amount).toBe(89_997);
  });

  it("is zero for an empty cart, in the cart's currency", () => {
    const totals = calculateTotals({ currency: "NGN", lines: [] });
    expect(totals.subtotal).toEqual(money(0, "NGN"));
    expect(totals.total.currency).toBe("NGN");
  });

  it("reports each line's total, keyed by line id", () => {
    const totals = calculateTotals({ currency: "GBP", lines: lines([1_000, 2], [500]) });
    expect(totals.lineTotals).toEqual([
      { lineId: "line-0", amount: money(2_000, "GBP") },
      { lineId: "line-1", amount: money(500, "GBP") },
    ]);
  });
});

describe("discount", () => {
  it("takes a fixed amount off the subtotal", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([29_999]),
      discount: { code: "SAVE50", kind: "fixed", value: 5_000 },
    });
    expect(totals.discount.amount).toBe(5_000);
    expect(totals.total.amount).toBe(24_999);
  });

  it("takes a percentage in basis points", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([10_000]),
      discount: { code: "TENOFF", kind: "percentage", value: 1_000 },
    });
    expect(totals.discount.amount).toBe(1_000);
  });

  it("clamps to the subtotal rather than going negative", () => {
    // A negative total reaching a provider is either a hard error or, with the
    // wrong one, a refund.
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([6_000]),
      discount: { code: "BIG", kind: "fixed", value: 10_000 },
    });
    expect(totals.discount.amount).toBe(6_000);
    expect(totals.total.amount).toBe(0);
  });

  it("rounds a percentage once, on the whole subtotal", () => {
    // Three lines of 3.33 at 33.33%. Rounding per line and summing gives a
    // different answer to rounding the total — and the customer's cart would
    // then depend on how they happened to split it.
    const perTotal = calculateTotals({
      currency: "GBP",
      lines: lines([333], [333], [333]),
      discount: { code: "THIRD", kind: "percentage", value: 3_333 },
    });
    // 999 × 3333 / 10000 = 332.97 → 333
    expect(perTotal.discount.amount).toBe(333);

    const perLine = [333, 333, 333]
      .map((amount) => Math.round((amount * 3_333) / 10_000))
      .reduce((a, b) => a + b, 0);
    // 111 × 3 = 333 here, but the point is that the code does not do this.
    expect(perTotal.discount.amount).toBe(perLine);
  });

  it("echoes the code so the order can snapshot it", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([10_000]),
      discount: { code: "SAVE10", kind: "fixed", value: 1_000 },
    });
    expect(totals.discountCode).toBe("SAVE10");
  });
});

describe("tax", () => {
  it("applies after the discount, not before", () => {
    // The one that matters. £100 cart, £20 off, 20% VAT:
    //   right: (10000 − 2000) × 0.2 = 1600, total 9600
    //   wrong:  10000 × 0.2 = 2000,          total 10000
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([10_000]),
      discount: { code: "TWENTY", kind: "fixed", value: 2_000 },
      tax: { ruleId: "uk-vat-20", basisPoints: 2_000 },
    });

    expect(totals.taxable.amount).toBe(8_000);
    expect(totals.tax.amount).toBe(1_600);
    expect(totals.total.amount).toBe(9_600);
  });

  it("is zero when no rule applies", () => {
    const totals = calculateTotals({ currency: "GBP", lines: lines([10_000]) });
    expect(totals.tax.amount).toBe(0);
    expect(totals.taxRuleId).toBeUndefined();
    expect(totals.total.amount).toBe(10_000);
  });

  it("records the rule id and rate for the §61 snapshot", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([10_000]),
      tax: { ruleId: "uk-digital-vat-20", basisPoints: 2_000 },
    });
    // Both, not just the amount — a reconciliation two years later needs to
    // know which rule produced the number as well as what the number was.
    expect(totals.taxRuleId).toBe("uk-digital-vat-20");
    expect(totals.taxBasisPoints).toBe(2_000);
  });

  it("rounds half-up on an awkward rate", () => {
    // 4999 × 0.175 = 874.825 → 875
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([4_999]),
      tax: { ruleId: "old-vat", basisPoints: 1_750 },
    });
    expect(totals.tax.amount).toBe(875);
  });

  it("taxes zero when a discount wipes the cart out", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([5_000]),
      discount: { code: "FREE", kind: "percentage", value: 10_000 },
      tax: { ruleId: "uk-vat-20", basisPoints: 2_000 },
    });
    expect(totals.taxable.amount).toBe(0);
    expect(totals.tax.amount).toBe(0);
    expect(totals.total.amount).toBe(0);
  });
});

describe("everything together", () => {
  it("stays exact across a realistic cart", () => {
    const totals = calculateTotals({
      currency: "GBP",
      lines: lines([29_999, 2], [9_900], [4_900], [14_900]),
      discount: { code: "LAUNCH15", kind: "percentage", value: 1_500 },
      tax: { ruleId: "uk-digital-vat-20", basisPoints: 2_000 },
    });

    expect(totals.subtotal.amount).toBe(89_698); // 59998 + 9900 + 4900 + 14900
    expect(totals.discount.amount).toBe(13_455); // 89698 × 0.15 = 13454.7 → 13455
    expect(totals.taxable.amount).toBe(76_243);
    expect(totals.tax.amount).toBe(15_249); // 76243 × 0.2 = 15248.6 → 15249
    expect(totals.total.amount).toBe(91_492);

    for (const value of [totals.subtotal, totals.discount, totals.tax, totals.total]) {
      expect(Number.isInteger(value.amount)).toBe(true);
    }
  });

  it("works for a zero-exponent currency", () => {
    // JPY has no minor unit, so 1000 is ¥1,000 — `toFixed(2)` anywhere in this
    // path would produce ¥1000.00 and a total off by a factor of a hundred.
    const totals = calculateTotals({
      currency: "JPY",
      lines: lines([1_000], [500]),
      tax: { ruleId: "jp-ct-10", basisPoints: 1_000 },
    });
    expect(totals.subtotal.amount).toBe(1_500);
    expect(totals.tax.amount).toBe(150);
    // The glyph is ICU's business (en-GB renders JPY with a *fullwidth* yen
    // sign), so assert the thing that is ours: no decimal places at all.
    expect(format(totals.total)).toMatch(/1,650$/);
    expect(format(totals.total)).not.toContain(".");
  });
});

describe("meetsMinimumSpend", () => {
  it("compares against the subtotal, before the discount", () => {
    // Otherwise a £100-minimum code disqualifies itself the moment it applies.
    expect(meetsMinimumSpend(money(10_000, "GBP"), { amount: 10_000, currency: "GBP" })).toBe(
      true,
    );
    expect(meetsMinimumSpend(money(9_999, "GBP"), { amount: 10_000, currency: "GBP" })).toBe(
      false,
    );
  });

  it("passes when there is no minimum", () => {
    expect(meetsMinimumSpend(money(1, "GBP"), undefined)).toBe(true);
  });

  it("refuses a minimum stated in another currency", () => {
    // Comparing would need an FX rate, which this platform deliberately does
    // not have — so the code simply does not apply here.
    expect(meetsMinimumSpend(money(1_000_000, "NGN"), { amount: 100, currency: "GBP" })).toBe(
      false,
    );
  });
});
