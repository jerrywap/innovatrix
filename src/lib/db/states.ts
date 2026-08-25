import { StateTransitionError } from "@/lib/errors";
import type { Permission } from "@/lib/auth/permissions";
import type {
  AddonProvisioningStatus,
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ProductVersionStatus,
  QuoteStatus,
  PayoutStatus,
  RequestStatus,
  VendorStatus,
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

/**
 * §46 — publishing lifecycle, extended by vendor ticket 05 with an external
 * submitter.
 *
 * ```
 * draft ──submit──→ submitted ──approve──→ internal_review → ready → published
 *   ↑                    │
 *   └── changes_requested ←── request-changes ──┘
 * ```
 *
 * The two new states sit at the **front**. Everything from `internal_review`
 * onwards is untouched, which is the point: a vendor's product joins the pipeline
 * the platform already uses for its own, so the same
 * readiness gate apply to both.
 *
 * `draft → internal_review` stays, so a first-party product still skips the
 * submission step it has no submitter for.
 *
 * `changes_requested → submitted` rather than only back through `draft`: a
 * resubmission is the common case and routing it through `draft` would lose the
 * distinction between "not finished" and "fixed and sent back".
 *
 * Who may take each edge is `PRODUCT_TRANSITION_RULES` below — this map is the
 * graph, not the authorisation.
 */
/**
 * The route to sale, in order — for showing somebody where they are on it.
 *
 * `PRODUCT_TRANSITIONS` is a graph and says nothing about direction: `internal_review`
 * lists `ready` beside `changes_requested`, `draft` and `archived`, all four equal. That
 * is right for deciding what is *legal* and useless for answering "so how do I publish
 * this", which is what a reviewer asks after approving a submission — publication is two
 * hops away and the screen offered no hint that it was ahead rather than missing.
 *
 * Display only. Nothing authorises against this list, and the graph stays the authority on
 * what may be taken; `states.test.ts` checks that every consecutive pair here is a real
 * edge, so the rail cannot draw a step the machine would refuse.
 *
 * `submitted` sits on it even though a first-party product skips it — the rail describes
 * the longest route, and a vendor product does take every step.
 */
export const PRODUCT_PUBLICATION_PATH = [
  "draft",
  "submitted",
  "internal_review",
  "ready",
  "published",
] as const satisfies readonly ProductStatus[];

export const PRODUCT_TRANSITIONS: TransitionMap<ProductStatus> = {
  draft: ["submitted", "internal_review", "archived"],
  submitted: ["internal_review", "changes_requested", "draft", "archived"],
  changes_requested: ["submitted", "draft", "archived"],
  internal_review: ["ready", "changes_requested", "draft", "archived"],
  ready: ["published", "internal_review", "archived"],
  published: ["deprecated", "archived"],
  deprecated: ["published", "archived"],
  archived: [],
};

/**
 * Vendor ticket 01 — a vendor's life on the platform.
 *
 * `applied` is first because `states.test.ts` requires every state to be
 * reachable from the first key, and an application is where a vendor begins.
 *
 * `suspended → verified` is the one edge back: a suspension is usually a dispute
 * rather than an ending, and reinstating must be one action rather than a
 * re-application. `rejected` and `offboarded` are terminal — offboarding runs a
 * final settlement (vendor ticket 12) and un-running that is not a state change.
 */
export const VENDOR_TRANSITIONS: TransitionMap<VendorStatus> = {
  applied: ["in_review", "rejected"],
  in_review: ["verified", "rejected"],
  verified: ["suspended", "offboarded"],
  suspended: ["verified", "offboarded"],
  rejected: [],
  offboarded: [],
};

/**
 * A payout's life — vendor ticket 09.
 *
 * `draft → approved` is a human decision and stays one. Money leaving the platform on a
 * schedule with nobody looking is not a feature: a batch is prepared automatically and
 * released deliberately.
 *
 * `failed → approved` rather than `failed → draft`: a failed transfer has already been
 * approved once and nothing about the decision changed — the bank did. Sending it back to
 * `draft` would ask somebody to re-approve a payment they already approved, which is how
 * approval becomes a formality.
 *
 * `paid` is terminal. Un-paying is not a state change; it is a new negative entry.
 */
export const PAYOUT_TRANSITIONS: TransitionMap<PayoutStatus> = {
  draft: ["approved", "cancelled"],
  approved: ["sending", "cancelled"],
  sending: ["paid", "failed"],
  failed: ["approved", "cancelled"],
  paid: [],
  cancelled: [],
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
  /*
   * `converted` was terminal — and it is reached automatically the moment the
   * deposit invoice is paid. So the last thing a customer was ever told was
   * "Payment received — we're getting started", and there was no state anybody
   * could move it to afterwards. The `ready-to-start` queue filtered on this
   * status, which meant nothing ever left it either.
   */
  converted: ["in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  // Back to `in_progress` when the customer says it is not right. Delivery is
  // not an assertion that the work is accepted.
  delivered: ["completed", "in_progress"],
  completed: [],
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

  /* ── delivery ─────────────────────────────────────────
   *
   * `request.update_status` throughout rather than a new permission: the roles
   * that already move a request through review are the ones who deliver it, and
   * inventing `request.deliver` would mean editing the 41×11 matrix for no
   * behavioural difference. `request.close` still guards the ways out.
   */
  [edge("converted", "in_progress")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Start work",
  },
  [edge("converted", "cancelled")]: {
    permission: "request.close",
    customerMay: false,
    label: "Cancel",
  },
  [edge("in_progress", "delivered")]: {
    permission: "request.update_status",
    customerMay: false,
    label: "Mark delivered",
  },
  [edge("in_progress", "cancelled")]: {
    permission: "request.close",
    customerMay: false,
    label: "Cancel",
  },
  // The customer is who decides it is finished, so they may take this edge.
  [edge("delivered", "completed")]: {
    permission: "request.update_status",
    customerMay: true,
    label: "Mark complete",
  },
  [edge("delivered", "in_progress")]: {
    permission: "request.update_status",
    customerMay: true,
    label: "Reopen — not right yet",
  },
};

export function requestTransitionRule(
  from: RequestStatus,
  to: RequestStatus,
): TransitionRule | undefined {
  return REQUEST_TRANSITION_RULES[edge(from, to)];
}

/* ────────────────────────── who may move a product, and with what */

/**
 * The same idea for products — vendor ticket 05.
 *
 * ## What this replaces
 *
 * The permission for a product transition was computed from the target state by an
 * ad-hoc ternary, and it appeared **twice** — in `transitionProductAction` and again
 * in `bulkTransitionAction`. Two copies of an authorisation rule is one copy too
 * many; the first time they disagree, one screen enforces something the other does
 * not. Expressing it as data means one function reads it and one test iterates it.
 *
 * ## `vendorMay` is not a UI hint
 *
 * A vendor submitting their own product, or withdrawing a submission before anybody
 * has looked at it, is legitimate. A vendor moving their own product to `published`
 * is not, however the button was rendered — and a vendor product id is a URL
 * somebody will POST to. `productService.transition` reads this, so hiding the
 * control and refusing the action are the same fact.
 *
 * `permission: null` means there is **no staff route** to that edge: nobody submits
 * on a vendor's behalf, because the attestation recorded with a submission would
 * then be a statement somebody else made about their code.
 */
export interface ProductTransitionRule {
  /** Permission a staff actor needs. `null` ⇒ no staff route to this edge. */
  permission: Permission | null;
  /** May a member of the vendor that owns the product perform it? */
  vendorMay: boolean;
  /** Plain-language label for the action button. */
  label: string;
  /** Does taking this edge require a reason the vendor will read? */
  requiresReason?: true;
}

const productEdge = (from: ProductStatus, to: ProductStatus) => `${from}->${to}` as const;

export const PRODUCT_TRANSITION_RULES: Readonly<Record<string, ProductTransitionRule>> = {
  /* ── the vendor's half ── */

  // Nobody submits for a vendor: the attestation is theirs to make.
  [productEdge("draft", "submitted")]: {
    permission: null,
    vendorMay: true,
    label: "Submit for review",
  },
  // Withdrawing is only meaningful before a reviewer claims it; once it is in
  // `internal_review` the way back is `changes_requested`, which carries a reason.
  [productEdge("submitted", "draft")]: {
    permission: "product.update",
    vendorMay: true,
    label: "Withdraw",
  },
  [productEdge("changes_requested", "submitted")]: {
    permission: null,
    vendorMay: true,
    label: "Resubmit",
  },
  [productEdge("changes_requested", "draft")]: {
    permission: "product.update",
    vendorMay: true,
    label: "Back to draft",
  },

  /* ── the reviewer's half ── */

  // Claiming a submission. `product.review` rather than `product.publish`: reading a
  // submission and deciding it may be sold are different jobs, and §77 already
  // separates editing from publishing for the same reason.
  [productEdge("submitted", "internal_review")]: {
    permission: "product.review",
    vendorMay: false,
    label: "Start review",
  },
  [productEdge("submitted", "changes_requested")]: {
    permission: "product.review",
    vendorMay: false,
    label: "Request changes",
    requiresReason: true,
  },
  [productEdge("internal_review", "changes_requested")]: {
    permission: "product.review",
    vendorMay: false,
    label: "Request changes",
    requiresReason: true,
  },

  /* ── the pipeline that already existed, now written down ── */

  [productEdge("draft", "internal_review")]: {
    permission: "product.update",
    vendorMay: false,
    label: "Send to review",
  },
  [productEdge("internal_review", "ready")]: {
    permission: "product.update",
    vendorMay: false,
    label: "Mark ready",
  },
  [productEdge("internal_review", "draft")]: {
    permission: "product.update",
    vendorMay: false,
    label: "Back to draft",
  },
  [productEdge("ready", "internal_review")]: {
    permission: "product.update",
    vendorMay: false,
    label: "Back to review",
  },
  [productEdge("ready", "published")]: {
    permission: "product.publish",
    vendorMay: false,
    label: "Publish",
  },
  [productEdge("published", "deprecated")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Deprecate",
  },
  [productEdge("deprecated", "published")]: {
    permission: "product.publish",
    vendorMay: false,
    label: "Republish",
  },

  /* ── archiving, from everywhere ── */

  [productEdge("draft", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("submitted", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("changes_requested", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("internal_review", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("ready", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("published", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
  [productEdge("deprecated", "archived")]: {
    permission: "product.unpublish",
    vendorMay: false,
    label: "Archive",
  },
};

export function productTransitionRule(
  from: ProductStatus,
  to: ProductStatus,
): ProductTransitionRule | undefined {
  return PRODUCT_TRANSITION_RULES[productEdge(from, to)];
}

/**
 * Every permission that could govern *any* edge into `to`.
 *
 * ## Why an action needs this rather than the exact rule
 *
 * The precise rule is keyed by `(from, to)`, and an action does not know `from` without
 * reading the product — while the guard has to run before the work. So the action
 * guards on "holds a permission that could govern this target" and the service, which
 * has the document, enforces the exact rule.
 *
 * That is exactly as coarse as the ad-hoc ternary this replaces, and the improvement is
 * that it is **derived**. The ternary read `to === "published" ? "product.publish" : …`
 * in two separate files, so adding an edge meant remembering both; a rule added to the
 * map now widens this automatically.
 *
 * Returns `[]` when no edge into `to` has a staff route — `submitted` is the case, and
 * an empty list means `requireAnyPermission([])` refuses everybody, which is correct:
 * nobody submits on a vendor's behalf.
 */
export function productPermissionsForTarget(to: ProductStatus): Permission[] {
  const suffix = `->${to}`;
  const permissions = new Set<Permission>();

  for (const [key, rule] of Object.entries(PRODUCT_TRANSITION_RULES)) {
    if (!key.endsWith(suffix)) continue;
    if (rule.permission) permissions.add(rule.permission);
  }

  return [...permissions];
}

/**
 * A paid plugin's handover — vendor-directed, delivered off-platform.
 *
 * One-way on purpose. `provided` is terminal because the key has left the
 * building: a status that could go back to `pending` would claim an obligation
 * is outstanding when the customer already has what they paid for. A mistake is
 * corrected by saying so in the thread, not by rewinding the record.
 *
 * `cancelled` exists for the refund path, which reaches it from `pending` only —
 * refunding a plugin already handed over is a conversation, not a state change.
 */
export const ADDON_PROVISIONING_TRANSITIONS: TransitionMap<AddonProvisioningStatus> = {
  pending: ["provided", "cancelled"],
  provided: [],
  cancelled: [],
};

/** Registry so tooling (docs, tests, the staff UI) can enumerate every machine. */
export const STATE_MACHINES = {
  product: PRODUCT_TRANSITIONS,
  productVersion: PRODUCT_VERSION_TRANSITIONS,
  order: ORDER_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  request: REQUEST_TRANSITIONS,
  quote: QUOTE_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  vendor: VENDOR_TRANSITIONS,
  payout: PAYOUT_TRANSITIONS,
  addonProvisioning: ADDON_PROVISIONING_TRANSITIONS,
} as const;

export type StateMachineName = keyof typeof STATE_MACHINES;
