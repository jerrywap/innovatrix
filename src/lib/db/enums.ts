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

/* ────────────────────────────────────────────── catalog */

export const TAXONOMY_KINDS = values([
  "category",
  "industry",
  "technology",
  "product_type",
] as const);
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

/** §46 — products are not publicly purchasable the moment they are uploaded. */
export const PRODUCT_STATUSES = values([
  "draft",
  "internal_review",
  "testing",
  "ready",
  "published",
  "deprecated",
  "archived",
] as const);
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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
] as const);
export type DomainEventType = (typeof DOMAIN_EVENTS)[number];

export const ACTOR_TYPES = values(["customer", "staff", "system", "webhook"] as const);
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
] as const);
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const NOTIFICATION_CHANNELS = values(["in_app", "email"] as const);
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
