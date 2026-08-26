import "server-only";
import type { NotificationCategory } from "@/lib/db/enums";
import type { DomainEventMap, DomainEventName } from "@/lib/events";
import type { EmailContent } from "@/emails/layout";
import { BRAND } from "@/config/brand";

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
  /**
   * Every active member of one vendor — vendor tickets 01 and 05.
   *
   * For most vendors that is one person, and it resolves the same either way. A
   * *query*, never a claim in the payload: the payload carries a `vendorId`, and
   * `resolveAudience` looks up who that means.
   */
  | { kind: "vendor_member" }
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
  /**
   * A written email for this rule, instead of the generic one.
   *
   * Every rule without this gets `notificationEmail` — a heading, the body, and
   * an "Open in CoSetup" button — which is right for a notification: it is a
   * nudge towards a screen, and forty bespoke templates for forty nudges is a
   * maintenance burden with no reader benefit.
   *
   * A few messages are not nudges. "Your application is in, here is what happens
   * next" is the first thing a new vendor hears from us and it has to carry the
   * next step, not a link to go and find it. Those rules write their own, and
   * the in-app row still comes from `title`/`body` above — one event, two
   * renderings, each suited to where it lands.
   *
   * The `url` is passed in already absolute so a template never has to know how
   * to build one.
   */
  email?: (payload: DomainEventMap[K], context: { url: string }) => WrittenEmail;
}

/** An `EmailContent` with the subject line the generic renderer would derive. */
export type WrittenEmail = EmailContent & { subject: string };

type Catalog = { [K in DomainEventName]?: NotificationRule<K>[] };

/** The vendor's word for a level, not the enum's. */
function levelName(level: "identity" | "business"): string {
  return level === "identity" ? "Identity" : "Payout details";
}

