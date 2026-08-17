import "server-only";

/**
 * Domain events — §92.
 *
 * ## In-process and synchronous, on purpose
 *
 * §92 says avoid distributed event infrastructure. So this is a map of arrays
 * and a `for` loop. Handlers do small things — write an activity row, create a
 * notification, enqueue a job — and anything slower is ticket 25's queue rather
 * than work done inline.
 *
 * ## A failing handler must not undo the thing that happened
 *
 * The explicit criterion: "event handlers failing (e.g. email down) do not roll
 * back the state transition." A request that moved to `under_review` **has**
 * moved; an email provider being down cannot un-move it.
 *
 * Two rules follow, and both are load-bearing:
 *
 *   1. **Dispatch happens after the transaction commits**, never inside it.
 *      Inside, a handler that throws aborts the transaction and the transition
 *      silently disappears.
 *   2. **Every handler is individually isolated.** One throwing handler must not
 *      stop the handlers after it, or the order handlers were registered in
 *      quietly becomes a priority list nobody wrote down.
 *
 * Failures are logged and swallowed. That is the right trade here — the
 * alternative is a customer's request being un-submitted because a notification
 * failed — but it does mean a broken handler is silent to the caller, which is
 * why it logs loudly.
 */

import type { RequestStatus } from "@/lib/db/enums";

export interface DomainEventMap {
  RequestSubmitted: {
    requestId: string;
    reference: string;
    organizationId: string;
    kind: string;
  };
  CustomizationSubmitted: {
    requestId: string;
    reference: string;
    organizationId: string;
    productId?: string;
  };
  RequestStatusChanged: {
    requestId: string;
    reference: string;
    organizationId: string;
    from: RequestStatus;
    to: RequestStatus;
    actorType: "customer" | "staff" | "system";
    actorId?: string;
  };
  RequestAssigned: {
    requestId: string;
    reference: string;
    organizationId: string;
    assigneeUserId: string;
    assignedByUserId?: string;
  };
  CustomerActionRequested: {
    requestId: string;
    reference: string;
    organizationId: string;
    note?: string;
  };
  RequirementsRevised: {
    requestId: string;
    reference: string;
    organizationId: string;
    version: number;
  };

  /* §92's quote events (ticket 22). */
  QuoteIssued: {
    quoteId: string;
    reference: string;
    organizationId: string;
    requestId: string;
    total: number;
    currency: string;
  };
  QuoteAccepted: {
    quoteId: string;
    reference: string;
    organizationId: string;
    requestId: string;
    /** The version they agreed to — acceptance is a contract event (§51). */
    version: number;
    total: number;
    currency: string;
  };
  QuoteRejected: {
    quoteId: string;
    reference: string;
    organizationId: string;
    requestId: string;
    version: number;
    total: number;
    currency: string;
  };

  /** Ticket 08. Fans out to everyone with an active entitlement (§69). */
  ProductVersionReleased: {
    productId: string;
    productName: string;
    versionId: string;
    version: string;
  };

  /** Ticket 23. The customer's "payment required" notice (§69). */
  InvoiceIssued: {
    invoiceId: string;
    reference: string;
    organizationId: string;
    portion: string;
    total: number;
    currency: string;
    dueAt?: string;
  };

  /**
   * Ticket 21. Carries the **audience**, not the body.
   *
   * §37: an internal note must never reach a customer, and a notification is a
   * place a body could leak to somebody who cannot open the thread. So the
   * payload says who may hear about it and where to look, and the message
   * itself stays behind the thread's own authorisation.
   */
  MessagePosted: {
    conversationId: string;
    messageId: string;
    organizationId: string;
    subjectType: string;
    subjectId: string;
    /** The human reference of the thing being discussed — for the title. */
    subjectReference: string;
    senderUserId: string;
    /** "customer" ⇒ both sides may hear; "internal" ⇒ staff only (§37). */
    audience: "customer" | "internal";
  };

