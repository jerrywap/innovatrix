import { describe, expect, it } from "vitest";
import {
  MoneyError,
  add,
  allocate,
  format,
  formatPlain,
  fromDecimal,
  fromDocument,
  money,
  multiply,
  percentage,
  subtract,
  sum,
  toDecimal,
  toDocument,
  zero,
} from "./money";

describe("money — construction", () => {
  it("rejects non-integer amounts, because a float here is silent corruption", () => {
    expect(() => money(299.99, "GBP")).toThrow(MoneyError);
    expect(() => money(299.99, "GBP")).toThrow(/integer in minor units/);
  });

  it("suggests the right fix in the error message", () => {
    expect(() => money(29.5, "GBP")).toThrow(/fromDecimal/);
  });

  it("rejects unsafe integers", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, "GBP")).toThrow(MoneyError);
  });

  it("builds from a decimal figure, rounding half-up at currency precision", () => {
    expect(fromDecimal(299.99, "GBP")).toEqual({ amount: 29999, currency: "GBP" });
    expect(fromDecimal("1,299.50", "GBP")).toEqual({ amount: 129950, currency: "GBP" });
    expect(fromDecimal(0.005, "GBP").amount).toBe(1);
  });

  it("honours the currency exponent rather than assuming 100", () => {
    expect(fromDecimal(1500, "JPY")).toEqual({ amount: 1500, currency: "JPY" });
    expect(toDecimal(money(1500, "JPY"))).toBe(1500);
    expect(toDecimal(money(29999, "GBP"))).toBe(299.99);
  });
});

describe("money — arithmetic", () => {
  it("refuses to combine different currencies", () => {
    expect(() => add(money(100, "GBP"), money(100, "USD"))).toThrow(MoneyError);
    expect(() => add(money(100, "GBP"), money(100, "USD"))).toThrow(
      /Cannot combine GBP with USD/,
    );
    expect(() => subtract(money(100, "GBP"), money(100, "NGN"))).toThrow(MoneyError);
  });

  it("adds the §12 example cart without floating-point drift", () => {
    // CRM Pro £299.00 + Installation £99.00 + Brand £49.00 + Support £149.00
    const total = sum([
      fromDecimal(299, "GBP"),
      fromDecimal(99, "GBP"),
      fromDecimal(49, "GBP"),
      fromDecimal(149, "GBP"),
    ]);
    expect(total.amount).toBe(59600);
    expect(format(total)).toBe("£596.00");
  });

  it("survives the classic 0.1 + 0.2 float trap", () => {
    const result = add(fromDecimal(0.1, "GBP"), fromDecimal(0.2, "GBP"));
    expect(result.amount).toBe(30);
    expect(toDecimal(result)).toBe(0.3);
  });

  it("multiplies only by whole quantities", () => {
    expect(multiply(money(29999, "GBP"), 3).amount).toBe(89997);
    expect(() => multiply(money(100, "GBP"), 1.5)).toThrow(MoneyError);
  });

  it("takes percentages in basis points to avoid 0.2-vs-20 ambiguity", () => {
    expect(percentage(money(10000, "GBP"), 2000).amount).toBe(2000); // 20% VAT
    expect(percentage(money(29999, "GBP"), 2000).amount).toBe(6000); // rounds half-up
    expect(() => percentage(money(100, "GBP"), 20.5)).toThrow(MoneyError);
  });

  it("sums an empty list only with an explicit currency", () => {
    expect(sum([], "GBP")).toEqual(zero("GBP"));
    expect(() => sum([])).toThrow(MoneyError);
  });
});

describe("money — allocate", () => {
  it("never loses or invents a minor unit", () => {
    const parts = allocate(fromDecimal(10, "GBP"), 3);
    expect(parts.map((p) => p.amount)).toEqual([334, 333, 333]);
    expect(sum(parts).amount).toBe(1000);
  });

  it("handles exact division", () => {
    const parts = allocate(fromDecimal(9, "GBP"), 3);
    expect(parts.map((p) => p.amount)).toEqual([300, 300, 300]);
  });

  it("handles a 50% deposit split (ticket 23)", () => {
    const [deposit, balance] = allocate(fromDecimal(1234.57, "GBP"), 2);
    expect(deposit!.amount + balance!.amount).toBe(123457);
  });

  it("allocates negative amounts (refunds) without drifting", () => {
    const parts = allocate(money(-1000, "GBP"), 3);
    expect(sum(parts).amount).toBe(-1000);
  });
});

describe("money — formatting", () => {
  it("formats each currency with its own symbol", () => {
    expect(format(money(29999, "GBP"))).toBe("£299.99");
    expect(format(money(45000000, "NGN"))).toContain("450,000.00");
    expect(format(money(1500, "JPY"))).toContain("1,500");
  });

  it("drops empty decimals in compact mode", () => {
    expect(format(money(29900, "GBP"), { compact: true })).toBe("£299");
    expect(format(money(29999, "GBP"), { compact: true })).toBe("£299.99");
  });

  it("emits a bare numeric string for provider payloads (PayPal decimals)", () => {
    expect(formatPlain(money(29999, "GBP"))).toBe("299.99");
    expect(formatPlain(money(1500, "JPY"))).toBe("1500");
  });
});

describe("money — persistence", () => {
  it("round-trips through a document", () => {
    const m = money(29999, "GBP");
    expect(fromDocument(toDocument(m))).toEqual(m);
  });

  it("rejects an unsupported stored currency rather than guessing", () => {
    expect(() => fromDocument({ amount: 100, currency: "XYZ" })).toThrow(MoneyError);
  });

  it("returns null for an absent document", () => {
    expect(fromDocument(null)).toBeNull();
  });
});
