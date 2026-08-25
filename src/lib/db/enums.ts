/**
 * Status enums — declared once, consumed by both Mongoose and Zod.
 *
 * Ticket 01 required these live in one module "shared with Zod validators so
 * the database and the API can't drift". Each is a `const` tuple, so:
 *   • Mongoose gets a runtime array for `enum:`
 *   • Zod gets the same array for `z.enum(...)`
 *   • TypeScript derives the union type
 * Adding a value in one place is impossible — there is only one place.
 *
 * This file is intentionally free of imports so it can be read from server
 * code, client components and validators alike.
 */

function values<const T extends readonly string[]>(list: T) {
  return list;
}

/* ────────────────────────────────────────────── identity */

export const ORGANIZATION_ROLES = values([
  "owner",
  "admin",
  "billing",
  "technical",
  "member",
] as const);
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** §77 — permissions, never a single admin flag. */
export const STAFF_ROLES = values([
  "super_admin",
  "customer_service",
  "sales",
  "technical_analyst",
  "developer",
  "project_manager",
  "support_agent",
  "marketplace_manager",
  "finance",
  "devops",
  "content_manager",
] as const);
export type StaffRole = (typeof STAFF_ROLES)[number];

export const MEMBER_STATUSES = values(["invited", "active", "revoked"] as const);
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/* ────────────────────────────────────────────── vendors (post-MVP) */

/**
 * Third-party sellers — vendor tickets 01–03. Outside `00-techinical.md`, which
 * never mentions a second seller, so these carry no `§`.
 *
 * `suspended` is reversible because a suspension is usually a dispute rather
 * than an ending; `rejected` and `offboarded` are terminal.
 */
export const VENDOR_STATUSES = values([
  "applied",
  "in_review",
  "verified",
  "suspended",
  "rejected",
  "offboarded",
] as const);
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/**
 * Two roles, not four, and only one separation is load-bearing: **where the
 * money goes**. A wrong price is reversible and audited; a wrong bank account is
 * money in a stranger's hands. So `owner` holds the payout account, the
 * agreement and the membership list, and `member` holds everything else.
 *
 * Deliberately *not* `ORGANIZATION_ROLES`. Those are buyer-shaped — who may
 * spend, who receives an invoice — and sharing the word `owner` across two
 * collections that mean different things by it is how a reader gets it wrong.
 */
export const VENDOR_ROLES = values(["owner", "member"] as const);
export type VendorRole = (typeof VENDOR_ROLES)[number];

