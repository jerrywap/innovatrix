import { describe, expect, it } from "vitest";
import { format, money } from "@/lib/money";
import { formatBytes } from "@/lib/format-bytes";
import { assertEveryStatusHasATone, statusLabel, statusTone } from "./status-badge";

/**
 * Logic-only tests for the shared primitives. Rendering is covered by the
 * shells themselves — what matters here is the behaviour that would silently
 * drift: which colour a state gets, and what a customer reads.
 */

describe("StatusBadge — one colour vocabulary", () => {
  it("has a tone for every state in every machine", () => {
    // Walks the ticket-02 enums. A new state added to a machine without a tone
    // would otherwise render as neutral grey and look like a draft.
    expect(() => assertEveryStatusHasATone()).not.toThrow();
  });

  it("gives the same state the same tone across machines", () => {
    // "cancelled" must not be red on orders and grey on requests.
    expect(statusTone("cancelled")).toBe("negative");
    expect(statusTone("draft")).toBe("neutral");
    expect(statusTone("paid")).toBe("positive");
  });

  /**
   * The signal tone is §102's "needs your attention". It is reserved, so a
   * customer learns that orange on a dashboard always means them.
   */
  it("reserves the attention tone for states the customer must act on", () => {
    for (const status of ["awaiting_payment", "waiting_for_customer", "quoted", "invited"]) {
      expect(statusTone(status), status).toBe("attention");
    }
    for (const status of ["submitted", "under_review", "technical_review"]) {
      expect(statusTone(status), status).not.toBe("attention");
    }
  });

  it("falls back to neutral for an unknown state rather than throwing", () => {
    expect(statusTone("something_new")).toBe("neutral");
  });

  it("de-snake-cases labels, and overrides the ones that read badly", () => {
    expect(statusLabel("under_review")).toBe("Under review");
    expect(statusLabel("paid")).toBe("Paid");
    // Staff read "we're blocked"; a customer must read it as a request.
    expect(statusLabel("waiting_for_customer")).toBe("Needs your input");
    expect(statusLabel("awaiting_payment")).toBe("Awaiting payment");
  });
});

describe("MoneyDisplay renders through lib/money — §84", () => {
  /** The ticket's acceptance criterion, from minor units. */
  it("renders £299.99 and ₦450,000.00 correctly", () => {
    expect(format(money(29999, "GBP"))).toBe("£299.99");
    expect(format(money(45_000_000, "NGN"))).toBe("₦450,000.00");
  });

  it("handles a zero-exponent currency, which toFixed(2) would corrupt", () => {
    // The reason `toFixed` is banned: JPY has no minor unit, so 500 yen is
    // ¥500 — not ¥5.00.
    expect(format(money(500, "JPY"))).toBe("￥500");
  });

  it("drops empty decimals only when asked", () => {
    expect(format(money(29900, "GBP"))).toBe("£299.00");
    expect(format(money(29900, "GBP"), { compact: true })).toBe("£299");
    // …and never when there is a real fractional part to lose.
    expect(format(money(29999, "GBP"), { compact: true })).toBe("£299.99");
  });
});

describe("formatBytes is shared by the dropzone and the storage policy", () => {
  it("reads like something a person wrote", () => {
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2GB");
  });
});
