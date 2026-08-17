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

export const VENDOR_VERIFICATION_STATUSES = values([
  "unstarted",
  "pending",
  "approved",
  "rejected",
] as const);
export type VendorVerificationStatus = (typeof VENDOR_VERIFICATION_STATUSES)[number];

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
 * §46 — products are not publicly purchasable the moment they are uploaded.
 *
 * `submitted` and `changes_requested` are vendor ticket 05's, and they sit at the
 * *front* of the pipeline rather than replacing any of it: a vendor hands a product
 * over at `submitted`, and from `internal_review` onwards it takes exactly the path
 * the platform already uses for its own. Same testing checklist, same readiness gate.
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
  "testing",
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
 * §47 — the internal testing checklist that gates `ready`.
 *
 * `na` is not "skip": publish requires every item to be `pass`, or `na` **with
 * a note saying why**. An unexplained `na` is how a checklist becomes theatre.
 */
export const TESTING_CHECKLIST_STATUSES = values(["pending", "pass", "fail", "na"] as const);
export type TestingChecklistStatus = (typeof TESTING_CHECKLIST_STATUSES)[number];

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

export const PAYMENT_PROVIDERS = values(["stripe", "paystack", "paypal", "manual"] as const);
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = values([
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "requires_review",
] as const);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

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

export const CONVERSATION_SUBJECT_TYPES = values(["request", "order", "quote"] as const);
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];

export const MESSAGE_SENDER_TYPES = values(["customer", "staff", "system"] as const);
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

/** §37 — `internal` must never reach a customer payload. */
export const MESSAGE_VISIBILITIES = values(["customer", "internal"] as const);
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];

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
  "VendorSuspended",
  // Vendor ticket 05.
  "ProductSubmitted",
  "ProductChangesRequested",
  "ProductApproved",
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