/** A vendor member's status reuses `MEMBER_STATUSES`; an invitation has its own. */
export const VENDOR_INVITATION_STATUSES = values([
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const);
export type VendorInvitationStatus = (typeof VENDOR_INVITATION_STATUSES)[number];

/**
 * Two levels, because they gate different things and one is much cheaper.
 * `identity` unlocks listing products; `business` unlocks receiving a payout.
 * A vendor may therefore sell before business verification completes — earnings
 * accrue and are simply not payable.
 */
export const VENDOR_VERIFICATION_LEVELS = values(["identity", "business"] as const);
export type VendorVerificationLevel = (typeof VENDOR_VERIFICATION_LEVELS)[number];

/**
 * Who the vendor is, which decides what the second level asks for.
 *
 * Not a *third* verification level and not a status: it is a fact about the
 * seller that the same two levels are then read against. A sole trader and a
 * limited company both have to prove who they are and that the payout account is
 * theirs; only one of them has a certificate of incorporation to send.
 *
 * The payout gate is unchanged either way — `payout-service.ts` still requires
 * the `business` level approved before money moves. An individual is not exempt
 * from proving where the money is going; they are exempt from being asked for a
 * company number they do not have.
 */
export const VENDOR_ACCOUNT_TYPES = values(["individual", "business"] as const);
export type VendorAccountType = (typeof VENDOR_ACCOUNT_TYPES)[number];

export const VENDOR_VERIFICATION_STATUSES = values([
  "unstarted",
  "pending",
  "approved",
  "rejected",
] as const);
export type VendorVerificationStatus = (typeof VENDOR_VERIFICATION_STATUSES)[number];

/**
 * A ledger entry's kind — vendor ticket 08.
 *
 * Signed amounts: earnings and adjustments-up positive, refunds and payouts negative. One
 * collection rather than four, because a balance is the sum of its history and a history
 * split across tables is one somebody has to reassemble to answer "how much do we owe".
 */
export const LEDGER_ENTRY_KINDS = values([
  "earning",
  "refund",
  "adjustment",
  "payout",
] as const);
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

/**
 * Where one entry is in its life.
 *
 * `pending` → `cleared` on the clearance sweep, `cleared` → `paid` when a payout settles
 * it. `reversed` is for an entry a refund cancelled before it ever cleared.
 */
export const LEDGER_ENTRY_STATUSES = values([
  "pending",
  "cleared",
  "paid",
  "reversed",
] as const);
export type LedgerEntryStatus = (typeof LEDGER_ENTRY_STATUSES)[number];

/**
 * A payout's life — vendor ticket 09.
 *
 * `draft → approved` is a human decision and stays one: money leaving the platform on a
 * schedule with nobody looking is not a feature. A batch is *prepared* automatically and
 * *released* deliberately.
 */
export const PAYOUT_STATUSES = values([
  "draft",
  "approved",
  "sending",
  "paid",
  "failed",
  "cancelled",
] as const);
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * Why a vendor was not paid in a run — vendor ticket 09.
 *
 * "Skipped and told why" is the requirement, and it needs a closed set: a vendor silently
 * excluded from three runs has no way to discover it, and a free-text reason written by a
 * job is a sentence nobody can filter, count or explain twice the same way.
 */
/**
 * A review's life — vendor ticket 10.
 *
 * Published on submission (decision **V7**): pre-moderation would put a staff member
 * between every customer and their opinion, and the volume that makes it necessary is a
 * long way off. `hidden` is reversible and the author is told why; `removed` is a policy
 * breach. Neither deletes the row — a review nobody can find is still evidence in a
 * dispute about what was said.
 */
export const REVIEW_STATUSES = values(["published", "hidden", "removed"] as const);
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Why somebody reported a review.
 *
 * A closed set, because the report queue has to be sortable and countable, and because
 * "other" with a required note is a better answer than free text on every report.
 */
export const REVIEW_REPORT_REASONS = values([
  "spam",
  "abusive",
  "off_topic",
  "misleading",
  "other",
] as const);
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const PAYOUT_SKIP_REASONS = values([
  /** Business verification incomplete — money must not leave to an unverified account. */
  "unverified",
  /** No payout account on file. Nothing to send to. */
  "no_account",
  /** Cleared balance below the configured threshold. */
  "below_threshold",
  /** Cleared balance is negative — a refund clawed back more than was earned. */
  "negative_balance",
  "suspended",
] as const);
export type PayoutSkipReason = (typeof PAYOUT_SKIP_REASONS)[number];

export const VENDOR_DOCUMENT_KINDS = values([
  "government_id",
  "proof_of_address",
  "company_registration",
  "tax_document",
  "bank_proof",
  "other",
] as const);
export type VendorDocumentKind = (typeof VENDOR_DOCUMENT_KINDS)[number];

/* ────────────────────────────────────────────── catalog */

export const TAXONOMY_KINDS = values([
  "category",
  "industry",
  "technology",
  "product_type",
] as const);
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

/**
 * Which catalogue a product belongs to.
 *
 * Website templates — admin dashboards, ecommerce pages, corporate sites — browse,
 * search and categorise separately from application scripts, and are intended to
 * move to their own site later. That later move is the reason this is a
 * first-class scalar rather than a `product_type` term: extracting a catalogue
 * then is one query, and `product_type` stays free to say *what kind* of thing it
 * is (admin panel, starter kit, plugin) **within** either catalogue.
 *
 * Deliberately **not** a taxonomy kind and **not** a facet dimension. A catalogue
 * is a *surface* — which storefront you are standing in — not a filter you tick.
 * Putting it in the `facets` array would make it one, and would put it behind the
 * "1 filter" badge on every template page.
 */
export const PRODUCT_CATALOGUES = values(["script", "template"] as const);
export type ProductCatalogue = (typeof PRODUCT_CATALOGUES)[number];

/**
 * Which catalogue a taxonomy term belongs to — and `both`, which most do.
 *
 * The reason this exists is the filter rail: it renders **every** term of a kind
 * and only greys out the ones with no matches, deliberately ("never loses options
 * as it narrows"). So without scoping the *vocabulary*, "Admin dashboards" would
 * sit greyed-out in the script rail and "CRM" in the template one — each
 * catalogue advertising the other's categories.
 *
 * `both` is the default because industries and technologies genuinely are shared:
 * Healthcare is an industry either way, and Tailwind is a technology either way.
 * Only `category` is really split, which is why this is a scope on terms rather
 * than a second `category`-like kind.
 */
export const TAXONOMY_CATALOGUES = values(["script", "template", "both"] as const);
export type TaxonomyCatalogue = (typeof TAXONOMY_CATALOGUES)[number];

/**
 * §46 — products are not publicly purchasable the moment they are uploaded.
 *
 * `submitted` and `changes_requested` are vendor ticket 05's, and they sit at the
 * *front* of the pipeline rather than replacing any of it: a vendor hands a product
 * over at `submitted`, and from `internal_review` onwards it takes exactly the path
 * the platform already uses for its own.
 *
 * There used to be a `testing` state between `internal_review` and `ready`, paired
 * with a ten-item checklist. Both are gone: the stage held a product for a QA pass
 * that nobody was running, so in practice it was a status a reviewer clicked
 * through twice. Review decides, and `ready` still separates "approved" from
 * "live" — which is the separation that was doing the work.
 *
 * `changes_requested` is deliberately distinct from `draft`. It carries a reason and
 * a history, and a vendor's list has to be able to tell "not finished" from
 * "sent back".
 */
export const PRODUCT_STATUSES = values([
  "draft",
  "submitted",
  "changes_requested",
  "internal_review",
  "ready",
  "published",
  "deprecated",
  "archived",
] as const);
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * Why a submission was sent back — vendor ticket 05.
 *
 * A category alongside the prose, so "what do reviewers keep rejecting" is a query
 * rather than a reading exercise.
 */
export const REVIEW_REASON_CODES = values([
  "quality",
  "security",
  "licensing",
  "metadata",
  "pricing",
  "demo",
  "duplicate",
  "policy",
] as const);
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

/**
 * How a vendor supplies the bytes — vendor ticket 06.
 *
 * All three end as a `ProductFile` in the platform's own bucket **before** a customer
 * asks for it, so the customer cannot tell which was used and §66's "never behind an
 * unsigned permanent URL" does not depend on somebody else's uptime.
 *
 * `vendor_hosted` is the one whose name misleads: it means *the vendor's build
 * pipeline is the source*, not *the customer downloads from the vendor*. The vendor's
 * own screen says so, because it is not what the phrase suggests.
 */
export const DELIVERY_METHODS = values(["archive", "vendor_hosted", "repository"] as const);
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Where a mirrored or pulled artefact is in its journey into our bucket. */
export const ARTEFACT_SOURCE_STATUSES = values([
  "pending",
  "fetching",
  "stored",
  "failed",
] as const);
export type ArtefactSourceStatus = (typeof ARTEFACT_SOURCE_STATUSES)[number];

export const PRODUCT_VERSION_STATUSES = values(["draft", "released", "deprecated"] as const);
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];

