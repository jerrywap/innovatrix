/**
 * Features and customisable areas, per category.
 *
 * ## Why this exists
 *
 * `productContext()` feeds the customisation assistant a product's feature list
 * and its staff-flagged `customization.suggestedAreas`, and the prompt leans on
 * both harder than on anything else — the features are how it opens on something
 * the product actually does, and the areas are how it steers the interview
 * towards roles for a CRM and availability for a booking system.
 *
 * Neither was ever written. `features` was set on eleven products out of 1016 and
 * `suggestedAreas` on none of them, because `seed-bulk.ts` never touched either.
 * So the best-developed part of the prompt was running against empty arrays on
 * every listing in the catalogue, and the interview it produced was the generic
 * one it was written to avoid.
 *
 * ## Shared, because two callers must agree
 *
 * `seed-bulk.ts` uses it for new products and `backfill-customization.ts` for the
 * thousand that already exist. Two copies would drift, and the second would be
 * the one nobody re-read — the same reasoning that puts the taxonomy vocabulary
 * in its own module next door.
 *
 * ## These are placeholder features, and they are honest about their level
 *
 * A seeded product has a generated name and a two-sentence description; nothing
 * here can be truer than that. What it *can* be is consistent with it — a
 * logistics product listing "Driver job list" rather than "Patient triage" — so
 * that the assistant's first question lands somewhere plausible and the failure
 * modes we are trying to see are the real ones. A vendor's own features replace
 * these the moment they edit the listing.
 *
 * `suggestedAreas` is the field with a warning attached. `options-form.tsx` tells
 * whoever fills it in that "an offer it cannot honour is worse than no offer", so
 * each list below is short and sticks to the axes any software of that kind has:
 * who can see what, what it reports, how the steps run, what it connects to.
 * Nothing here promises a capability — an area is a subject the interview may
 * raise, and the assistant is forbidden from confirming feasibility either way.
 */

/** The eight values of `CUSTOMIZATION_AREAS`, as the seed may use them. */
type Area =
  | "branding"
  | "user_roles"
  | "reports"
  | "payment_methods"
  | "workflows"
  | "integrations"
  | "notifications"
  | "dashboard";

export interface SeedFeature {
  title: string;
  detail: string;
}

export interface CategoryProfile {
  features: SeedFeature[];
  areas: Area[];
}

/**
 * Keyed by the category slugs in `taxonomy-vocabulary.ts`.
 *
 * Both catalogues are covered. A website template has features too — they are
 * about pages and content rather than records — and a template listing with an
 * empty feature list starves the assistant exactly as a script one does.
 */
