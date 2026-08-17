import { cn } from "@/lib/utils";
import {
  ENTITLEMENT_STATUSES,
  TESTING_CHECKLIST_STATUSES,
  FILE_SCAN_STATUSES,
  FOLLOW_UP_STATUSES,
  INVOICE_STATUSES,
  LICENCE_STATUSES,
  MEMBER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_VERSION_STATUSES,
  QUOTE_STATUSES,
  REQUEST_STATUSES,
  VENDOR_INVITATION_STATUSES,
  VENDOR_STATUSES,
  VENDOR_VERIFICATION_STATUSES,
} from "@/lib/db/enums";

/**
 * Status pills — one colour vocabulary for every state machine in the product.
 *
 * The map below is keyed by the **enum value itself**, and
 * `assertEveryStatusHasATone()` walks every status enum from ticket 02 to prove
 * nothing is missing. A unit test calls it, so adding a state to a machine
 * without deciding how it looks fails the gate rather than rendering as
 * unstyled grey.
 *
 * That coupling is the point of the component. Without it, "cancelled" ends up
 * red on the orders screen and grey on the requests screen, and a customer
 * learns that colour means nothing.
 *
 * ## The tones
 *
 * Six, deliberately few. Colour here carries one signal — *what should I do
 * about this?* — not a decorative label per state.
 *
 * - `neutral`   nothing is happening and nothing is wrong (draft, pending)
 * - `progress`  we are working on it; the customer waits
 * - `attention` the customer must act — this is the only tone that uses the
 *               brand's signal colour, so §102's "needs your attention" reads
 *               at a glance and never competes with decoration
 * - `positive`  settled, paid, live
 * - `negative`  failed, rejected, revoked — something went wrong
 * - `muted`     over and no longer interesting (archived, superseded)
 */

export type StatusTone =
  "neutral" | "progress" | "attention" | "positive" | "negative" | "muted";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface-muted text-muted-foreground border-border",
  progress: "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300",
  attention: "bg-signal-soft text-signal-text border-signal/25",
  positive: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300",
  negative: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300",
  muted: "bg-transparent text-subtle border-border",
};

/**
 * Status → tone. Values shared across machines ("draft", "cancelled") mean the
 * same thing everywhere, which is why one map covers all of them.
 */
const STATUS_TONES: Record<string, StatusTone> = {
  /* shared lifecycle */
  draft: "neutral",
  pending: "neutral",
  archived: "muted",
  deprecated: "muted",
  superseded: "muted",
  expired: "muted",
  cancelled: "negative",
  canceled: "negative",
  rejected: "negative",
  failed: "negative",
  revoked: "negative",
  infected: "negative",
  suspended: "negative",
  overdue: "negative",

  /* catalogue */
  internal_review: "progress",
  testing: "progress",
  ready: "progress",
  published: "positive",
  released: "positive",
  clean: "positive",

  /* membership */
  invited: "attention",
  active: "positive",

  /* orders & money */
  awaiting_payment: "attention",
  paid: "positive",
  partially_paid: "progress",
  fulfilled: "positive",
  refunded: "muted",
  succeeded: "positive",
  requires_review: "attention",
  issued: "progress",

  /* quotes */
  accepted: "positive",

  /* §47 internal testing checklist. `na` is muted rather than positive: it is
     "doesn't apply", not "verified", and the two should not look alike. */
  pass: "positive",
  fail: "negative",
  na: "muted",

  /* requests */
  submitted: "progress",
  under_review: "progress",
  waiting_for_customer: "attention",
  technical_review: "progress",
  quoted: "attention",
  approved: "positive",
  converted: "positive",
  // Work under way reads as progress; delivered is the customer's move, so it
  // takes the same tone as anything else waiting on them.
  in_progress: "progress",
  delivered: "attention",
  completed: "positive",

  /* follow-ups */
  open: "attention",
  done: "positive",

  /* vendors. `applied` is neutral and `in_review` is progress, mirroring
     draft/internal_review — nothing is wrong with an application nobody has
     picked up yet. `offboarded` is muted rather than negative: a vendor may
     leave amicably, and the customers who bought from them keep everything. */
  applied: "neutral",
  in_review: "progress",
  verified: "positive",
  offboarded: "muted",
  unstarted: "neutral",
};

/**
 * Machine-readable value → the words a customer reads.
 *
 * Defaults to de-snake-casing, so this only holds the cases where that reads
 * badly or says the wrong thing. `waiting_for_customer` is the important one:
 * to staff it means "we're blocked", to a customer it must read as a request.
 */
const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  waiting_for_customer: "Needs your input",
  internal_review: "In review",
  technical_review: "Technical review",
  partially_paid: "Part paid",
  requires_review: "Under review",
  canceled: "Cancelled",
  na: "Not applicable",
  pass: "Passed",
  fail: "Failed",
  in_review: "In review",
  unstarted: "Not started",
};

export function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? "neutral";
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** Override only when context demands it; prefer fixing `STATUS_LABELS`. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium whitespace-nowrap",
        TONE_CLASSES[statusTone(status)],
        className,
      )}
    >
      {label ?? statusLabel(status)}
    </span>
  );
}

/* ────────────────────────────────────────────── invariant */

/** Every status enum in the domain model. Extend when a machine is added. */
const ALL_STATUS_ENUMS: ReadonlyArray<readonly string[]> = [
  MEMBER_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_VERSION_STATUSES,
  FILE_SCAN_STATUSES,
  LICENCE_STATUSES,
  ENTITLEMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REQUEST_STATUSES,
  FOLLOW_UP_STATUSES,
  QUOTE_STATUSES,
  INVOICE_STATUSES,
  TESTING_CHECKLIST_STATUSES,
  VENDOR_STATUSES,
  VENDOR_INVITATION_STATUSES,
  VENDOR_VERIFICATION_STATUSES,
];

/**
 * Called by a unit test. Without it a new state renders as neutral grey and
 * nobody notices until a customer asks why their order looks like a draft.
 */
export function assertEveryStatusHasATone(): void {
  const missing = new Set<string>();
  for (const machine of ALL_STATUS_ENUMS) {
    for (const status of machine) {
      if (!(status in STATUS_TONES)) missing.add(status);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `StatusBadge has no tone for: ${[...missing].sort().join(", ")}. ` +
        `Decide how each new state should read before shipping it.`,
    );
  }
}