export const PRODUCT_FILE_KINDS = values([
  "application_package",
  "source_package",
  "documentation",
  "database",
  "setup_guide",
  "sample_data",
  "asset",
] as const);
export type ProductFileKind = (typeof PRODUCT_FILE_KINDS)[number];

export const FILE_SCAN_STATUSES = values(["pending", "clean", "infected"] as const);
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

/** §9 — who may see a product's demo credentials. */
export const DEMO_EXPOSURES = values(["public", "authenticated", "owners_only"] as const);
export type DemoExposure = (typeof DEMO_EXPOSURES)[number];

export const PRODUCT_MEDIA_KINDS = values(["screenshot", "video"] as const);
export type ProductMediaKind = (typeof PRODUCT_MEDIA_KINDS)[number];

/**
 * §50 — the customization areas an admin can suggest for a product.
 *
 * An enum rather than free text because ticket 17's assistant reads these to
 * open the conversation ("would you like the branding changed?"). Free prose
 * would make that a parsing problem. The Mongoose field stays a permissive
 * `[String]` so adding an area later cannot invalidate stored documents; the
 * constraint lives in the Zod schema, where it can be relaxed per-release.
 */
export const CUSTOMIZATION_AREAS = values([
  "branding",
  "user_roles",
  "reports",
  "payment_methods",
  "workflows",
  "integrations",
  "notifications",
  "dashboard",
] as const);
export type CustomizationArea = (typeof CUSTOMIZATION_AREAS)[number];

