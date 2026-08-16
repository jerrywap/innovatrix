import { describe, expect, it } from "vitest";
import { balanceAmount, computeTotals, depositAmount, lineTotal } from "./totals";

/**
 * Quote money — §51, §84.
 *
 * A quote is a commercial commitment, so the arithmetic is the part that has to
 * be right rather than approximately right. Every case here is one where a
 * plausible alternative implementation gives a different number.
 */

const item = (amount: number, quantity = 1) => ({
  quantity,
  unitPrice: { amount, currency: "GBP" },
});

describe("line totals", () => {
  it("multiplies integers, never floats", () => {
    // £299.99 × 3. The float version — 299.99 * 3 — is 899.9699999999999.
    expect(lineTotal(item(29_999, 3))).toBe(89_997);
  });
});

describe("discount then tax, in that order", () => {
  it("taxes what is actually charged", () => {
    // £1,000 subtotal, £100 off, 20% VAT.
    // Right: 20% of £900 = £180 → £1,080.
    // Wrong: 20% of £1,000 = £200 → £1,100, taxing money nobody pays.
    const totals = computeTotals({
      items: [item(100_000)],
      discountAmount: 10_000,
      taxBasisPoints: 2000,
    });

    expect(totals.taxable).toBe(90_000);
    expect(totals.tax).toBe(18_000);
    expect(totals.total).toBe(108_000);
  });

  it("agrees with the cart for the same numbers", () => {
    // Ticket 10 fixed the same order. A quote that totals differently from a
    // basket for identical inputs is a conversation nobody wants to have.
    const totals = computeTotals({
      items: [item(29_900), item(9_900), item(4_900)],
      taxBasisPoints: 2000,
    });

    expect(totals.subtotal).toBe(44_700);
    expect(totals.tax).toBe(8_940);
    expect(totals.total).toBe(53_640);
  });
});

describe("the discount cannot make a quote negative", () => {
  it("clamps a discount larger than the subtotal", () => {
    // A data-entry slip. A negative total would flow into an invoice and then
    // into a provider that rejects it, a long way from where it was typed.
    const totals = computeTotals({ items: [item(10_000)], discountAmount: 50_000 });

    expect(totals.discount).toBe(10_000);
    expect(totals.total).toBe(0);
  });

  it("ignores a negative discount rather than adding it on", () => {
    const totals = computeTotals({ items: [item(10_000)], discountAmount: -5_000 });
    expect(totals.total).toBe(10_000);
  });
});

describe("rounding happens once, not per line", () => {
  it("does not accumulate drift across many lines", () => {
    // Twenty lines at £3.33, 20% VAT.
    // Once at the end: 20% of 6660 = 1332.
    // Per line: round(333 × 0.2) = 67 each → 1340. Eight pence of drift that
    // reconciles against nothing.
    const items = Array.from({ length: 20 }, () => item(333));
    const totals = computeTotals({ items, taxBasisPoints: 2000 });

    expect(totals.subtotal).toBe(6_660);
    expect(totals.tax).toBe(1_332);
  });

  it("rounds half away from zero, consistently", () => {
    // 5% of 4.50 = 0.225 → 23p, not 22p.
    expect(computeTotals({ items: [item(450)], taxBasisPoints: 500 }).tax).toBe(23);
  });
});

describe("deposit and balance", () => {
  it("always adds back to the total", () => {
    // The property that matters: an odd penny must land somewhere, once.
    for (const total of [100_000, 33_333, 1, 999_999, 29_999]) {
      for (const bp of [2500, 3333, 5000]) {
        expect(depositAmount(total, bp) + balanceAmount(total, bp)).toBe(total);
      }
    }
  });

  it("rounds the deposit down, so it never exceeds the stated share", () => {
    // 50% of £333.33 is £166.665. Asking for £166.67 is more than half, and
    // that is the version somebody complains about.
    expect(depositAmount(33_333, 5000)).toBe(16_666);
    expect(balanceAmount(33_333, 5000)).toBe(16_667);
  });
});

describe("an empty quote", () => {
  it("totals zero rather than NaN", () => {
    const totals = computeTotals({ items: [], taxBasisPoints: 2000 });
    expect(totals).toEqual({ subtotal: 0, discount: 0, taxable: 0, tax: 0, total: 0 });
  });
});
