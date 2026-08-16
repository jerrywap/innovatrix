import { StateTransitionError } from "@/lib/errors";
import type { Permission } from "@/lib/auth/permissions";
import type {
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ProductVersionStatus,
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
 * §45 — a product version's life.
 *
 * Deliberately one-way. Releasing stamps `releasedAt`, which anchors the
 * entitlement update window (ticket 14) — so a version that could return to
 * `draft` would let an administrator silently change what a customer is
 * entitled to download. Release notes stay editable; the artefacts do not.
 *
 * `deprecated` is terminal rather than reversible: un-deprecating a version
 * would resurrect a download we have already told customers not to use.
 */
export const PRODUCT_VERSION_TRANSITIONS: TransitionMap<ProductVersionStatus> = {
  draft: ["released"],
  released: ["deprecated"],
  deprecated: [],
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

/* ────────────────────────────── who may move a request, and with what */

/**
 * §91's other half: *which actor* may take each edge.
 *
 * `REQUEST_TRANSITIONS` says a move is legal for the machine.  This says it is
 * legal for **you** — which permission a staff member needs, and whether the
 * customer who owns the request may do it themselves.
 *
 * ## Why this is a second map rather than a richer first one
 *
 * `TransitionMap<S>` is one shape across all seven machines. `assertTransition`
 * and `scripts/generate-docs.ts` both iterate it as `Record<S, readonly S[]>`,
 * so folding permissions into `REQUEST_TRANSITIONS` would either break the
 * generator or force every other machine to carry metadata it does not have.
 * Keeping the graph and the authorisation separate costs one lookup and a test
 * that they agree — `states.test.ts` asserts every edge has a rule and no rule
 * invents an edge, in both directions, so the two cannot drift.
 *
 * ## `customerMay` is not a UI hint
 *
 * A customer cancelling their own request or answering a `waiting_for_customer`
 * prompt is legitimate; a customer moving their own request to `approved` is
 * not, however the button was rendered. `RequestService.transition` reads this,
 * so hiding the control and forbidding the action are the same fact.
 */
export interface TransitionRule {
  /** Permission a staff actor needs. `null` ⇒ no staff route to this edge. */
  permission: Permission | null;
  /** May the customer who owns the request perform it? */
  customerMay: boolean;
  /** Plain-language label for the staff action button. */
  label: string;
}

const edge = (from: RequestStatus, to: RequestStatus) => `${from}->${to}` as const;

export const REQUEST_TRANSITION_RULES: Readonly<Record<string, TransitionRule>> = {
  // The customer submits their own request; staff never submit on their behalf,
  // because §34's "customer-confirmed" would then be a fiction.
  [edge("draft", "submitted")]: {
    permission: null,
    customerMay: true,
    label: "Submit",
  },
  [edge("draft", "cancelled")]: {
    permission: "request.close",
    customerMay: true,
    label: "Cancel",
  },
  [edge("submitted", "under_review")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Start review",
  },
  [edge("submitted", "cancelled")]: {
    permission: "request.close",
    customerMay: true,
    label: "Cancel",
  },
  [edge("under_review", "waiting_for_customer")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Ask the customer",
  },
  [edge("under_review", "technical_review")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Send to technical review",
  },
  [edge("under_review", "quoted")]: {
    permission: "quote.issue",
    customerMay: false,
    label: "Mark as quoted",
  },
  [edge("under_review", "rejected")]: {
    permission: "request.close",
    customerMay: false,
    label: "Decline",
  },
  [edge("under_review", "cancelled")]: {
    permission: "request.close",
    customerMay: true,
    label: "Cancel",
  },
  // The customer answering is what ends the wait, so they may take this edge.
  [edge("waiting_for_customer", "under_review")]: {
    permission: "request.update_status",
    customerMay: true,
    label: "Return to review",
  },
  [edge("waiting_for_customer", "cancelled")]: {
    permission: "request.close",
    customerMay: true,
    label: "Cancel",
  },
  [edge("technical_review", "under_review")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Return to review",
  },
  [edge("technical_review", "quoted")]: {
    permission: "quote.issue",
    customerMay: false,
    label: "Mark as quoted",
  },
  [edge("technical_review", "rejected")]: {
    permission: "request.close",
    customerMay: false,
    label: "Decline",
  },
  // Accepting a quote is the customer's decision — ticket 22 drives this edge
  // from `QuoteAccepted`, not from a staff button.
  [edge("quoted", "approved")]: {
    permission: "request.update_status",
    customerMay: true,
    label: "Mark approved",
  },
  [edge("quoted", "rejected")]: {
    permission: "request.close",
    customerMay: true,
    label: "Decline",
  },
  [edge("quoted", "under_review")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Reopen review",
  },
  [edge("approved", "converted")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Mark converted",
  },
  [edge("approved", "cancelled")]: {
    permission: "request.close",
    customerMay: true,
    label: "Cancel",
  },
};

export function requestTransitionRule(
  from: RequestStatus,
  to: RequestStatus,
): TransitionRule | undefined {
  return REQUEST_TRANSITION_RULES[edge(from, to)];
}

/** Registry so tooling (docs, tests, the staff UI) can enumerate every machine. */
export const STATE_MACHINES = {
  product: PRODUCT_TRANSITIONS,
  productVersion: PRODUCT_VERSION_TRANSITIONS,
  order: ORDER_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  request: REQUEST_TRANSITIONS,
  quote: QUOTE_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
} as const;

export type StateMachineName = keyof typeof STATE_MACHINES;
