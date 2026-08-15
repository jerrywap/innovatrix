import { describe, expect, it } from "vitest";
import { StateTransitionError } from "@/lib/errors";
import {
  INVOICE_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PRODUCT_TRANSITIONS,
  QUOTE_TRANSITIONS,
  REQUEST_TRANSITIONS,
  STATE_MACHINES,
  assertTransition,
  canTransition,
  isTerminal,
  nextStates,
} from "./states";

/**
 * §91 — "State transitions must be validated server-side."
 *
 * These tests assert the *shape* of every machine generically, then pin the
 * specific transitions that carry money or contractual meaning.
 */

describe("every state machine", () => {
  it("only ever points at states it declares", () => {
    for (const [name, map] of Object.entries(STATE_MACHINES)) {
      const declared = new Set(Object.keys(map));
      for (const [from, targets] of Object.entries(map)) {
        for (const to of targets as readonly string[]) {
          expect(declared.has(to), `${name}: ${from} → ${to} is not a declared state`).toBe(
            true,
          );
        }
      }
    }
  });

  it("never lets a state transition to itself", () => {
    for (const [name, map] of Object.entries(STATE_MACHINES)) {
      for (const [from, targets] of Object.entries(map)) {
        expect(
          (targets as readonly string[]).includes(from),
          `${name}: ${from} → ${from} would hide a double-write`,
        ).toBe(false);
      }
    }
  });

  it("has at least one terminal state, so nothing loops forever", () => {
    for (const [name, map] of Object.entries(STATE_MACHINES)) {
      const terminals = Object.entries(map).filter(
        ([, t]) => (t as readonly string[]).length === 0,
      );
      expect(terminals.length, `${name} has no terminal state`).toBeGreaterThan(0);
    }
  });

  it("has every state reachable from the initial one", () => {
    for (const [name, map] of Object.entries(STATE_MACHINES)) {
      const states = Object.keys(map);
      const start = states[0]!;
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        for (const next of (map as Record<string, readonly string[]>)[queue.shift()!] ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      const orphans = states.filter((s) => !seen.has(s));
      expect(orphans, `${name}: unreachable state(s)`).toEqual([]);
    }
  });
});

describe("order", () => {
  it("reaches paid only from awaiting_payment", () => {
    expect(canTransition(ORDER_TRANSITIONS, "awaiting_payment", "paid")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "draft", "paid")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "cancelled", "paid")).toBe(false);
  });

  it("cannot be re-paid or un-refunded", () => {
    expect(isTerminal(ORDER_TRANSITIONS, "refunded")).toBe(true);
    expect(isTerminal(ORDER_TRANSITIONS, "cancelled")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "paid", "awaiting_payment")).toBe(false);
  });

  it("throws with both states named, so the log says what was attempted", () => {
    expect(() => assertTransition("order", ORDER_TRANSITIONS, "draft", "fulfilled")).toThrow(
      StateTransitionError,
    );
    expect(() => assertTransition("order", ORDER_TRANSITIONS, "draft", "fulfilled")).toThrow(
      /draft to fulfilled/,
    );
  });
});

describe("payment", () => {
  it("routes a mismatched amount to review rather than success (ticket 13)", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "pending", "requires_review")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "requires_review", "succeeded")).toBe(true);
  });

  it("lets a failed payment be retried but never resurrects a refund", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "failed", "pending")).toBe(true);
    expect(isTerminal(PAYMENT_TRANSITIONS, "refunded")).toBe(true);
  });
});

describe("request (§91)", () => {
  it("follows the spec's happy path end to end", () => {
    const path = [
      "draft",
      "submitted",
      "under_review",
      "technical_review",
      "quoted",
      "approved",
      "converted",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(
        canTransition(REQUEST_TRANSITIONS, path[i]!, path[i + 1]!),
        `${path[i]} → ${path[i + 1]}`,
      ).toBe(true);
    }
  });

  it("lets waiting_for_customer bounce back to review, and only there", () => {
    expect(nextStates(REQUEST_TRANSITIONS, "waiting_for_customer")).toEqual([
      "under_review",
      "cancelled",
    ]);
  });

  it("cannot skip straight from submitted to converted", () => {
    expect(canTransition(REQUEST_TRANSITIONS, "submitted", "converted")).toBe(false);
  });
});

describe("quote", () => {
  it("is terminal once accepted — a revision supersedes instead", () => {
    expect(isTerminal(QUOTE_TRANSITIONS, "accepted")).toBe(true);
    expect(canTransition(QUOTE_TRANSITIONS, "issued", "superseded")).toBe(true);
  });

  it("cannot be accepted after expiring", () => {
    expect(canTransition(QUOTE_TRANSITIONS, "expired", "accepted")).toBe(false);
  });

  it("cannot be issued twice", () => {
    expect(canTransition(QUOTE_TRANSITIONS, "issued", "issued")).toBe(false);
  });
});

describe("invoice (§63)", () => {
  it("supports partial payment as a first-class state, not an edge case", () => {
    expect(canTransition(INVOICE_TRANSITIONS, "issued", "partially_paid")).toBe(true);
    expect(canTransition(INVOICE_TRANSITIONS, "partially_paid", "paid")).toBe(true);
  });

  it("lets an overdue invoice still be paid", () => {
    expect(canTransition(INVOICE_TRANSITIONS, "overdue", "paid")).toBe(true);
  });
});

describe("product (§46)", () => {
  it("cannot jump from draft straight to published", () => {
    expect(canTransition(PRODUCT_TRANSITIONS, "draft", "published")).toBe(false);
  });

  it("walks the full §46 lifecycle", () => {
    const path = [
      "draft",
      "internal_review",
      "testing",
      "ready",
      "published",
      "deprecated",
      "archived",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(PRODUCT_TRANSITIONS, path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows un-deprecating but never un-archiving", () => {
    expect(canTransition(PRODUCT_TRANSITIONS, "deprecated", "published")).toBe(true);
    expect(isTerminal(PRODUCT_TRANSITIONS, "archived")).toBe(true);
  });
});