export const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  /* ── scripts ────────────────────────────────────────────── */

  crm: {
    features: [
      {
        title: "Contact and company records",
        detail: "One place per customer, with the history of every conversation attached.",
      },
      {
        title: "Pipeline stages",
        detail: "Move an enquiry from first contact to won or lost, and see what is stuck.",
      },
      {
        title: "Task and follow-up reminders",
        detail: "Nothing waits on somebody remembering to chase it.",
      },
      {
        title: "Notes and file attachments",
        detail: "Quotes, contracts and correspondence stay against the record.",
      },
      {
        title: "Team assignment",
        detail: "Each account has an owner, and handovers are recorded.",
      },
      {
        title: "Activity reporting",
        detail: "What came in, what closed, and how long it took.",
      },
    ],
    areas: ["user_roles", "reports", "workflows", "integrations"],
  },

  booking: {
    features: [
      {
        title: "Calendar and availability",
        detail: "Opening hours, capacity per slot, and blocked-out dates.",
      },
      {
        title: "Self-service booking",
        detail: "Customers pick a time themselves instead of ringing.",
      },
      {
        title: "Confirmations and reminders",
        detail: "Sent when a booking is made and again before it happens.",
      },
      {
        title: "Cancellations and rescheduling",
        detail: "Handled by the customer within rules you set.",
      },
      {
        title: "Deposits and payment on booking",
        detail: "Take money up front, or record it as due.",
      },
      {
        title: "Attendance and no-show records",
        detail: "Who came, who did not, and what it cost.",
      },
    ],
    areas: ["notifications", "payment_methods", "workflows", "branding"],
  },

  "e-commerce": {
    features: [
      {
        title: "Product catalogue",
        detail: "Variants, images, stock levels and descriptions.",
      },
      {
        title: "Basket and checkout",
        detail: "Including delivery options and order confirmation.",
      },
      {
        title: "Order management",
        detail: "Fulfilment status, refunds and a record of every change.",
      },
      { title: "Customer accounts", detail: "Order history, saved addresses and reordering." },
      {
        title: "Discounts and promotions",
        detail: "Codes, thresholds and time-limited offers.",
      },
      { title: "Sales reporting", detail: "What sold, when, and what is not moving." },
    ],
    areas: ["payment_methods", "branding", "integrations", "reports"],
  },

  property: {
    features: [
      {
        title: "Property and unit records",
        detail: "Addresses, photographs, documents and compliance dates.",
      },
      {
        title: "Tenancy management",
        detail: "Terms, renewals and the people attached to each one.",
      },
      {
        title: "Rent collection and arrears",
        detail: "What is due, what has landed, and what is late.",
      },
      {
        title: "Maintenance requests",
        detail: "Raised by tenants, assigned to contractors, tracked to done.",
      },
      {
        title: "Inspection scheduling",
        detail: "Recurring visits with dated records and photographs.",
      },
      {
        title: "Landlord statements",
        detail: "Income, costs and fees per property for a period.",
      },
    ],
    areas: ["user_roles", "notifications", "reports", "workflows"],
  },

  finance: {
    features: [
      {
        title: "Invoicing",
        detail: "Raise, send and track invoices against a customer record.",
      },
      { title: "Payment chasing", detail: "Reminders escalating on a schedule you set." },
      { title: "Expense records", detail: "Receipts captured and coded against a category." },
      { title: "Bank reconciliation", detail: "Match what arrived against what was expected." },
      {
        title: "Statements and ageing",
        detail: "Who owes what, and how long it has been outstanding.",
      },
      { title: "Audit trail", detail: "Every figure traceable to who entered or changed it." },
    ],
    areas: ["reports", "integrations", "user_roles", "payment_methods"],
  },

  healthcare: {
    features: [
      {
        title: "Client and patient records",
        detail: "Contact details, consent, and the notes attached to each visit.",
      },
      {
        title: "Appointment scheduling",
        detail: "Per practitioner, per room, with recurring slots.",
      },
      {
        title: "Referral pathway",
        detail: "From triage through to discharge, with the stage always visible.",
      },
      {
        title: "Care and visit notes",
        detail: "Entered at the time, timestamped and attributed.",
      },
      { title: "Practitioner rota", detail: "Who is on, where, and what is uncovered." },
      {
        title: "Access control by role",
        detail: "Clinical detail visible only to those who need it.",
      },
    ],
    areas: ["user_roles", "notifications", "workflows", "reports"],
  },

  logistics: {
    features: [
      {
        title: "Job and consignment records",
        detail: "Collection, delivery, contents and the state of each one.",
      },
      { title: "Driver job list", detail: "One ordered list per driver per day, on a phone." },
      {
        title: "Route planning",
        detail: "Stops sequenced, with the day's work grouped sensibly.",
      },
      { title: "Proof of delivery", detail: "Signature or photograph captured at the door." },
      {
        title: "Offline working",
        detail: "Keeps going without signal and syncs when it returns.",
      },
      { title: "Delivery performance reporting", detail: "On time, late, failed, and why." },
    ],
    areas: ["workflows", "notifications", "reports", "integrations"],
  },

  "hr-and-rota": {
    features: [
      {
        title: "Staff records",
        detail: "Contracts, qualifications, and the dates that expire.",
      },
      {
        title: "Shift scheduling",
        detail: "Build a rota across sites and see gaps before they happen.",
      },
      {
        title: "Availability and leave",
        detail: "Requested by staff, approved by a manager, reflected in the rota.",
      },
      { title: "Timesheets", detail: "Hours worked, approved once, ready to pay." },
      {
        title: "Certification reminders",
        detail: "Flagged before a qualification lapses, not after.",
      },
      { title: "Cost and hours reporting", detail: "Per site, per period, against budget." },
    ],
    areas: ["user_roles", "notifications", "reports", "workflows"],
  },

  /* ── templates ──────────────────────────────────────────── */

  "admin-dashboards": {
    features: [
      {
        title: "Summary screens",
        detail: "The figures that matter, laid out to be read at a glance.",
      },
      { title: "Data tables", detail: "Sortable, filterable and paginated, with an export." },
      { title: "Charts and trends", detail: "Built-in chart components wired to sample data." },
      {
        title: "Forms and validation",
        detail: "Consistent input, error and empty states throughout.",
      },
      {
        title: "Sign-in screens",
        detail: "Log in, reset password and account pages included.",
      },
      { title: "Light and dark themes", detail: "Both designed, not one inverted." },
    ],
    areas: ["branding", "dashboard", "user_roles"],
  },

  "ecommerce-pages": {
    features: [
      {
        title: "Product listing and detail pages",
        detail: "Grid, filters, gallery and variant selection.",
      },
      {
        title: "Basket and checkout pages",
        detail: "Through to an order confirmation screen.",
      },
      { title: "Account pages", detail: "Order history, addresses and saved items." },
      {
        title: "Category and search results",
        detail: "Including an empty state worth reading.",
      },
      { title: "Responsive layouts", detail: "Built for a phone first, then the desktop." },
      { title: "Content blocks", detail: "Promotional rows and banners you can rearrange." },
    ],
    areas: ["branding", "payment_methods", "integrations"],
  },

  "corporate-and-business": {
    features: [
      {
        title: "Home and about pages",
        detail: "A structure to say who you are and what you do.",
      },
      { title: "Services and pricing pages", detail: "Comparable layouts for what you sell." },
      {
        title: "Team and case study pages",
        detail: "Profiles and worked examples with real hierarchy.",
      },
      { title: "Contact page and form", detail: "With validation and a confirmation state." },
      { title: "Blog and article layouts", detail: "Index, article and author pages." },
      {
        title: "Accessible markup",
        detail: "Headings, labels and focus states done properly.",
      },
    ],
    areas: ["branding", "integrations", "notifications"],
  },

  "landing-pages": {
    features: [
      {
        title: "Hero and value proposition",
        detail: "The opening screen, built to be edited rather than rebuilt.",
      },
      {
        title: "Feature and benefit sections",
        detail: "Several arrangements to choose between.",
      },
      {
        title: "Testimonial and logo strips",
        detail: "Social proof blocks that hold their shape.",
      },
      { title: "Pricing tables", detail: "Two, three and four column variants." },
      { title: "Sign-up form", detail: "With validation, success and error states." },
      { title: "Fast by default", detail: "No heavy dependencies in the critical path." },
    ],
    areas: ["branding", "integrations", "notifications"],
  },
};

/**
 * The fallback for a category with no profile.
 *
 * Deliberately vague, because it is describing software we know nothing about
 * beyond the fact that somebody listed it. Better a generic four than a
 * confident wrong six — and a category new enough to be missing here is a prompt
 * to add it above, not to guess harder at runtime.
 */
export const GENERIC_PROFILE: CategoryProfile = {
  features: [
    { title: "Records and search", detail: "Everything in one place, findable." },
    { title: "User accounts and permissions", detail: "Who can see and change what." },
    { title: "Reporting and export", detail: "Get the numbers out in a usable form." },
    { title: "Audit history", detail: "A record of what changed and who changed it." },
  ],
  areas: ["user_roles", "reports", "branding"],
};

export function profileFor(categorySlug: string | undefined): CategoryProfile {
  return (categorySlug && CATEGORY_PROFILES[categorySlug]) || GENERIC_PROFILE;
}