/** §49 — an add-on is not always a fixed price. */
export const ADDON_PRICING_TYPES = values([
  "fixed",
  "starting_from",
  "quote_required",
] as const);
export type AddonPricingType = (typeof ADDON_PRICING_TYPES)[number];

/** §65 */
export const LICENCE_TYPES = values([
  "single_project",
  "single_installation",
  "multi_installation",
  "commercial",
  "developer",
  "saas",
  "subscription",
  "lifetime",
] as const);
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const LICENCE_STATUSES = values(["active", "suspended", "expired", "revoked"] as const);
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

export const ENTITLEMENT_STATUSES = values(["active", "suspended", "revoked"] as const);
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/* ────────────────────────────────────────────── commerce */

export const CART_ITEM_KINDS = values(["product_licence", "addon"] as const);
export type CartItemKind = (typeof CART_ITEM_KINDS)[number];

export const ORDER_STATUSES = values([
  "draft",
  "awaiting_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "refunded",
] as const);
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_PROVIDERS = values([
  "stripe",
  "paystack",
  "paypal",
  "manual",
  "free",
] as const);

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Providers with no third party behind them, and therefore no driver.
 *
 * `manual` is a bank transfer staff confirm; `free` is a £0 order. Both reach
 * `processPaymentSucceeded` by confirmation rather than by verification, so
 * neither has a redirect, a webhook, or anything to verify against.
 *
 * **This is a safety boundary, not tidiness.** Anything in `DRIVERS`
 * (`services/payments/registry.ts`) becomes selectable by
 * `providersFor`/`resolveProvider`, which resolve by *currency* — so a `free`
 * driver could be picked for a £299 order, and it would fulfil having taken no
 * money. Keeping `free` out of `DRIVERS` makes that unrepresentable rather than
 * merely unlikely; `settleFreeOrder` refusing a non-zero total is the second,
 * independent lock.
 *
 * Declared here rather than in the payments service because the repository layer
 * needs it too, and a repository importing a service inverts the layering.
 */
export const DRIVERLESS_PROVIDERS = ["manual", "free"] as const;
export type DriverlessProvider = (typeof DRIVERLESS_PROVIDERS)[number];

export function isDriverlessProvider(key: PaymentProvider): key is DriverlessProvider {
  return (DRIVERLESS_PROVIDERS as readonly PaymentProvider[]).includes(key);
}

export const PAYMENT_STATUSES = values([
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "requires_review",
] as const);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * A paid plugin's handover — an **add-on** order line, and only an add-on line.
 *
 * A plugin is sold as an add-on but delivered outside this platform: the vendor
 * or an admin hands over a key, a licence code, or a premium account on a
 * third-party API the script already talks to. So there is nothing to download
 * and no entitlement to grant — what there is instead is an obligation, and this
 * is what tracks it.
 *
 * `cancelled` is where a refund puts a line that was never handed over. There is
 * no path back out of `provided`: un-providing a key that has already been sent
 * does not un-send it.
 *
 * **Absence means "not tracked."** Every add-on line sold before this existed
 * was an installation or a branding service done off-book, and inventing a
 * `pending` for those retrospectively would open a task nobody is waiting for.
 */
