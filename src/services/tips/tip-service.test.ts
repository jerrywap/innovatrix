import { describe, expect, it } from "vitest";
import { splitTip, TIP_PRESETS, TIP_LIMITS } from "./tip-service";
import { money } from "@/lib/money";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";

/**
 * The tip split, and the amounts offered.
 *
 * Pure arithmetic over `Money`, so a unit test — no transaction, no index, no
 * tenancy filter. What it protects is the promise the modal makes: the figure a
 * tipper is shown as reaching the vendor is the figure that reaches the vendor.
 */

describe("splitting a tip", () => {
  it("gives the vendor the remainder after commission, exactly", () => {
    const { gross, fee, earning } = splitTip(money(500, "GBP"), 1500);

    expect(gross.amount).toBe(500);
    expect(fee.amount).toBe(75);
    expect(earning.amount).toBe(425);
    // The invariant that matters: nothing is created or lost in the split.
    expect(fee.amount + earning.amount).toBe(gross.amount);
  });

  it("never loses a penny to rounding", () => {
    // 333 at 15% is 49.95 — the case a float would round into a missing penny.
    for (const amount of [1, 7, 333, 999, 1234, 9_999]) {
      const { fee, earning } = splitTip(money(amount, "GBP"), 1500);
      expect(fee.amount + earning.amount, `${amount}`).toBe(amount);
      expect(Number.isInteger(fee.amount)).toBe(true);
      expect(Number.isInteger(earning.amount)).toBe(true);
    }
  });

  it("gives everything to the vendor at a zero rate", () => {
    const { fee, earning } = splitTip(money(500, "GBP"), 0);
    expect(fee.amount).toBe(0);
    expect(earning.amount).toBe(500);
  });

  it("keeps the currency", () => {
    expect(splitTip(money(500, "NGN"), 1500).earning.currency).toBe("NGN");
  });
});

describe("the amounts offered", () => {
  it("covers every storefront currency", () => {
    // A currency with no presets would render an empty row of buttons.
    for (const currency of STOREFRONT_CURRENCIES) {
      expect(TIP_PRESETS[currency], currency).toHaveLength(3);
      expect(TIP_LIMITS[currency], currency).toBeDefined();
    }
  });

  it("offers presets in ascending order, inside the limits", () => {
    for (const currency of STOREFRONT_CURRENCIES) {
      const presets = TIP_PRESETS[currency];
      const { min, max } = TIP_LIMITS[currency];

      expect([...presets], currency).toEqual([...presets].sort((a, b) => a - b));
      for (const preset of presets) {
        expect(preset, `${currency} ${preset}`).toBeGreaterThanOrEqual(min);
        expect(preset, `${currency} ${preset}`).toBeLessThanOrEqual(max);
        expect(Number.isInteger(preset), `${currency} ${preset}`).toBe(true);
      }
    }
  });

  /**
   * Not converted, and this is the assertion that says so.
   *
   * A tip is a gesture, and the gesture is "about a fiver". Converting £3 into
   * ₦6,205 offers a number nobody would choose on a screen whose only job is to
   * make choosing easy — so NGN gets its own round figures and this test fails if
   * somebody later "fixes" them with an exchange rate.
   */
  it("uses round local figures rather than converted ones", () => {
    for (const currency of STOREFRONT_CURRENCIES) {
      for (const preset of TIP_PRESETS[currency]) {
        expect(preset % 100, `${currency} ${preset} should be a whole unit`).toBe(0);
      }
    }
  });
});

/**
 * Picking the currency a tip is taken in.
 *
 * The rule the dialog implements, asserted on its own so it is not only true by
 * inspection of a component. Pure: `options` is whatever the server resolved, and
 * the choice is a function of that plus the viewer's own currency.
 */
function activeCurrency(viewer: string, options: readonly { currency: string }[]): string {
  return options.some((o) => o.currency === viewer) ? viewer : (options[0]?.currency ?? viewer);
}

describe("which currency a tip is taken in", () => {
  it("keeps the viewer's currency when we can charge it", () => {
    expect(activeCurrency("GBP", [{ currency: "GBP" }, { currency: "NGN" }])).toBe("GBP");
  });

  /**
   * The case that prompted this.
   *
   * With Stripe off and only Paystack configured, a visitor browsing in GBP met
   * "We can't take payment in GBP at the moment" *after* choosing an amount. The
   * dialog now opens on something chargeable instead.
   */
  it("falls back to a payable one when it cannot", () => {
    expect(activeCurrency("GBP", [{ currency: "NGN" }])).toBe("NGN");
  });

  it("leaves the viewer's currency alone when nothing is payable", () => {
    // Nothing to switch to; the dialog shows the "not available" state instead
    // of a switcher with no options in it.
    expect(activeCurrency("GBP", [])).toBe("GBP");
  });
});
