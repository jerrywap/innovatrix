import { describe, expect, it } from "vitest";
import { StateTransitionError } from "@/lib/errors";
import {
  INVOICE_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PRODUCT_TRANSITIONS,
  PRODUCT_TRANSITION_RULES,
  QUOTE_TRANSITIONS,
  REQUEST_TRANSITIONS,
  REQUEST_TRANSITION_RULES,
  STATE_MACHINES,
  VENDOR_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  nextStates,
  requestTransitionRule,
} from "./states";
import { PERMISSIONS } from "@/lib/auth/permissions";

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

/**
 * The same drift guard, for products — vendor ticket 05.
 *
 * `PRODUCT_TRANSITION_RULES` replaced an ad-hoc ternary that computed a permission
 * from the target state and appeared in **two** places. These four tests are what
 * make the data worth more than the branches were: a missing rule is a button that
 * does nothing, and a rule for a non-existent edge is authorisation somebody wrote
 * for a transition they only think is possible.
 */
describe("PRODUCT_TRANSITION_RULES covers PRODUCT_TRANSITIONS exactly", () => {
  const edges = Object.entries(PRODUCT_TRANSITIONS).flatMap(([from, targets]) =>
    (targets as readonly string[]).map((to) => `${from}->${to}`),
  );

  it("has a rule for every edge in the machine", () => {
    const missing = edges.filter((key) => !(key in PRODUCT_TRANSITION_RULES));
    expect(missing).toEqual([]);
  });

  it("has no rule for an edge the machine does not allow", () => {
    const invented = Object.keys(PRODUCT_TRANSITION_RULES).filter(
      (key) => !edges.includes(key),
    );
    expect(invented).toEqual([]);
  });

  it("names only permissions that exist", () => {
    const named = Object.values(PRODUCT_TRANSITION_RULES)
      .map((rule) => rule.permission)
      .filter((permission) => permission !== null);
    const unknown = named.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    expect(unknown).toEqual([]);
  });

  it("gives every rule a label", () => {
    for (const [key, rule] of Object.entries(PRODUCT_TRANSITION_RULES)) {
      expect(rule.label, key).toMatch(/\S/);
    }
  });

  /**
   * The authorisation rule the whole ticket rests on: a vendor hands a product over
   * and a reviewer decides. Asserted against the data rather than against a screen,
   * because the screen is not what a POST goes through.
   */
  it("lets a vendor reach submitted and nothing beyond it", () => {
    const vendorEdges = Object.entries(PRODUCT_TRANSITION_RULES)
      .filter(([, rule]) => rule.vendorMay)
      .map(([key]) => key)
      .sort();

    expect(vendorEdges).toEqual([
      "changes_requested->draft",
      "changes_requested->submitted",
      "draft->submitted",
      "submitted->draft",
    ]);
  });

  it("never lets a vendor publish, deprecate or archive", () => {
    for (const to of ["published", "deprecated", "archived", "ready", "testing"]) {
      const reachable = Object.entries(PRODUCT_TRANSITION_RULES)
        .filter(([key, rule]) => key.endsWith(`->${to}`) && rule.vendorMay)
        .map(([key]) => key);
      expect(reachable, `vendor must not reach ${to}`).toEqual([]);
    }
  });

  it("has no staff route to submission, because the attestation is the vendor's", () => {
    expect(PRODUCT_TRANSITION_RULES["draft->submitted"]!.permission).toBeNull();
    expect(PRODUCT_TRANSITION_RULES["changes_requested->submitted"]!.permission).toBeNull();
  });

  it("requires a reason on every edge that sends a submission back", () => {
    expect(PRODUCT_TRANSITION_RULES["submitted->changes_requested"]!.requiresReason).toBe(true);
    expect(PRODUCT_TRANSITION_RULES["internal_review->changes_requested"]!.requiresReason).toBe(
      true,
    );
  });
});

describe("vendor (vendor ticket 01)", () => {
  it("walks an application through to verified", () => {
    expect(canTransition(VENDOR_TRANSITIONS, "applied", "in_review")).toBe(true);
    expect(canTransition(VENDOR_TRANSITIONS, "in_review", "verified")).toBe(true);
  });

  it("cannot verify an application nobody has reviewed", () => {
    expect(canTransition(VENDOR_TRANSITIONS, "applied", "verified")).toBe(false);
  });

  it("lets a suspension be lifted, because a suspension is usually a dispute", () => {
    expect(canTransition(VENDOR_TRANSITIONS, "verified", "suspended")).toBe(true);
    expect(canTransition(VENDOR_TRANSITIONS, "suspended", "verified")).toBe(true);
  });

  it("never reopens a rejection or an offboarding", () => {
    expect(isTerminal(VENDOR_TRANSITIONS, "rejected")).toBe(true);
    expect(isTerminal(VENDOR_TRANSITIONS, "offboarded")).toBe(true);
  });

  it("cannot offboard somebody who was never verified", () => {
    // Offboarding runs a final settlement (vendor ticket 12). There is nothing to
    // settle for an applicant, and `rejected` is the state that means this.
    expect(canTransition(VENDOR_TRANSITIONS, "applied", "offboarded")).toBe(false);
    expect(canTransition(VENDOR_TRANSITIONS, "in_review", "offboarded")).toBe(false);
  });
});