export const ADDON_PROVISIONING_STATUSES = values([
  "pending",
  "provided",
  "cancelled",
] as const);
export type AddonProvisioningStatus = (typeof ADDON_PROVISIONING_STATUSES)[number];

export const PAYMENT_SUBJECT_TYPES = values(["order", "invoice"] as const);
export type PaymentSubjectType = (typeof PAYMENT_SUBJECT_TYPES)[number];

/**
 * A discount is either a flat amount off or a proportion off, and the two store
 * `value` differently — minor units for `fixed`, basis points for
 * `percentage`. Keeping them one field with a discriminating `kind` is what
 * stops a "20" meaning 20p in one row and 20% in the next.
 */
export const DISCOUNT_KINDS = values(["fixed", "percentage"] as const);
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** What a tax rule applies to. `any` is the catch-all a country usually needs. */
export const TAX_RULE_KINDS = values(["digital", "service", "any"] as const);
export type TaxRuleKind = (typeof TAX_RULE_KINDS)[number];

/* ────────────────────────────────────────────── requirements & requests */

export const AI_CONTEXT_TYPES = values(["customization", "custom_build"] as const);
export type AiContextType = (typeof AI_CONTEXT_TYPES)[number];

export const AI_CONVERSATION_STATUSES = values(["active", "abandoned", "submitted"] as const);
export type AiConversationStatus = (typeof AI_CONVERSATION_STATUSES)[number];

export const AI_MESSAGE_ROLES = values(["user", "assistant", "system"] as const);
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

/** §17 — what the customer confirmed must stay distinguishable from what the AI inferred. */
export const REQUIREMENT_ORIGINS = values(["confirmed", "assumed", "suggested"] as const);
export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

export const REQUEST_KINDS = values(["customization", "custom_build"] as const);
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** §91 */
export const REQUEST_STATUSES = values([
  "draft",
  "submitted",
  "under_review",
  "waiting_for_customer",
  "technical_review",
  "quoted",
  "approved",
  "converted",
  // Everything past `converted` is delivery. It used to stop there — a terminal
  // state reached the moment the deposit cleared, after which nothing could
  // happen and the customer heard nothing further, permanently.
  "in_progress",
  "delivered",
  "completed",
  "rejected",
  "cancelled",
] as const);
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const FOLLOW_UP_STATUSES = values(["open", "done", "cancelled"] as const);
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/* ────────────────────────────────────────────── quotes & billing */

export const QUOTE_STATUSES = values([
  "draft",
  "issued",
  "accepted",
  "rejected",
  "expired",
  "superseded",
] as const);
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_ITEM_KINDS = values([
  "development",
  "service",
  "licence",
  "third_party",
] as const);
export type QuoteItemKind = (typeof QUOTE_ITEM_KINDS)[number];

export const PAYMENT_TERMS = values(["full_upfront", "deposit_balance", "milestones"] as const);
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/** §63 */
export const INVOICE_STATUSES = values([
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
  "refunded",
] as const);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_SOURCE_TYPES = values(["order", "quote"] as const);
export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPES)[number];

/* ────────────────────────────────────────────── communication */

/**
 * `vendor_support` is the fourth — vendor ticket 13.
 *
 * A fourth subject type, **not a second messaging system**. Ticket 21's one
 * `Conversation` + `Message` model already carries the visibility discipline that matters
 * here, and a parallel system would mean a second place for §37's boundary to be got wrong.
 */
export const CONVERSATION_SUBJECT_TYPES = values([
  "request",
  "order",
  "quote",
  "vendor_support",
  /**
   * Vendor ticket 14 — the staff↔vendor half of a mediated customization.
   *
   * A **fifth subject type and a second thread on one request**, which needs justifying because
   * §38 is one-conversation-per-subject and this looks like two. It is two subjects: the customer's
   * request, and the brief a vendor was asked to price. They have to be separate because the
   * visibility table above cannot express "customer and staff, but not the vendor" — a `customer`
   * message is visible to the vendor by design, and `VendorMessage` carries `senderName`. Adding a
   * fourth level would fix the projection and not the problem, since no visibility rule stops a
   * customer typing their own phone number into a body.
   *
   * So the vendor is not a participant in the customer's conversation at all, and mediation is
   * structural rather than a flag. The unique index on `{subjectType, subjectId}` is what makes the
   * separate type necessary rather than optional.
   */
  "vendor_brief",
] as const);
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];