  /**
   * §52's work-order seam (ticket 23).
   *
   * Emitted the moment an invoice is settled in full. Post-MVP ticket 53
   * (projects) subscribes to it; it exists now so "the customer has paid and
   * work can start" is a named event rather than something each caller infers
   * from an invoice status later.
   */
  InvoicePaid: {
    invoiceId: string;
    reference: string;
    organizationId: string;
    sourceType: string;
    sourceId: string;
    total: number;
    currency: string;
  };

  /**
   * §68's reminders, emitted by ticket 25's daily sweeps rather than by a
   * service — nothing *happens* to make an invoice due, which is exactly why
   * these three need a scheduler and the rest of the map does not.
   *
   * They are events all the same, so §69's catalogue stays the one place that
   * decides who hears about what. A sweep that composed its own email would be
   * the `sendEmail`-sprinkled-through-services shape ticket 24 exists to avoid.
   */
  InvoiceDueSoon: {
    invoiceId: string;
    reference: string;
    organizationId: string;
    daysUntilDue: number;
    outstanding: number;
    currency: string;
  };
  InvoiceOverdue: {
    invoiceId: string;
    reference: string;
    organizationId: string;
    daysOverdue: number;
    outstanding: number;
    currency: string;
  };
  FollowUpDue: {
    followUpId: string;
    ownerUserId: string;
    title: string;
    daysOverdue: number;
    /** Where the follow-up points, for the deep link. */
    href: string;
  };

  /**
   * The work order — §52, and the thing ticket 53 will subscribe to.
   *
   * Distinct from `InvoicePaid` on purpose. A deposit invoice being settled
   * means money arrived; it means *work can start* only because these are
   * deposit terms and this is the deposit. Collapsing the two would have a
   * balance payment on a finished job re-open the work.
   */
  WorkReadyToStart: {
    requestId: string;
    reference: string;
    organizationId: string;
    quoteId: string;
    invoiceId: string;
  };

  /**
   * Staff said something about progress, without the state changing.
   *
   * The event exists so the customer is *notified*. Before it, the only way to
   * tell somebody anything was to move the request between states — and past
   * `converted` there were none, so a job in flight was silent by construction.
   */
  RequestProgressPosted: {
    requestId: string;
    reference: string;
    organizationId: string;
    message: string;
  };
}

export type DomainEventName = keyof DomainEventMap;

export type Handler<K extends DomainEventName> = (
  payload: DomainEventMap[K],
) => void | Promise<void>;

type Registry = { [K in DomainEventName]?: Handler<K>[] };

declare global {
  var __innovatrixEventBus: Registry | undefined;
}

/**
 * Module-scope would be re-created on every hot reload in development, so
 * handlers registered at import time would pile up and fire five times.
 */
function registry(): Registry {
  return (globalThis.__innovatrixEventBus ??= {});
}

export function on<K extends DomainEventName>(event: K, handler: Handler<K>): void {
  const bus = registry();
  const handlers = (bus[event] ??= []) as Handler<K>[];
  // Idempotent by function identity, so a module imported twice does not
  // double-register — the same hot-reload hazard as above.
  if (!handlers.includes(handler)) handlers.push(handler);
}

/**
 * Fire. Never throws.
 *
 * Awaited so handlers that write to the database finish before the caller
 * returns — a request page rendered immediately after a transition should show
 * the activity row that transition produced, not race it.
 */
export async function emit<K extends DomainEventName>(
  event: K,
  payload: DomainEventMap[K],
): Promise<void> {
  const handlers = (registry()[event] ?? []) as Handler<K>[];

  for (const handler of handlers) {
    try {
      await handler(payload);
    } catch (error) {
      // Swallowed deliberately (see the note at the top), and logged loudly
      // because a silently broken handler is the cost of that decision.
      console.error(
        `[events] handler for ${event} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** Tests only — the bus is global, so a leaked handler crosses test files. */
export function resetBus(): void {
  globalThis.__innovatrixEventBus = {};
}