/** What an approval actually buys, since "approved" on its own says nothing. */
function unlocked(level: "identity" | "business", outcome: string): string {
  if (outcome !== "approved") return "";
  return level === "identity"
    ? "You can list a product now — that is what this check unlocks."
    : "We can pay you now. Anything already in your balance goes out on the next payout run.";
}

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

  /*
   * The point of the whole progress-update mechanism. An update the customer is
   * not told about is a note in a file — they would have to keep reopening the
   * request on the chance something had changed, which is exactly the silence
   * this set out to fix.
   */
  RequestProgressPosted: [
    {
      audience: { kind: "organization" },
      category: "requests",
      title: (p) => `Update on ${p.reference}`,
      body: (p) => p.message,
      href: (p) => `/dashboard/requests/${p.reference}`,
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
      body: () => "You can download it from My Scripts.",
      href: () => `/dashboard/software`,
    },
  ],

  /* ── vendor tickets 01–03 ── */

  /*
   * Two audiences, and the vendor's own row is the one that was missing.
   *
   * An applicant used to get nothing at all — the only rule here notified staff,
   * so the person who had just filled in a form and accepted an agreement got
   * silence and a dashboard they had to remember to revisit. `dispatch` fans out
   * to every rule for an event, so adding the row is the whole change: the
   * in-app notification and the email both follow.
   *
   * The body is a next step, not a receipt. Identity verification is what
   * unlocks listing, it can be done while the application is read, and this
   * email is the moment the applicant is most likely to act on it.
   */
  VendorApplied: [
    {
      audience: { kind: "staff", permission: "vendor.review" },
      category: "products",
      title: (p) => `${p.displayName} applied to sell`,
      body: (p) => `From ${p.country}. Somebody needs to read it.`,
      href: () => `/staff/vendor-applications`,
      /*
       * Staff already received this — the generic renderer has covered it since
       * ticket 25, and `enabledChannels` defaults email on for anybody who has
       * never touched their preferences. What it did not do is put the applicant
       * in the subject line, so a reviewer scanning an inbox saw "Products: …"
       * and had to open it to learn who applied.
       *
       * Named here instead. The queue link is the action; there is deliberately
       * nothing about the application itself beyond the name and the country,
       * because everything else is behind the permission and an email is not.
       */
      email: (p, { url }) => ({
        subject: `New vendor application — ${p.displayName}`,
        preheader: `A vendor in ${p.country} is waiting for a review.`,
        heading: `${p.displayName} applied to sell`,
        body: [
          `An application from ${p.country} is in the queue and has not been picked up yet.`,
          "Their identity documents may arrive separately — verification runs alongside the application, so the two do not land together.",
        ],
        action: { label: "Open the queue", url, showUrl: false },
      }),
    },
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) => `${p.displayName} — your application is in`,
      body: () => "Next: verify your identity, which is what lets you list a product.",
      href: () => `/dashboard/selling/verification`,
      /*
       * The one email a vendor gets before they are a vendor.
       *
       * It is written out rather than left to the generic renderer because the
       * generic one is a nudge — a title, a sentence, a button — and this has to
       * do three things a nudge cannot: thank somebody for a decision they made,
       * set an expectation about what happens on our side, and hand them the
       * next action with enough detail to go and do it.
       *
       * `notes` carries the two documents by name. Somebody reading this on a
       * phone in the evening can go and find their passport without opening the
       * app first, which is the entire point of sending it.
       */
      email: (p, { url }) => ({
        subject: `Thanks for applying to sell on ${BRAND.name}`,
        preheader: `Your next step: verify your identity, and you can list as soon as you are approved.`,
        heading: "Thanks for showing interest",
        body: [
          `We have your application for ${p.displayName}, and somebody reads every one of them properly — you will hear from us either way.`,
          "You do not have to wait for that. Verifying your identity is a separate check, it runs alongside the application, and it is the step that unlocks listing a product. Getting it in now means there is nothing left to do on the day you are approved.",
        ],
        // No raw-URL well: the link carries no token, so a mangled button costs a
        // sign-in rather than the message. Same rule as every other
        // notification email — see `EmailAction.showUrl`.
        action: { label: "Verify my identity", url, showUrl: false },
        notes: [
          "You will need a passport, driving licence or national ID card, and something showing your address from the last three months — a bank statement, a utility bill or a council tax letter.",
          "Being paid needs one more check after that, and you can sell before it finishes: earnings wait in your balance until it clears.",
        ],
      }),
    },
  ],

  /*
   * A level decided — vendor ticket 02, revisited.
   *
   * The vendor was told nothing at all when a reviewer approved or rejected one:
   * `decideVerification` wrote the audit row and emitted no event, so the only
   * way to find out was to go and look. For a rejection that is worse than
   * silence, because the reviewer's note — which the service *refuses a rejection
   * without* — was written for the vendor and then never delivered to them.
   *
   * One rule for both outcomes rather than two. The audiences, the category and
   * the link are identical, and splitting them would put the two halves of one
   * decision in two places where they could drift apart.
   */
  VendorVerificationDecided: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) =>
        p.outcome === "approved"
          ? `${levelName(p.level)} approved`
          : `${levelName(p.level)} needs another look`,
      body: (p) => p.note ?? unlocked(p.level, p.outcome),
      href: () => `/dashboard/selling/verification`,
      /*
       * Written out because a rejection has to carry the reviewer's note in full,
       * and the generic renderer truncates a notification body into one
       * paragraph under a heading. A vendor reading "we need a clearer photo of
       * the second page" has everything they need to fix it without signing in.
       */
      email: (p, { url }) => ({
        subject:
          p.outcome === "approved"
            ? `${levelName(p.level)} approved — ${p.displayName}`
            : `${levelName(p.level)}: we need something else — ${p.displayName}`,
        preheader:
          p.outcome === "approved"
            ? unlocked(p.level, "approved")
            : "Here is what to send, and where to send it.",
        heading:
          p.outcome === "approved"
            ? `${levelName(p.level)} approved`
            : `${levelName(p.level)} needs another look`,
        body:
          p.outcome === "approved"
            ? [
                `Somebody has checked the documents you sent for ${p.displayName}, and they are fine.`,
                unlocked(p.level, "approved"),
                ...(p.note ? [p.note] : []),
              ]
            : [
                `Somebody has checked the documents you sent for ${p.displayName} and needs something more before this can be approved. Here is what they said:`,
                // The reviewer's own words, unedited. Paraphrasing them here
                // would produce two versions of one decision.
                p.note ?? "No reason was recorded — please get in touch and we will explain.",
                "Nothing else about your account changes, and you can send a replacement straight away.",
              ],
        action: {
          label: p.outcome === "approved" ? "See your verification" : "Send what is needed",
          url,
          showUrl: false,
        },
        notes:
          p.outcome === "approved"
            ? []
            : ["Replacing a document does not start the whole application again."],
      }),
    },
  ],

  /*
   * Vendor ticket 14. **Everything a mediated boundary can get wrong is in a notification.**
   *
   * A title naming the customer, a body quoting their message, an href to a staff screen — each of
   * them would undo the whole design, and an email is the one place the leak leaves the building.
   * So the payload has no customer field to accidentally interpolate (see
   * `CustomizationRoutedToVendor` in `events/index.ts`), the title names the *product*, and the href
   * is the brief.
   */
  CustomizationRoutedToVendor: [
    {
      audience: { kind: "vendor_member" },
      category: "requests",
      title: (p) => `A customer wants changes to ${p.productName}`,
      body: () =>
        "We have passed on what they asked for. Take a look and tell us what it would cost.",
      href: (p) => `/dashboard/selling/requests/${p.briefId}`,
    },
  ],

  VendorBriefAnswered: [
    {
      audience: { kind: "staff", permission: "request.view_all" },
      category: "requests",
      title: (p) => `${p.productName} — the vendor has priced it`,
      href: (p) => `/staff/requests/${p.requestId}`,
    },
  ],

  VendorBriefDeclined: [
    {
      audience: { kind: "staff", permission: "request.view_all" },
      category: "requests",
      title: (p) => `${p.productName} — the vendor declined`,
      // Verbatim, and the reason `decline()` refuses without one: "no capacity until March" and
      // "that would break every other install" need entirely different things said to the customer.
      body: (p) => p.reason,
      href: (p) => `/staff/requests/${p.requestId}`,
    },
  ],

  VendorVerified: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: () => "You can start listing",
      body: () =>
        "Your vendor account is verified. Create your first product whenever you are ready.",
      href: () => `/dashboard/selling/products`,
    },
  ],

  VendorRejected: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: () => "We can't take your application forward",
      // The reason verbatim — it is the only useful thing this notification carries,
      // and it is why `transition` refuses a rejection without one.
      body: (p) => p.reason,
      href: () => `/dashboard/selling`,
    },
  ],

  VendorSuspended: [
    {
      audience: { kind: "vendor_member" },
      category: "security",
      title: () => "Your vendor account is suspended",
      // Says what survives, because the first question is "what happens to my
      // customers" and the answer is "nothing" (vendor ticket 12).
      body: (p) =>
        `${p.reason} New sales are paused. Customers who already bought from you keep their software and their downloads.`,
      href: () => `/dashboard/selling`,
    },
  ],

  /* ── vendor ticket 13 ── */

  VendorSupportThreadOpened: [
    {
      audience: { kind: "vendor_member" },
      category: "messages",
      title: (p) => `A question about ${p.productName}`,
      body: () =>
        "You answer this one first — we are watching the thread rather than running it.",
      href: () => `/dashboard/selling/support`,
    },
  ],

  DisputeRaised: [
    {
      audience: { kind: "staff", permission: "vendor.review" },
      category: "messages",
      title: (p) => `Dispute raised by the ${p.raisedBy}`,
      body: (p) => `Reason given: ${p.reason.replace(/_/g, " ")}.`,
      href: () => `/staff/disputes`,
    },
    {
      // The vendor hears too, whichever side raised it. A dispute they learn about when the
      // outcome lands is one they will contest.
      audience: { kind: "vendor_member" },
      category: "messages",
      title: () => "A dispute has been opened on one of your threads",
      body: () =>
        "CoSetup will decide it. Add anything you want considered to the conversation — it " +
        "is read before a decision is made.",
      href: () => `/dashboard/selling/support`,
    },
  ],

  DisputeResolved: [
    {
      audience: { kind: "vendor_member" },
      category: "messages",
      title: () => "A dispute has been decided",
      // The reason verbatim. A paraphrase of somebody else's decision is how an outcome gets
      // re-argued.
      body: (p) => p.reason,
      href: () => `/dashboard/selling/support`,
    },
  ],

  /* ── vendor ticket 12 ── */

  VendorOffboarded: [
    {
      // Everybody holding an active entitlement to anything that vendor sold, once.
      audience: { kind: "entitled_owners" },
      category: "products",
      title: (p) => `${p.displayName} has left CoSetup`,
      /*
       * Says what **survives** first.
       *
       * The customer's question is "have I lost what I paid for", and the answer is no — so
       * that is the first clause rather than a reassurance at the end. Silence here is how a
       * customer discovers it by needing help, which is the worst moment.
       */
      body: () =>
        "Everything you bought from them is still yours: your licence stays valid and your " +
        "downloads keep working. Support for those products is now handled by CoSetup.",
      href: () => `/dashboard/software`,
    },
  ],

  ProductEmergencyDelisted: [
    {
      audience: { kind: "staff", permission: "product.publish" },
      category: "security",
      title: (p) => `${p.productName} was pulled from sale`,
      body: (p) => p.reason,
      href: () => `/admin/products`,
    },
  ],

  /* ── vendor ticket 10 ── */

  ProductReviewPublished: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) => `${p.rating}★ review of ${p.productName}`,
      // Says what to do about it, because the useful reply is often to a *good* review and a
      // vendor who only hears about the bad ones learns to dread this notification.
      body: () =>
        "You can reply publicly. A vendor's answer is often more useful to the next buyer " +
        "than the review itself.",
      href: () => `/dashboard/selling/reviews`,
    },
  ],

  ProductReviewFlagged: [
    {
      // The queue audience — every staff member holding the permission. No vendor hears
      // about this, deliberately: a seller told which reviews were reported learns which of
      // their customers complained.
      audience: { kind: "staff", permission: "review.moderate" },
      category: "products",
      title: () => "A review needs a look",
      body: (p) => `It has been reported ${p.reportCount} times.`,
      href: () => `/staff/reviews`,
    },
  ],

  /* ── vendor ticket 09 ── */

  VendorPayoutPaid: [
    {
      audience: { kind: "vendor_member" },
      // `billing`, like an invoice: it is money moving, and a vendor who mutes product
      // notifications must still hear about a payment.
      category: "billing",
      title: (p) => `We've paid you ${p.reference}`,
      // The reference, because that is what they will match against their bank statement.
      // The amount is on the statement the link leads to, rendered through `<MoneyDisplay>`
      // rather than assembled from a number and a currency code in a string.
      body: (p) =>
        `Payout ${p.reference} has been sent. Quote that reference if you need to ask us ` +
        `about it.`,
      href: (p) => `/dashboard/selling/payouts/${p.reference}`,
    },
  ],

  VendorPayoutFailed: [
    {
      audience: { kind: "vendor_member" },
      category: "billing",
      title: () => "A payout to you didn't go through",
      // The likeliest cause is their own account details, and they are the only person who
      // can fix that — so the notification says where to look rather than only what failed.
      body: (p) =>
        `${p.reason} Check your payout account details; we will try again on the next run.`,
      href: () => `/dashboard/selling/settings`,
    },
  ],

  /* ── vendor ticket 05 ── */

  ProductSubmitted: [
    {
      // By permission, not by role name, so a new staff role that can review is not
      // silently left out of the queue's notifications.
      audience: { kind: "staff", permission: "product.review" },
      category: "products",
      title: (p) =>
        p.isResubmission
          ? `${p.vendorName} resubmitted ${p.productName}`
          : `${p.vendorName} submitted ${p.productName}`,
      body: (p) =>
        p.isResubmission
          ? "A resubmission — the review shows what changed since it was last approved."
          : "Waiting for a reviewer.",
      href: () => `/staff/vendor-submissions`,
    },
  ],

  ProductChangesRequested: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) => `${p.productName} needs changes before it can go on sale`,
      // The reviewer's words, verbatim — this is the whole point of the reason being
      // required. Truncated because a notification body is a summary, and the full
      // note is on the product where it belongs.
      body: (p) => (p.detail.length > 200 ? `${p.detail.slice(0, 197)}…` : p.detail),
      href: (p) => `/dashboard/selling/products/${p.productId}/review`,
    },
  ],

  ProductApproved: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) => `${p.productName} passed review`,
      // Careful wording: approved is not on sale. Saying "it's live" here and then
      // having it sit in testing for a week is how a vendor stops trusting us.
      body: () =>
        "It has gone into our own testing and readiness checks. We will tell you when it is on sale.",
      href: (p) => `/dashboard/selling/products/${p.productId}/review`,
    },
  ],

  /*
   * A paid plugin was bought and somebody owes the customer a key.
   *
   * Two rows, because there are two possible providers and they are reached
   * differently: the vendor whose product it is, or — when there is no vendor —
   * the staff who look after orders. `resolveAudience` returns nobody for a
   * `vendor_member` audience with no `vendorId`, so the staff row is what makes a
   * first-party plugin visible rather than silently unowned.
   */
  AddonProvisioningRequested: [
    {
      audience: { kind: "vendor_member" },
      category: "billing",
      title: (p) => `${p.addonName} was bought and needs handing over`,
      body: (p) =>
        `A customer bought ${p.addonName} with ${p.productName}. Send them what it needs — a key, a licence code, an account — and mark it provided.`,
      href: () => "/dashboard/selling/plugins",
    },
    {
      audience: { kind: "staff", permission: "order.update_status" },
      category: "billing",
      title: (p) => `${p.addonName} on ${p.orderReference} needs handing over`,
      body: (p) => `Bought with ${p.productName}. Nothing is delivered until somebody does.`,
      href: (p) => `/admin/orders/${p.orderReference}`,
    },
  ],

  AddonProvisioned: [
    {
      audience: { kind: "organization" },
      category: "billing",
      title: (p) => `${p.addonName} is ready`,
      // Not the key itself, and not a promise about where it is: the thread is
      // linked, and the thread is the only place it exists.
      body: () => "The details are in the messages on your order.",
      href: (p) => `/dashboard/orders/${p.orderReference}`,
    },
  ],

  ProductPublished: [
    {
      audience: { kind: "vendor_member" },
      category: "products",
      title: (p) => `${p.productName} is on sale`,
      body: () => "Customers can buy it now.",
      href: (p) => `/marketplace/${p.productSlug}`,
    },
  ],

  /* ── account security ──────────────────────────────────────────────────
   *
   * The audience is `customer_owner`, resolved from `context.ownerUserId` — the
   * account holder and nobody else. Not `organization`: a colleague has no
   * business being told that somebody rotated their own password.
   *
   * All four are `essential` as well as being in the `security` category. The
   * category alone would be enough today, but the flag is what a reader of this
   * file sees, and it survives somebody deciding `security` should be optional.
   *
   * Each one writes its own email rather than falling back to the generic
   * notification template, because the generic one ends with "change what we
   * email you about in your notification settings" and that is precisely the
   * wrong footnote here — these cannot be turned off, and the sentence that
   * matters is "if this wasn't you, act now".
   */
  PasswordChanged: [
    {
      audience: { kind: "customer_owner" },
      category: "security",
      essential: true,
      title: () => "Your password was changed",
      body: () => "If that wasn't you, reset your password now and sign out everywhere.",
      href: () => "/dashboard/account/security",
      email: (_p, { url }) =>
        securityEmail({
          subject: "Your CoSetup password was changed",
          heading: "Your password was changed",
          detail:
            "This is a confirmation. Your existing sign-ins may have been ended as part of the change.",
          url,
        }),
    },
  ],

  PasswordSet: [
    {
      audience: { kind: "customer_owner" },
      category: "security",
      essential: true,
      title: () => "A password was added to your account",
      body: () => "You can now sign in with an email address and password as well.",
      href: () => "/dashboard/account/security",
      email: (_p, { url }) =>
        securityEmail({
          subject: "A password was added to your CoSetup account",
          heading: "A password was added to your account",
          detail:
            "Until now this account signed in with Google only. Both will work from here.",
          url,
        }),
    },
  ],

  SocialAccountLinked: [
    {
      audience: { kind: "customer_owner" },
      category: "security",
      essential: true,
      title: (p) => `${providerName(p.provider)} was connected to your account`,
      body: () => "It can now be used to sign in.",
      href: () => "/dashboard/account/security",
      email: (p, { url }) =>
        securityEmail({
          subject: `${providerName(p.provider)} was connected to your CoSetup account`,
          heading: `${providerName(p.provider)} was connected`,
          detail: `Signing in with ${providerName(p.provider)} will now reach this account.`,
          url,
        }),
    },
  ],

  SocialAccountUnlinked: [
    {
      audience: { kind: "customer_owner" },
      category: "security",
      essential: true,
      title: (p) => `${providerName(p.provider)} was disconnected from your account`,
      body: () => "It can no longer be used to sign in.",
      href: () => "/dashboard/account/security",
      email: (p, { url }) =>
        securityEmail({
          subject: `${providerName(p.provider)} was disconnected from your CoSetup account`,
          heading: `${providerName(p.provider)} was disconnected`,
          detail: `Signing in with ${providerName(p.provider)} will no longer reach this account.`,
          url,
        }),
    },
  ],
};

/**
 * The shared shape of an account-security email.
 *
 * One writer for four events, because they differ only in wording and the thing
 * that must not differ is the last line: what to do if it was not you. Written
 * out here rather than left to the generic template, whose footnote invites the
 * reader to change their notification settings — true of most categories and
 * wrong for this one.
 */
function securityEmail(input: {
  subject: string;
  heading: string;
  detail: string;
  url: string;
}): WrittenEmail {
  return {
    subject: input.subject,
    preheader: input.detail,
    greeting: "Hello,",
    heading: input.heading,
    body: [input.detail],
    action: { label: "Review your security settings", url: input.url, showUrl: true },
    notes: [
      "If you did not make this change, reset your password immediately and sign out of every device from your security settings.",
      "You receive this because it concerns your account security. These messages cannot be turned off.",
    ],
  };
}

/** `"google"` reads as machinery in a sentence; `"Google"` reads as a product. */
function providerName(provider: string): string {
  return provider === "google" ? "Google" : provider;
}

/** The rows for one event, typed. Empty when §69 lists nothing for it. */
export function rulesFor<K extends DomainEventName>(event: K): NotificationRule<K>[] {
  return (CATALOG[event] ?? []) as NotificationRule<K>[];
}