export const MESSAGE_SENDER_TYPES = values([
  "customer",
  "staff",
  "system",
  /** Vendor ticket 13 — the third party in a three-party conversation. */
  "vendor",
] as const);
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

/**
 * §37 — `internal` must never reach a customer payload, and now never a **vendor** one.
 *
 * Three levels, because vendor ticket 13 introduced a third audience:
 *
 * | | Customer | Vendor | Staff |
 * |---|---|---|---|
 * | `customer` | ✓ | ✓ | ✓ |
 * | `vendor` | | ✓ | ✓ |
 * | `internal` | | | ✓ |
 *
 * `internal` therefore means **staff-only**, and that now includes hiding it from the vendor:
 * a staff assessment of a vendor's responsiveness is exactly the note that must not reach
 * them. The addition is the reason `listForConversation` takes an audience rather than a
 * boolean.
 */
export const MESSAGE_VISIBILITIES = values(["customer", "vendor", "internal"] as const);

/**
 * A brief's life — vendor ticket 14.
 *
 * `sent` the moment staff hand it over; `answered` once the vendor has priced it; `declined` when
 * they say they will not; `withdrawn` when staff pull it back — which is also what a requirements
 * revision does to the brief it supersedes, because a brief is **what the vendor was shown** and
 * editing one would destroy the only record of that.
 *
 * `answered` is not terminal: staff may ask for a revised price, which reopens it. `declined` and
 * `withdrawn` are, and a new brief is the way forward from either.
 */
export const VENDOR_BRIEF_STATUSES = values([
  "sent",
  "answered",
  "declined",
  "withdrawn",
] as const);
export type VendorBriefStatus = (typeof VENDOR_BRIEF_STATUSES)[number];
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];

/**
 * A dispute's life — vendor ticket 13.
 *
 * A **state on the thread**, not a fourth subject type: the conversation is already there, and
 * splitting it would leave two records of one argument. `withdrawn` exists because a customer
 * who gets what they wanted mid-dispute should not need staff to close it.
 */
export const DISPUTE_STATUSES = values([
  "open",
  "under_review",
  "resolved",
  "withdrawn",
] as const);
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Why a dispute was raised, by whichever party raised it.
 *
 * Both sides in one closed set rather than two enums, because the queue is one queue and a
 * reason nobody can filter on is a reason nobody counts.
 */
export const DISPUTE_REASONS = values([
  /* Customer-side. */
  "not_as_described",
  "does_not_work",
  "refund_refused",
  "no_response",
  /* Vendor-side. */
  "abusive_buyer",
  "licence_misuse",
  "unfair_review",
  "other",
] as const);
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/**
 * How staff decided — vendor ticket 13.
 *
 * `no_action` is in the list deliberately: a dispute resolved in the vendor's favour is a real
 * outcome, and without it a reviewer's only options would be to act or to leave the thread
 * open, which is how a dispute goes quiet.
 */
export const DISPUTE_OUTCOMES = values([
  "refunded",
  "product_delisted",
  "review_removed",
  "vendor_suspended",
  "no_action",
  "other",
] as const);
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/** Where a takedown claim has got to — vendor ticket 13. */
export const TAKEDOWN_STATUSES = values([
  "received",
  "product_delisted",
  "awaiting_vendor",
  "resolved",
  "rejected",
] as const);
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number];

