import "server-only";
import type { NotificationCategory } from "@/lib/db/enums";
import type { DomainEventMap, DomainEventName } from "@/lib/events";

/**
 * §69's event → notification table, as data.
 *
 * ## Why a table rather than a handler per event
 *
 * The ticket's criterion is "every event in the table produces the listed
 * notifications". A table in code can be *compared* to the table in the ticket,
 * and a test can iterate it. Fifteen bespoke handlers can only be read one at a
 * time, and the row somebody forgot looks exactly like a row that does not
 * exist.
 *
 * It also means adding a channel, a category or a recipient rule touches one
 * module — which is the whole point of §69 being centralised.
 *
 * ## Audiences, not recipients
 *
 * A row says *who cares*, not *which user id*. Resolving an audience needs the
 * database (org members, the assignee, entitled owners) and belongs in
 * `recipients.ts`; keeping it out of here is what lets this file stay readable
 * beside the spec.
 */

export type Audience =
  /** Everyone in the organisation the event belongs to, filtered by role. */
  | { kind: "organization"; roles?: readonly string[] }
  /** The one customer who did the thing, or whose thing it is. */
  | { kind: "customer_owner" }
  /** The staff member the request is assigned to, if there is one. */
  | { kind: "assignee" }
  /** Every staff member holding a permission — the queue audience. */
  | { kind: "staff"; permission: string }
  /** Owners of an active entitlement for the product (§69's update notice). */
  | { kind: "entitled_owners" }
  /** The other side of a conversation — see `messaging`. */
  | { kind: "message_counterpart" };

export interface NotificationRule<K extends DomainEventName = DomainEventName> {
  audience: Audience;
  category: NotificationCategory;
  /**
   * Not opt-outable. §69: payment receipts, licence delivery and security
   * notices go out whatever the preferences say, and the UI says so.
   */
  essential?: boolean;
  /** Short, specific, and never containing anything internal (§37). */
  title: (payload: DomainEventMap[K]) => string;
  body?: (payload: DomainEventMap[K]) => string;
  /** Deep link to the record itself, per audience — §69. */
  href: (payload: DomainEventMap[K]) => string;
}

type Catalog = { [K in DomainEventName]?: NotificationRule<K>[] };

/**
 * One entry per row of §69's table.
 *
 * Staff hrefs point into `/staff`, customer hrefs into `/dashboard`. That
 * split is why a row carries its own `href` rather than the event doing so:
 * the same event sends two people to two different screens.
 */