/**
 * The graph and the authorisation layer are two maps, so the only thing keeping
 * them honest is this.
 *
 * The failure they prevent is quiet in both directions. A missing rule means
 * `RequestService.transition` refuses a move the machine allows — a button that
 * does nothing. A rule for an edge that does not exist means somebody wrote
 * authorisation for a transition they *think* is possible, which reads as
 * coverage and is not.
 */
describe("REQUEST_TRANSITION_RULES covers REQUEST_TRANSITIONS exactly", () => {
  const edges = Object.entries(REQUEST_TRANSITIONS).flatMap(([from, targets]) =>
    (targets as readonly string[]).map((to) => `${from}->${to}`),
  );

  it("has a rule for every edge in the machine", () => {
    const missing = edges.filter((key) => !(key in REQUEST_TRANSITION_RULES));
    expect(missing).toEqual([]);
  });

  it("has no rule for an edge the machine does not allow", () => {
    const invented = Object.keys(REQUEST_TRANSITION_RULES).filter(
      (key) => !edges.includes(key),
    );
    expect(invented).toEqual([]);
  });

  it("names only permissions that exist", () => {
    // A typo'd permission string is never granted to anyone, so the edge
    // becomes unreachable for staff and nothing says why.
    const named = Object.values(REQUEST_TRANSITION_RULES)
      .map((rule) => rule.permission)
      .filter((permission) => permission !== null);
    const unknown = named.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    expect(unknown).toEqual([]);
  });

  it("gives every rule a label, because the staff UI renders it", () => {
    for (const [key, rule] of Object.entries(REQUEST_TRANSITION_RULES)) {
      expect(rule.label, key).toMatch(/\S/);
    }
  });
});

describe("who may move a request", () => {
  it("lets a customer submit, and gives staff no route to submit for them", () => {
    // §34: "customer-confirmed" is a claim about who confirmed it. Staff
    // submitting on a customer's behalf would make that claim false.
    const rule = requestTransitionRule("draft", "submitted");
    expect(rule?.customerMay).toBe(true);
    expect(rule?.permission).toBeNull();
  });

  it("does not let a customer start their own review or convert their own request", () => {
    expect(requestTransitionRule("submitted", "under_review")?.customerMay).toBe(false);
    expect(requestTransitionRule("approved", "converted")?.customerMay).toBe(false);
  });

  it("lets a customer answer a request for information", () => {
    // The wait ends because the customer replied; requiring staff to close it
    // would leave requests parked in `waiting_for_customer` after the customer
    // has done their part.
    expect(requestTransitionRule("waiting_for_customer", "under_review")?.customerMay).toBe(
      true,
    );
  });

  it("lets a customer cancel right up to the point money and work are committed", () => {
    /*
     * The line is `approved`. Before it, cancelling costs nobody anything and
     * the customer should not have to ask. After it — `converted` means the
     * deposit cleared, `in_progress` means somebody is building — cancelling is
     * a refund and a part-finished job, which is a conversation, not a button.
     *
     * This used to assert that *every* state with a `cancelled` edge was
     * customer-cancellable, which was true only because the delivery states did
     * not exist yet.
     */
    const cancellableByCustomer = Object.entries(REQUEST_TRANSITIONS)
      .filter(([, targets]) => (targets as readonly string[]).includes("cancelled"))
      .map(([from]) => from)
      .filter((from) => from !== "converted" && from !== "in_progress");

    for (const from of cancellableByCustomer) {
      expect(
        requestTransitionRule(from as never, "cancelled")?.customerMay,
        `${from}->cancelled`,
      ).toBe(true);
    }

    // And the two that are staff-only are staff-only, rather than simply absent.
    for (const from of ["converted", "in_progress"] as const) {
      const rule = requestTransitionRule(from, "cancelled");
      expect(rule, `${from}->cancelled must exist`).toBeDefined();
      expect(rule?.customerMay, `${from}->cancelled`).toBe(false);
    }
  });

  it("carries the request past payment, which it used not to", () => {
    // `converted` was terminal, and it is reached automatically when the
    // deposit is paid — so the customer's last update was "payment received"
    // and nothing could follow it. Ever.
    expect(REQUEST_TRANSITIONS.converted.length).toBeGreaterThan(0);
    expect(REQUEST_TRANSITIONS.converted).toContain("in_progress");
    expect(REQUEST_TRANSITIONS.in_progress).toContain("delivered");
    expect(REQUEST_TRANSITIONS.delivered).toContain("completed");

    // Delivery is not acceptance: the customer can send it back.
    expect(REQUEST_TRANSITIONS.delivered).toContain("in_progress");
    expect(requestTransitionRule("delivered", "in_progress")?.customerMay).toBe(true);
    expect(requestTransitionRule("delivered", "completed")?.customerMay).toBe(true);

    // `completed` is the real terminal state now.
    expect(REQUEST_TRANSITIONS.completed).toHaveLength(0);
  });

  it("returns undefined for an edge that is not in the machine", () => {
    expect(requestTransitionRule("submitted", "converted")).toBeUndefined();
  });
});