/** §92 — the canonical business events. */
export const DOMAIN_EVENTS = values([
  "RequestSubmitted",
  "CustomizationSubmitted",
  "RequestAssigned",
  "CustomerActionRequested",
  "QuoteIssued",
  "QuoteAccepted",
  "QuoteRejected",
  "InvoiceIssued",
  "PaymentReceived",
  "OrderCompleted",
  "LicenceIssued",
  "ProductPublished",
  "ProductVersionReleased",
  "MessagePosted",
  "WorkReadyToStart",
  "RequestProgressPosted",
  /*
   * Live and emitted, and missing from this list until vendor ticket 05's drift test
   * asked. An event absent here is one a timeline cannot describe — `ActivityEventDoc`
   * and `NotificationDoc` take their vocabulary from it — so the rows existed and had
   * no name. Safe to widen: both fields are typed `DomainEventType | string` over a
   * bare `String` path, so nothing stored becomes invalid.
   */
  "RequestStatusChanged",
  "RequirementsRevised",
  "InvoicePaid",
  "InvoiceDueSoon",
  "InvoiceOverdue",
  "FollowUpDue",
  // Vendor tickets 01–03.
  "VendorApplied",
  "VendorVerified",
  "VendorRejected",
  /*
   * One *level* decided, which is not the same as the application being decided.
   * A vendor can be verified overall while their payout details are still being
   * read, and the two answers arrive days apart — so they are two events.
   */
  "VendorVerificationDecided",
  "VendorSuspended",
  // Vendor ticket 13.
  "VendorSupportThreadOpened",
  "DisputeRaised",
  "DisputeResolved",
  // Vendor ticket 12.
  "VendorOffboarded",
  "ProductEmergencyDelisted",
  // Vendor ticket 10.
  "ProductReviewPublished",
  "ProductReviewFlagged",
  // Vendor ticket 09 — the first events about money leaving.
  "VendorPayoutPaid",
  "VendorPayoutFailed",
  // Vendor ticket 05.
  "ProductSubmitted",
  "ProductChangesRequested",
  "ProductApproved",
  // Vendor ticket 14.
  "CustomizationRoutedToVendor",
  "VendorBriefAnswered",
  "VendorBriefDeclined",
  // Paid plugins — the handover a purchase creates an obligation for.
  "AddonProvisioningRequested",
  "AddonProvisioned",
] as const);
export type DomainEventType = (typeof DOMAIN_EVENTS)[number];

/**
 * A vendor editing their own product would otherwise be recorded as `customer`,
 * which is wrong in the one collection that exists to be trustworthy later.
 * Widening this enum does not invalidate any stored row.
 */
export const ACTOR_TYPES = values([
  "customer",
  "staff",
  "vendor",
  "system",
  "webhook",
] as const);
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Anything a timeline can hang off. */
export const SUBJECT_TYPES = values([
  "request",
  "order",
  "quote",
  "invoice",
  "product",
  "entitlement",
  "organization",
  "payment",
  /**
   * Ticket 25. Retrying or cancelling a background job is a staff decision
   * about something that will or will not happen to customer data, so it is
   * auditable like any other — and `job` rather than a vaguer `system` so the
   * subject-scoped index actually finds the job's own history.
   */
  "job",
  /**
   * Vendor ticket 01. Without this an audit row *about* a vendor — an
   * application decision, a verification outcome, a suspension — cannot be found
   * by the `{subjectType, subjectId, createdAt}` index, which is the only way
   * that history is ever read back.
   */
  "vendor",
  /**
   * Vendor ticket 10. Hiding or removing somebody's review is a staff decision about
   * public, attacker-controlled text on a page we want indexed — exactly the kind of
   * decision §90 exists to record, and without this the row cannot be found by the
   * `{subjectType, subjectId, createdAt}` index.
   */
  "review",
] as const);
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const NOTIFICATION_CHANNELS = values(["in_app", "email"] as const);
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * §69's preference categories.
 *
 * Deliberately five broad buckets rather than one switch per event. A
 * preferences screen with thirty toggles is one nobody reads, and the person
 * who wants fewer emails wants "stop telling me about products", not to reason
 * about `ProductVersionReleased`.
 *
 * `security` is in the list so the *category* exists on every notification, not
 * so it can be switched off — see `ESSENTIAL_CATEGORIES` in the service.
 */
export const NOTIFICATION_CATEGORIES = values([
  "requests",
  "quotes",
  "billing",
  "products",
  "messages",
  "security",
] as const);
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
