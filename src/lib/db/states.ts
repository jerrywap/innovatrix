import { StateTransitionError } from "@/lib/errors";
import type {
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  QuoteStatus,
  RequestStatus,
} from "./enums";

/**
 * State machines — spec §91: "State transitions must be validated server-side."
 *
 * These maps are the validation, not a description of it. `STATES.md` is
 * generated from this file's shape, so the prose can never drift from the code.
 *
 * Two properties every map here holds:
 *   • A terminal state maps to `[]`, never to itself. Re-entering a terminal
 *     state is a bug, and allowing it hides double-fulfilment.
 *   • No transition is implicit. If a value isn't listed, the service throws.
 */

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/** §46 — publishing lifecycle. */
export const PRODUCT_TRANSITIONS: TransitionMap<ProductStatus> = {
  draft: ["internal_review", "archived"],
  internal_review: ["testing", "draft", "archived"],
  testing: ["ready", "internal_review", "archived"],
  ready: ["published", "testing", "archived"],
  published: ["deprecated", "archived"],
  deprecated: ["published", "archived"],
  archived: [],
};

/**
 * Orders. `paid` is only ever set by the verified-payment path (ticket 13) —
 * never by a checkout redirect (§13).
 */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  draft: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["fulfilled", "refunded"],
  fulfilled: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const PAYMENT_TRANSITIONS: TransitionMap<PaymentStatus> = {
  pending: ["succeeded", "failed", "requires_review"],
  // A verified amount that doesn't match the order total lands here rather
  // than fulfilling (ticket 13).
  requires_review: ["succeeded", "failed"],
  succeeded: ["refunded"],
  failed: ["pending"],
  refunded: [],
};

/** §91 — the customer request machine both AI doors feed into. */
export const REQUEST_TRANSITIONS: TransitionMap<RequestStatus> = {
  draft: ["submitted", "cancelled"],
  submitted: ["under_review", "cancelled"],
  under_review: ["waiting_for_customer", "technical_review", "quoted", "rejected", "cancelled"],
  waiting_for_customer: ["under_review", "cancelled"],
  technical_review: ["under_review", "quoted", "rejected"],
  quoted: ["approved", "rejected", "under_review"],
  approved: ["converted", "cancelled"],
  converted: [],
  rejected: [],
  cancelled: [],
};

/** A revision supersedes rather than edits in place (ticket 22). */
export const QUOTE_TRANSITIONS: TransitionMap<QuoteStatus> = {
  draft: ["issued"],
  issued: ["accepted", "rejected", "expired", "superseded"],
  accepted: [],
  rejected: ["superseded"],
  expired: ["superseded"],
  superseded: [],
};

/** §63 */
export const INVOICE_TRANSITIONS: TransitionMap<InvoiceStatus> = {
  draft: ["issued", "cancelled"],
  issued: ["partially_paid", "paid", "overdue", "cancelled"],
  partially_paid: ["paid", "overdue", "cancelled"],
  overdue: ["partially_paid", "paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

/* ────────────────────────────────────────────── enforcement */

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return (map[from] ?? []).includes(to);
}

/**
 * The only sanctioned way to change a status field.
 *
 * Services call this before writing. A caller that skips it and does
 * `{ $set: { status } }` directly has bypassed §91 — that is a review failure,
 * not a style preference.
 */
export function assertTransition<S extends string>(
  entity: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (from === to) {
    throw new StateTransitionError(entity, from, to);
  }
  if (!canTransition(map, from, to)) {
    throw new StateTransitionError(entity, from, to);
  }
}

export function nextStates<S extends string>(map: TransitionMap<S>, from: S): readonly S[] {
  return map[from] ?? [];
}

export function isTerminal<S extends string>(map: TransitionMap<S>, state: S): boolean {
  return (map[state] ?? []).length === 0;
}

/** Registry so tooling (docs, tests, the staff UI) can enumerate every machine. */
export const STATE_MACHINES = {
  product: PRODUCT_TRANSITIONS,
  order: ORDER_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  request: REQUEST_TRANSITIONS,
  quote: QUOTE_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
} as const;

export type StateMachineName = keyof typeof STATE_MACHINES;