export const CATALOG: Catalog = {
  RequestSubmitted: [
    {
      audience: { kind: "customer_owner" },
      category: "requests",
      title: (p) => `We've got your request ${p.reference}`,
      body: () => "We'll come back to you once somebody has looked at it.",
      href: (p) => `/dashboard/requests/${p.reference}`,
    },
    {
      audience: { kind: "staff", permission: "request.view_all" },
      category: "requests",
      title: (p) => `New ${p.kind.replace(/_/g, " ")} — ${p.reference}`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  CustomizationSubmitted: [
    {
      audience: { kind: "customer_owner" },
      category: "requests",
      title: (p) => `We've got your customization request ${p.reference}`,
      href: (p) => `/dashboard/requests/${p.reference}`,
    },
    {
      audience: { kind: "staff", permission: "request.view_all" },
      category: "requests",
      title: (p) => `New customization — ${p.reference}`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  RequestAssigned: [
    {
      audience: { kind: "assignee" },
      category: "requests",
      title: (p) => `${p.reference} is yours`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  CustomerActionRequested: [
    {
      audience: { kind: "organization" },
      category: "requests",
      title: (p) => `${p.reference} needs you`,
      // The note is staff-written and customer-facing by construction —
      // `internalNote` is a different field and never reaches here (§37).
      ...(true ? { body: (p: DomainEventMap["CustomerActionRequested"]) => p.note ?? "" } : {}),
      href: (p) => `/dashboard/requests/${p.reference}`,
    },
  ],

  QuoteIssued: [
    {
      audience: { kind: "organization" },
      category: "quotes",
      title: (p) => `Your quote ${p.reference} is ready`,
      body: () => "Have a read, then accept it or tell us what to change.",
      href: (p) => `/dashboard/quotes/${p.quoteId}`,
    },
  ],

  QuoteAccepted: [
    {
      audience: { kind: "organization" },
      category: "quotes",
      title: (p) => `You accepted quote ${p.reference}`,
      body: () => "We'll raise the invoice and get the work scheduled.",
      href: (p) => `/dashboard/quotes/${p.quoteId}`,
    },
    {
      audience: { kind: "staff", permission: "quote.view_all" },
      category: "quotes",
      title: (p) => `${p.reference} accepted`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  QuoteRejected: [
    {
      audience: { kind: "staff", permission: "quote.view_all" },
      category: "quotes",
      title: (p) => `${p.reference} was declined`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  /*
   * Billing rows are `essential`. A customer who muted billing email still has
   * to be told what they owe and when a payment landed — muting a receipt is
   * not a preference anybody means to express, and in several jurisdictions an
   * invoice notice is not marketing to opt out of.
   */
  InvoiceIssued: [
    {
      audience: { kind: "organization", roles: ["owner", "admin", "billing"] },
      category: "billing",
      essential: true,
      title: (p) => `Invoice ${p.reference} is ready to pay`,
      href: (p) => `/dashboard/invoices/${p.invoiceId}`,
    },
  ],

  InvoicePaid: [
    {
      audience: { kind: "organization", roles: ["owner", "admin", "billing"] },
      category: "billing",
      essential: true,
      title: (p) => `Payment received for ${p.reference}`,
      body: () => "Thank you — nothing more to do.",
      href: (p) => `/dashboard/invoices/${p.invoiceId}`,
    },
    {
      audience: { kind: "staff", permission: "invoice.view_all" },
      category: "billing",
      title: (p) => `${p.reference} paid in full`,
      href: (p) => `/staff/invoices/${p.invoiceId}`,
    },
  ],

  /*
   * §68's dunning, emitted by ticket 25's daily sweeps.
   *
   * `essential`, like the rest of billing — but note what is *not* here: no
   * staff row on `InvoiceDueSoon`. A reminder that an invoice is due in three
   * days is news to the customer and noise to the finance team, who have
   * `/staff/invoices` sorted by due date. Overdue is different, because by then
   * somebody has to chase it.
   */
  InvoiceDueSoon: [
    {
      audience: { kind: "organization", roles: ["owner", "admin", "billing"] },
      category: "billing",
      essential: true,
      title: (p) =>
        p.daysUntilDue === 0
          ? `Invoice ${p.reference} is due today`
          : `Invoice ${p.reference} is due in ${p.daysUntilDue} day${p.daysUntilDue === 1 ? "" : "s"}`,
      href: (p) => `/dashboard/invoices/${p.invoiceId}`,
    },
  ],

  InvoiceOverdue: [
    {
      audience: { kind: "organization", roles: ["owner", "admin", "billing"] },
      category: "billing",
      essential: true,
      title: (p) => `Invoice ${p.reference} is overdue`,
      body: () => "If you have already paid, ignore this — payments can take a day to land.",
      href: (p) => `/dashboard/invoices/${p.invoiceId}`,
    },
    {
      audience: { kind: "staff", permission: "invoice.view_all" },
      category: "billing",
      title: (p) =>
        `${p.reference} is ${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue`,
      href: (p) => `/staff/invoices/${p.invoiceId}`,
    },
  ],

  FollowUpDue: [
    {
      // The person who set the reminder, and nobody else. A follow-up is a
      // private note-to-self, not a queue item — §39.
      audience: { kind: "assignee" },
      category: "requests",
      title: (p) => (p.daysOverdue > 0 ? `Overdue: ${p.title}` : `Due today: ${p.title}`),
      href: (p) => p.href,
    },
  ],

  WorkReadyToStart: [
    {
      audience: { kind: "staff", permission: "request.view_all" },
      category: "requests",
      title: (p) => `${p.reference} is paid and ready to start`,
      href: (p) => `/staff/requests/${p.reference}`,
    },
  ],

  MessagePosted: [
    {
      audience: { kind: "message_counterpart" },
      category: "messages",
      title: (p) => `New message on ${p.subjectReference}`,
      href: (p) =>
        p.audience === "customer"
          ? `/dashboard/requests/${p.subjectReference}`
          : `/staff/requests/${p.subjectReference}`,
    },
  ],

  ProductVersionReleased: [
    {
      audience: { kind: "entitled_owners" },
      category: "products",
      title: (p) => `${p.productName} ${p.version} is available`,
      body: () => "You can download it from My Software.",
      href: () => `/dashboard/software`,
    },
  ],
};

/** The rows for one event, typed. Empty when §69 lists nothing for it. */
export function rulesFor<K extends DomainEventName>(event: K): NotificationRule<K>[] {
  return (CATALOG[event] ?? []) as NotificationRule<K>[];
}
