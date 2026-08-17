import { describe, expect, it } from "vitest";
import { add, money, type Money } from "@/lib/money";
import { formatRate, netOfDiscount, splitLineTotal } from "./commission-service";
import { CLEARANCE_DAYS, REFUND_WINDOW_DAYS, clearanceDate } from "./ledger-service";

/**
 * The commission arithmetic — vendor ticket 07.
 *
 * A unit test, deliberately: `splitLineTotal` and `netOfDiscount` are pure, and the
 * property that matters about them ("the parts sum to the whole, in every currency, at
 * every rate") is a claim about arithmetic rather than about a database.
 */

describe("splitLineTotal", () => {
  it("splits so the parts sum exactly to the whole", () => {
    const total = money(9999, "GBP");
    const { fee, earning } = splitLineTotal(total, 3000);

    // 30% of £99.99 is £29.997, which `percentage()` rounds to £30.00 — and the earning
    // is then the *remainder*, not a second rounded percentage. That is the whole design:
    // one rounding, one subtraction, no drift.
    expect(fee).toEqual(money(3000, "GBP"));
    expect(earning).toEqual(money(6999, "GBP"));
    expect(add(fee, earning)).toEqual(total);
  });

  /**
   * The one property worth exhausting.
   *
   * Not a hand-picked example, because the failure mode here is a *rounding* rule that is
   * right for 30% of £99.99 and wrong for 33.33% of £0.05. A penny lost per line is
   * exactly what a float, or a `Math.floor` on both halves, would produce — and it would
   * be invisible until a vendor added their own figures up.
   */
  it("never loses or invents a unit, at any rate, on any amount", () => {
    const rates = [0, 1, 250, 3000, 3333, 5000, 6667, 9999, 10_000];
    const amounts = [0, 1, 2, 3, 5, 7, 99, 100, 101, 999, 1000, 9999, 123_456];

    for (const currency of ["GBP", "JPY"] as const) {
      for (const rate of rates) {
        for (const amount of amounts) {
          const total = money(amount, currency);
          const { fee, earning } = splitLineTotal(total, rate);

          expect(fee.amount + earning.amount).toBe(amount);
          expect(Number.isInteger(fee.amount)).toBe(true);
          expect(Number.isInteger(earning.amount)).toBe(true);
          // Neither side may go negative — a "fee" larger than the line would be a
          // vendor owing us money for making a sale.
          expect(fee.amount).toBeGreaterThanOrEqual(0);
          expect(earning.amount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("gives the vendor everything at a zero rate and nothing at 100%", () => {
    const total = money(5000, "GBP");

    expect(splitLineTotal(total, 0)).toEqual({
      fee: money(0, "GBP"),
      earning: total,
    });
    expect(splitLineTotal(total, 10_000)).toEqual({
      fee: total,
      earning: money(0, "GBP"),
    });
  });

  it("keeps the line's currency on both halves", () => {
    const { fee, earning } = splitLineTotal(money(1000, "NGN"), 3000);
    expect(fee.currency).toBe("NGN");
    expect(earning.currency).toBe("NGN");
  });
});

describe("netOfDiscount", () => {
  const subtotal = money(10_000, "GBP");

  it("is the line total when there is no discount", () => {
    const line = money(4000, "GBP");
    expect(netOfDiscount(line, subtotal, null)).toEqual(line);
    expect(netOfDiscount(line, subtotal, money(0, "GBP"))).toEqual(line);
  });

  it("apportions the order discount by the line's share of the subtotal", () => {
    // A £20 discount on a £100 order: a £40 line carries £8 of it.
    expect(netOfDiscount(money(4000, "GBP"), subtotal, money(2000, "GBP"))).toEqual(
      money(3200, "GBP"),
    );
  });

  /**
   * A discount larger than the line it lands on.
   *
   * Proportional apportionment already makes this safe while the discount is no larger
   * than the subtotal — a £90 discount on a £100 order takes 90% of a £5 line, not £90 of
   * it. So the clamp in `netOfDiscount` is not what protects the normal case; the
   * proportion is.
   */
  it("apportions a large discount proportionally rather than absolutely", () => {
    expect(netOfDiscount(money(500, "GBP"), subtotal, money(9000, "GBP"))).toEqual(
      money(50, "GBP"),
    );
  });

  /**
   * The clamp, and the only case that needs it.
   *
   * A discount exceeding the subtotal should be impossible — pricing refuses it — but a
   * negative net would produce a *negative fee*, i.e. the platform paying a vendor for the
   * privilege of discounting, and that is not a number to leave to an invariant held
   * elsewhere.
   */
  it("never takes a line below zero", () => {
    const net = netOfDiscount(money(500, "GBP"), subtotal, money(20_000, "GBP"));
    expect(net.amount).toBe(0);
    expect(splitLineTotal(net, 3000).fee.amount).toBe(0);
  });

  it("is a no-op on a zero subtotal rather than dividing by it", () => {
    const line = money(0, "GBP");
    expect(netOfDiscount(line, money(0, "GBP"), money(500, "GBP"))).toEqual(line);
  });

  it("composes with the split so nothing is charged on the discount", () => {
    const line = money(4000, "GBP");
    const net = netOfDiscount(line, subtotal, money(2000, "GBP"));
    const { fee, earning } = splitLineTotal(net, 3000);

    // 30% of the *net* £32, not of the gross £40.
    expect(fee).toEqual(money(960, "GBP"));
    expect(add(fee, earning) as Money).toEqual(net);
  });
});

describe("formatRate", () => {
  it("renders whole and fractional percentages", () => {
    expect(formatRate(3000)).toBe("30%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(10_000)).toBe("100%");
    // Two decimals on a fractional rate rather than a trimmed "12.5%" — a rate column
    // reads better aligned, and this is the only place the number is cosmetic.
    expect(formatRate(1250)).toBe("12.50%");
    expect(formatRate(1)).toBe("0.01%");
  });
});

/**
 * The relationship vendor ticket 08 exists to enforce.
 *
 * The refund window was prose in a markdown file before this — 14 days, nowhere in `src/`.
 * Two numbers cannot be kept in a relationship when one of them is a sentence, so the
 * constant now lives beside the clearance period and this is the test that says why.
 */
describe("the clearance period", () => {
  it("exceeds the refund window", () => {
    expect(CLEARANCE_DAYS).toBeGreaterThan(REFUND_WINDOW_DAYS);
  });

  it("puts the clearance date that many days out", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(clearanceDate(from).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
