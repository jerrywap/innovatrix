import type { TaxonomyCatalogue, TaxonomyKind } from "../src/lib/db/enums";

/**
 * The one taxonomy vocabulary, shared by every seed.
 *
 * ## Why this file exists
 *
 * `seed.ts` and `seed-bulk.ts` each carried their own `product_type` list and the
 * two **disagreed**, so a bulk-seeded database grew terms no screen had been
 * designed around. One list, imported by all of them, so they cannot drift again.
 *
 * ## The shape: two tiers of category, three flat axes
 *
 * 368 terms — 32 category parents, 213 children, 43 industries, 70 technologies
 * and 10 product types. `ai-contexts/temp/improved-taxonomy-suggestions.md` is
 * where each list was argued; this is the same content in the form the seeds read.
 *
 * A child belongs to **exactly one** parent, because the URL is the hierarchy and
 * a term in two groups is two URLs for one thing.
 *
 * ## `catalogue` is stated for every term
 *
 * Not defaulted. `both` is the schema default and the right one for a term
 * somebody adds through the admin screen, but a seed writing the canonical
 * vocabulary should say what it means — and the categories being explicitly
 * `script` or `template` *is* the "templates must not pollute script browsing"
 * requirement, rather than a consequence of a default.
 *
 * Categories are never `both`: a category answers "what kind of thing is this",
 * and that question has different answers in the two shops. Industries,
 * technologies and product types are shared, because "Healthcare" means the same
 * thing whichever shelf you are standing at.
 *
 * ## A slug, once stated, never changes
 *
 * `slug` overrides `slugify(name)` and exists for two reasons, both of which are
 * about not moving a URL that already ranks. Where a term predates this list its
 * original slug is kept even though its **name** has since changed —
 * `booking` is now called "Booking & Reservations" — and where `slugify` would
 * produce a bad segment, a better one is written down: `slugify("Business &
 * Operations")` is `business-and-operations`, and `slugify("C#")` is `c`.
 *
 * A rename changes `name`. It never changes `slug`.
 */

export interface VocabularyTerm {
  kind: TaxonomyKind;
  name: string;
  catalogue: TaxonomyCatalogue;
  description?: string;
  sortOrder: number;
  /** Overrides `slugify(name)`. Stable forever once written — see above. */
  slug?: string;
  /** The parent term's **name**, for a child category. Roots omit it. */
  parent?: string;
}

/**
 * Category parents — the first tier, and the pages this whole scheme exists for.
 *
 * Every one carries real prose, and that is not decoration:
 * `marketplace/[parent]/page.tsx` reads `description` as the intro copy, and a
 * landing page whose only difference from the listing is its `<h1>` is read as a
 * duplicate of it. Thirty descriptions is the editorial cost of thirty pages
 * worth ranking.
 */
const categoryParents: Array<{
  name: string;
  slug: string;
  catalogue: TaxonomyCatalogue;
  description: string;
}> = [
  /* ── script ─────────────────────────────────────────────── */
  {
    name: "Business & Operations",
    slug: "business-operations",
    catalogue: "script",
    description:
      "The systems a business runs itself on — customers, work, documents and the reporting that tells you how any of it is going.",
  },
  {
    name: "Sales & Customer",
    slug: "sales-customer",
    catalogue: "script",
    description:
      "Winning the work and keeping it: pipelines, leads, loyalty, and the portal a customer logs into afterwards.",
  },
  {
    name: "Commerce",
    slug: "commerce",
    catalogue: "script",
    description:
      "Software that sells: storefronts, stock, orders and the checkout, plus everything behind the counter that keeps them honest.",
  },
  {
    name: "Booking & Scheduling",
    slug: "booking-scheduling",
    catalogue: "script",
    description:
      "Anything where the product is a slot in time — appointments, reservations, rentals and the calendars underneath them.",
  },
  {
    name: "HR & Workforce",
    slug: "hr-workforce",
    catalogue: "script",
    description:
      "Hiring, rotas, attendance, leave and payroll — the software that turns a headcount into a working week.",
  },
  {
    name: "Finance",
    slug: "finance",
    catalogue: "script",
    description:
      "Money in and money out: ledgers, invoices, expenses and the reporting an accountant will actually accept.",
  },
  {
    name: "Property",
    slug: "property",
    catalogue: "script",
    description:
      "Buildings and the people in them — listings, tenancies, maintenance and the paperwork each of those generates.",
  },
  {
    name: "Healthcare",
    slug: "healthcare",
    catalogue: "script",
    description:
      "Clinical operations, from the appointment book to the patient record — built for the rules the sector is held to.",
  },
  {
    name: "Education",
    slug: "education",
    catalogue: "script",
    description:
      "Teaching and the administration around it: courses, cohorts, assessment and the records a school has to keep.",
  },
  {
    name: "Logistics & Mobility",
    slug: "logistics-mobility",
    catalogue: "script",
    description:
      "Moving things and people: dispatch, fleets, deliveries and the tracking a customer expects to watch it happen on.",
  },
  {
    name: "Food & Hospitality",
    slug: "food-hospitality",
    catalogue: "script",
    description:
      "Kitchens, tables and rooms — ordering, reservations and the operational software behind service.",
  },
  {
    name: "Content & Publishing",
    slug: "content-publishing",
    catalogue: "script",
    description:
      "Making and shipping content: editorial workflows, media libraries, and the platforms that put it in front of people.",
  },
  {
    name: "Community & Support",
    slug: "community-support",
    catalogue: "script",
    description:
      "Where people talk to you and to each other — helpdesks, forums, messaging, memberships and directories.",
  },
  {
    name: "Events",
    slug: "events",
    catalogue: "script",
    description:
      "Everything between announcing an event and letting people through the door: programmes, venues, tickets.",
  },
  {
    name: "Security & Access",
    slug: "security-access",
    catalogue: "script",
    description:
      "Who is allowed in, and the proof of it — authentication, identity, access control and the tooling that watches all three.",
  },
  {
    name: "Developer & Technical",
    slug: "developer-technical",
    catalogue: "script",
    description:
      "The layer under the product: APIs, databases, deployment, monitoring and the integrations that hold a stack together.",
  },
  {
    name: "AI",
    slug: "ai",
    catalogue: "script",
    description:
      "Assistants, chatbots, generation and automation — the fastest-moving shelf here, and the one where the terms change every quarter.",
  },
  {
    name: "Utilities",
    slug: "utilities",
    catalogue: "script",
    description:
      "Small, sharp tools that do one job: calculators, converters, notifications, imports and the rest of the workshop drawer.",
  },
  {
    /*
     * A complete mobile app and a mobile *screen kit* are different products, so
     * they get a tree each rather than one shared term. A category owns exactly
     * one landing page — see `categoryLandingPath` — and a `both`-scoped one
     * would leave the template side with no page of its own.
     */
    name: "Mobile Apps",
    slug: "mobile-apps",
    catalogue: "script",
    description:
      "Complete apps for a phone, with the backend behind them — delivery, booking, chat, payments and the rest of what people actually install.",
  },
  /* ── template ─────────────────────────────────────────────── */
  {
    name: "Business & Corporate",
    slug: "business-corporate",
    catalogue: "template",
    description:
      "Sites for organisations that need to look established: services, team, case studies and contact, in a considered tone.",
  },
  {
    name: "E-commerce & Store",
    slug: "ecommerce-store",
    catalogue: "template",
    description:
      "Shop fronts — catalogue, product, basket and checkout pages, styled and responsive, ready to wire to whatever sells behind them.",
  },
  {
    name: "Portfolio & Creative",
    slug: "portfolio-creative",
    catalogue: "template",
    description:
      "Work, shown properly. Galleries, case studies and the restraint that lets the images do the talking.",
  },
  {
    name: "Landing & Marketing Pages",
    slug: "landing-marketing-pages",
    catalogue: "template",
    description:
      "Single pages built to convert: a hero, the proof, the pricing and one clear thing to do next.",
  },
  {
    name: "Admin & Application UI",
    slug: "admin-application-ui",
    catalogue: "template",
    description:
      "The inside of a product — dashboards, tables, forms and navigation, already designed so nobody has to do it twice.",
  },
  {
    name: "Blog & Publishing",
    slug: "blog-publishing",
    catalogue: "template",
    description:
      "Reading layouts: article pages, indexes, archives and the typography that makes long text bearable on a phone.",
  },
  {
    name: "Directory & Listing",
    slug: "directory-listing",
    catalogue: "template",
    description:
      "Many things, findable — search, filters, map and detail views for anything from a job board to a local guide.",
  },
  {
    name: "Personal & Resume",
    slug: "personal-resume",
    catalogue: "template",
    description:
      "One person, presented well: a CV, a portfolio, a personal site that does not look like a template.",
  },
  {
    name: "Events & Booking",
    slug: "events-booking",
    catalogue: "template",
    description:
      "Programmes, speakers, venues and the form that takes a booking — for a conference, a wedding or a room.",
  },
  {
    name: "Education & Learning",
    slug: "education-learning",
    catalogue: "template",
    description:
      "Course pages, curricula and school sites — the front of anything that teaches, whether or not there is an LMS behind it.",
  },
  {
    name: "Community & Nonprofit",
    slug: "community-nonprofit",
    catalogue: "template",
    description:
      "Causes and the people around them: what you do, who it helps, and an unmissable way to give or join.",
  },
  {
    name: "Utility Pages",
    slug: "utility-pages",
    catalogue: "template",
    description:
      "The pages every site needs and nobody designs — sign-in, 404, maintenance, coming soon. Consistent, and done once.",
  },
  {
    // The template half of the pair — see the note on "Mobile Apps" above.
    name: "Mobile App UI",
    slug: "mobile-app-ui",
    catalogue: "template",
    description:
      "Screens, flows and kits for a phone — onboarding, navigation and the states a mobile app needs before anybody writes the backend.",
  },
];

const categories: Array<[string, TaxonomyCatalogue, string?, string?, string?]> = [
  // Business & Operations
  ["CRM", "script", undefined, "Business & Operations", "crm"],
  ["ERP", "script", undefined, "Business & Operations"],
  ["Business Management", "script", undefined, "Business & Operations"],
  ["Project Management", "script", undefined, "Business & Operations"],
  ["Task Management", "script", undefined, "Business & Operations"],
  ["Workflow & Automation", "script", undefined, "Business & Operations"],
  ["Operations Management", "script", undefined, "Business & Operations"],
  ["Document Management", "script", undefined, "Business & Operations"],
  ["Knowledge Base", "script", undefined, "Business & Operations"],
  ["Forms & Surveys", "script", undefined, "Business & Operations"],
  ["Reporting & Analytics", "script", undefined, "Business & Operations"],
  ["Admin & Back Office", "script", undefined, "Business & Operations"],
  // Sales & Customer
  ["Sales Management", "script", undefined, "Sales & Customer"],
  ["Lead Management", "script", undefined, "Sales & Customer"],
  ["Customer Portal", "script", undefined, "Sales & Customer"],
  ["Loyalty & Rewards", "script", undefined, "Sales & Customer"],
  ["Reviews & Feedback", "script", undefined, "Sales & Customer"],
  ["Marketing Automation", "script", undefined, "Sales & Customer"],
  ["Email Marketing", "script", undefined, "Sales & Customer"],
  // Commerce
  ["E-commerce", "script", undefined, "Commerce", "e-commerce"],
  ["Marketplace", "script", undefined, "Commerce"],
  ["Point of Sale (POS)", "script", undefined, "Commerce"],
  ["Inventory Management", "script", undefined, "Commerce"],
  ["Order Management", "script", undefined, "Commerce"],
  ["Product Management", "script", undefined, "Commerce"],
  ["Subscription Management", "script", undefined, "Commerce"],
  ["Procurement", "script", undefined, "Commerce"],
  ["Vendor Management", "script", undefined, "Commerce"],
  // Booking & Scheduling
  ["Booking & Reservations", "script", undefined, "Booking & Scheduling", "booking"],
  ["Appointment Scheduling", "script", undefined, "Booking & Scheduling"],
  ["Calendar Management", "script", undefined, "Booking & Scheduling"],
  ["Rental Management", "script", undefined, "Booking & Scheduling"],
  ["Queue Management", "script", undefined, "Booking & Scheduling"],
  // HR & Workforce
  ["HR Management", "script", undefined, "HR & Workforce", "hr-and-rota"],
  ["Rota & Shift Management", "script", undefined, "HR & Workforce"],
  ["Attendance & Time Tracking", "script", undefined, "HR & Workforce"],
  ["Payroll", "script", undefined, "HR & Workforce"],
  ["Recruitment & Hiring", "script", undefined, "HR & Workforce"],
  ["Employee Management", "script", undefined, "HR & Workforce"],
  ["Leave Management", "script", undefined, "HR & Workforce"],
  // Finance
  ["Accounting", "script", undefined, "Finance"],
  ["Billing & Invoicing", "script", undefined, "Finance"],
  ["Payments", "script", undefined, "Finance"],
  ["Expense Management", "script", undefined, "Finance"],
  ["Budgeting", "script", undefined, "Finance"],
  ["Financial Management", "script", undefined, "Finance"],
  ["Investment & Trading", "script", undefined, "Finance"],
  ["Banking & Fintech", "script", undefined, "Finance"],
  ["Fundraising & Donations", "script", undefined, "Finance"],
  // Property
  ["Property Management", "script", undefined, "Property"],
  ["Real Estate", "script", undefined, "Property"],
  ["Property Listing", "script", undefined, "Property"],
  ["Tenant Management", "script", undefined, "Property"],
  ["Facility Management", "script", undefined, "Property"],
  // Healthcare
  ["Hospital Management", "script", undefined, "Healthcare"],
  ["Clinic Management", "script", undefined, "Healthcare"],
  ["Patient Management", "script", undefined, "Healthcare"],
  ["Medical Records", "script", undefined, "Healthcare"],
  ["Pharmacy Management", "script", undefined, "Healthcare"],
  ["Laboratory Management", "script", undefined, "Healthcare"],
  ["Care Management", "script", undefined, "Healthcare"],
  // Education
  ["Learning Management (LMS)", "script", undefined, "Education"],
  ["School Management", "script", undefined, "Education"],
  ["Course Management", "script", undefined, "Education"],
  ["Examination & Assessment", "script", undefined, "Education"],
  ["Student Management", "script", undefined, "Education"],
  ["Library Management", "script", undefined, "Education"],
  // Logistics & Mobility
  ["Logistics Management", "script", undefined, "Logistics & Mobility", "logistics"],
  ["Delivery Management", "script", undefined, "Logistics & Mobility"],
  ["Fleet Management", "script", undefined, "Logistics & Mobility"],
  ["Transport Management", "script", undefined, "Logistics & Mobility"],
  ["Dispatch Management", "script", undefined, "Logistics & Mobility"],
  ["Courier Management", "script", undefined, "Logistics & Mobility"],
  ["Shipping", "script", undefined, "Logistics & Mobility"],
  ["Tracking", "script", undefined, "Logistics & Mobility"],
  ["Ride Booking", "script", undefined, "Logistics & Mobility"],
  // Food & Hospitality
  ["Restaurant Management", "script", undefined, "Food & Hospitality"],
  ["Food Ordering", "script", undefined, "Food & Hospitality"],
  ["Table Reservation", "script", undefined, "Food & Hospitality"],
  ["Hotel & Accommodation Management", "script", undefined, "Food & Hospitality"],
  ["Kitchen Management", "script", undefined, "Food & Hospitality"],
  // Content & Publishing
  ["CMS", "script", undefined, "Content & Publishing"],
  ["Blogging & Publishing", "script", undefined, "Content & Publishing"],
  ["News & Magazine", "script", undefined, "Content & Publishing"],
  ["Media Management", "script", undefined, "Content & Publishing"],
  ["File Management", "script", undefined, "Content & Publishing"],
  ["Digital Asset Management", "script", undefined, "Content & Publishing"],
  ["Video & Streaming", "script", undefined, "Content & Publishing"],
  ["Podcast & Audio", "script", undefined, "Content & Publishing"],
  // Community & Support
  ["Helpdesk & Support", "script", undefined, "Community & Support"],
  ["Live Chat & Messaging", "script", undefined, "Community & Support"],
  ["Social Network", "script", undefined, "Community & Support"],
  ["Community Platform", "script", undefined, "Community & Support"],
  ["Forum", "script", undefined, "Community & Support"],
  ["Membership", "script", undefined, "Community & Support"],
  ["Dating", "script", undefined, "Community & Support"],
  ["Classifieds", "script", undefined, "Community & Support"],
  ["Directory & Listings", "script", undefined, "Community & Support"],
  // Events
  ["Event Management", "script", undefined, "Events"],
  ["Event Booking", "script", undefined, "Events"],
  ["Ticketing", "script", undefined, "Events"],
  ["Venue Management", "script", undefined, "Events"],
  ["Conference Management", "script", undefined, "Events"],
  // Security & Access
  ["Authentication & User Management", "script", undefined, "Security & Access"],
  ["Access Control", "script", undefined, "Security & Access"],
  ["Identity & Verification", "script", undefined, "Security & Access"],
  ["Security Tools", "script", undefined, "Security & Access"],
  // Developer & Technical
  ["Developer Tools", "script", undefined, "Developer & Technical"],
  ["API & Backend", "script", undefined, "Developer & Technical"],
  ["API Management", "script", undefined, "Developer & Technical"],
  ["Database Tools", "script", undefined, "Developer & Technical"],
  ["Integration Tools", "script", undefined, "Developer & Technical"],
  ["DevOps & Deployment", "script", undefined, "Developer & Technical"],
  ["Monitoring & Logging", "script", undefined, "Developer & Technical"],
  ["Search", "script", undefined, "Developer & Technical"],
  ["File Upload & Storage", "script", undefined, "Developer & Technical"],
  ["Code Generation", "script", undefined, "Developer & Technical"],
  // AI
  ["AI Assistants", "script", undefined, "AI"],
  ["AI Content Generation", "script", undefined, "AI"],
  ["AI Chatbots", "script", undefined, "AI"],
  ["AI Automation", "script", undefined, "AI"],
  ["AI Image Tools", "script", undefined, "AI"],
  ["AI Audio & Voice", "script", undefined, "AI"],
  ["AI Video Tools", "script", undefined, "AI"],
  ["AI Productivity", "script", undefined, "AI"],
  ["AI Developer Tools", "script", undefined, "AI"],
  // Utilities
  ["Calculators", "script", undefined, "Utilities"],
  ["Converters", "script", undefined, "Utilities"],
  ["URL & Link Management", "script", undefined, "Utilities"],
  ["QR Code Tools", "script", undefined, "Utilities"],
  ["Notification Systems", "script", undefined, "Utilities"],
  ["Backup Tools", "script", undefined, "Utilities"],
  ["Import & Export Tools", "script", undefined, "Utilities"],
  // Business & Corporate
  ["Corporate", "template", undefined, "Business & Corporate", "corporate-and-business"],
  ["Small Business", "template", undefined, "Business & Corporate"],
  ["Startup", "template", undefined, "Business & Corporate"],
  ["Agency", "template", undefined, "Business & Corporate"],
  ["Consulting", "template", undefined, "Business & Corporate"],
  ["Professional Services", "template", undefined, "Business & Corporate"],
  // E-commerce & Store
  ["Online Store", "template", undefined, "E-commerce & Store", "ecommerce-pages"],
  ["Fashion & Apparel Store", "template", undefined, "E-commerce & Store"],
  ["Electronics Store", "template", undefined, "E-commerce & Store"],
  ["Furniture & Home Store", "template", undefined, "E-commerce & Store"],
  ["Grocery & Food Store", "template", undefined, "E-commerce & Store"],
  ["Single Product", "template", undefined, "E-commerce & Store"],
  ["Multi-vendor Store", "template", undefined, "E-commerce & Store"],
  // Portfolio & Creative
  ["Portfolio", "template", undefined, "Portfolio & Creative"],
  ["Personal Portfolio", "template", undefined, "Portfolio & Creative"],
  ["Designer Portfolio", "template", undefined, "Portfolio & Creative"],
  ["Developer Portfolio", "template", undefined, "Portfolio & Creative"],
  ["Photography", "template", undefined, "Portfolio & Creative"],
  ["Art & Illustration", "template", undefined, "Portfolio & Creative"],
  ["Creative Agency", "template", undefined, "Portfolio & Creative"],
  // Landing & Marketing Pages
  ["Landing Page", "template", undefined, "Landing & Marketing Pages", "landing-pages"],
  ["Product Landing Page", "template", undefined, "Landing & Marketing Pages"],
  ["App Landing Page", "template", undefined, "Landing & Marketing Pages"],
  ["SaaS Landing Page", "template", undefined, "Landing & Marketing Pages"],
  ["Lead Generation", "template", undefined, "Landing & Marketing Pages"],
  ["Coming Soon", "template", undefined, "Landing & Marketing Pages"],
  ["Pricing Page", "template", undefined, "Landing & Marketing Pages"],
  // Admin & Application UI
  ["Admin Dashboard", "template", undefined, "Admin & Application UI", "admin-dashboards"],
  ["CRM Dashboard", "template", undefined, "Admin & Application UI"],
  ["Analytics Dashboard", "template", undefined, "Admin & Application UI"],
  ["E-commerce Dashboard", "template", undefined, "Admin & Application UI"],
  ["Finance Dashboard", "template", undefined, "Admin & Application UI"],
  ["Project Management Dashboard", "template", undefined, "Admin & Application UI"],
  ["SaaS Dashboard", "template", undefined, "Admin & Application UI"],
  ["Application UI", "template", undefined, "Admin & Application UI"],
  // Blog & Publishing
  ["Blog", "template", undefined, "Blog & Publishing"],
  ["Online Magazine", "template", undefined, "Blog & Publishing"],
  ["Podcast", "template", undefined, "Blog & Publishing"],
  ["Publishing", "template", undefined, "Blog & Publishing"],
  // Directory & Listing
  ["Business Directory", "template", undefined, "Directory & Listing"],
  ["Classified Ads", "template", undefined, "Directory & Listing"],
  ["Job Board", "template", undefined, "Directory & Listing"],
  ["Property Directory", "template", undefined, "Directory & Listing"],
  ["Service Directory", "template", undefined, "Directory & Listing"],
  ["Local Directory", "template", undefined, "Directory & Listing"],
  // Personal & Resume
  ["Personal Website", "template", undefined, "Personal & Resume"],
  ["Personal Blog", "template", undefined, "Personal & Resume"],
  ["Resume & CV", "template", undefined, "Personal & Resume"],
  ["Freelancer", "template", undefined, "Personal & Resume"],
  // Events & Booking
  ["Event & Conference", "template", undefined, "Events & Booking"],
  ["Booking & Reservation", "template", undefined, "Events & Booking"],
  ["Venue", "template", undefined, "Events & Booking"],
  ["Wedding", "template", undefined, "Events & Booking"],
  // Education & Learning
  ["School & University", "template", undefined, "Education & Learning"],
  ["Online Course", "template", undefined, "Education & Learning"],
  ["E-learning Platform", "template", undefined, "Education & Learning"],
  ["Training & Coaching", "template", undefined, "Education & Learning"],
  // Community & Nonprofit
  ["Community", "template", undefined, "Community & Nonprofit"],
  ["Membership Site", "template", undefined, "Community & Nonprofit"],
  ["Charity & Nonprofit", "template", undefined, "Community & Nonprofit"],
  ["Church & Religious", "template", undefined, "Community & Nonprofit"],
  ["Fundraising", "template", undefined, "Community & Nonprofit"],
  // Utility Pages
  ["404 & Error Pages", "template", undefined, "Utility Pages"],
  ["Login & Registration", "template", undefined, "Utility Pages"],
  ["Under Construction", "template", undefined, "Utility Pages"],
  ["Maintenance", "template", undefined, "Utility Pages"],
  ["Email Template", "template", undefined, "Utility Pages"],
  // Mobile Apps — the "App" suffix is doing real work, not decoration: `Chat`,
  // `Booking` and `Marketplace` already exist as categories, and slugs are unique
  // per *kind* across both catalogues.
  ["Food Delivery App", "script", undefined, "Mobile Apps"],
  ["Ride Hailing App", "script", undefined, "Mobile Apps"],
  ["Fitness & Wellness App", "script", undefined, "Mobile Apps"],
  ["Social App", "script", undefined, "Mobile Apps"],
  ["Chat App", "script", undefined, "Mobile Apps"],
  ["Wallet & Payments App", "script", undefined, "Mobile Apps"],
  ["Booking App", "script", undefined, "Mobile Apps"],
  ["Learning App", "script", undefined, "Mobile Apps"],
  ["E-commerce App", "script", undefined, "Mobile Apps"],
  // Mobile App UI
  ["App Screens", "template", undefined, "Mobile App UI"],
  ["Onboarding Flow", "template", undefined, "Mobile App UI"],
  ["Mobile UI Kit", "template", undefined, "Mobile App UI"],
  ["App Store Listing", "template", undefined, "Mobile App UI"],
];

const industries: Array<[string, string?]> = [
  ["Agriculture"],
  ["Architecture"],
  ["Automotive"],
  ["Aviation"],
  ["Beauty & Cosmetics"],
  ["Car Dealership & Rental"],
  ["Construction"],
  ["Consulting"],
  ["Dental"],
  ["Education"],
  ["Energy & Utilities"],
  ["Entertainment & Media"],
  ["Environmental & Sustainability"],
  ["Events"],
  ["Fashion & Apparel"],
  ["Finance & Fintech", "finance"],
  ["Fitness & Gym"],
  ["Food & Beverage"],
  ["Gaming & Esports"],
  ["Government & Public Sector"],
  ["Healthcare"],
  ["Home & Trade Services"],
  ["Hospitality"],
  ["Hotel & Accommodation"],
  ["Insurance"],
  ["Interior Design"],
  ["Legal"],
  ["Logistics & Transportation", "logistics"],
  ["Manufacturing"],
  ["Marketing & Advertising"],
  ["Music & Performing Arts"],
  ["Nonprofit & Charity", "nonprofit"],
  ["Pharmacy"],
  ["Professional Services"],
  ["Property & Real Estate", "property"],
  ["Recruitment & Staffing"],
  ["Restaurant & Café"],
  ["Retail"],
  ["Salon, Spa & Wellness"],
  ["Sports"],
  ["Technology & SaaS"],
  ["Telecommunications"],
  ["Travel & Tourism"],
];

const technologies: Array<[string, string?]> = [
  // Languages & Core Web
  ["HTML5"],
  ["CSS3"],
  ["JavaScript"],
  ["TypeScript"],
  ["PHP"],
  ["Python"],
  ["Java"],
  ["C#", "c-sharp"],
  ["Dart"],
  ["Ruby"],
  ["Go"],
  ["Kotlin"],
  ["Swift"],
  // Frontend
  ["React"],
  ["Next.js"],
  ["Vue"],
  ["Nuxt"],
  ["Angular"],
  ["Svelte"],
  ["SvelteKit"],
  ["Alpine.js"],
  ["jQuery"],
  // CSS & UI
  ["Bootstrap"],
  ["Tailwind CSS"],
  ["Material UI"],
  ["Chakra UI"],
  ["Sass / SCSS"],
  // Backend & Full Stack
  ["Laravel"],
  ["Symfony"],
  ["CodeIgniter"],
  ["Node.js"],
  ["Express.js"],
  ["NestJS"],
  ["Django"],
  ["Flask"],
  ["FastAPI"],
  ["Ruby on Rails"],
  ["ASP.NET"],
  ["Spring Boot"],
  ["Electron"],
  // Databases
  ["MySQL"],
  ["PostgreSQL"],
  ["MongoDB"],
  ["SQLite"],
  ["MariaDB"],
  ["Microsoft SQL Server"],
  ["Firebase"],
  ["Supabase"],
  // Cache & Infrastructure
  ["Redis"],
  ["Elasticsearch"],
  ["Docker"],
  // CMS & Commerce Platforms
  ["WordPress"],
  ["WooCommerce"],
  ["Shopify"],
  ["Magento"],
  ["Drupal"],
  ["Joomla"],
  ["Webflow"],
  // Mobile
  ["Flutter"],
  ["React Native"],
  ["Android"],
  ["iOS"],
  ["Ionic"],
  // Payments & Services
  ["Stripe"],
  ["PayPal"],
  ["Flutterwave"],
  ["Paystack"],
  // APIs & Architecture
  ["REST API"],
  ["GraphQL"],
  ["WebSockets"],
];

const productTypes: Array<[string, string?]> = [
  ["Complete Application"],
  ["Admin Panel / Dashboard", "admin-panel"],
  ["Starter Kit / Boilerplate", "starter-kit"],
  ["Plugin"],
  ["Module / Add-on", "module"],
  ["Integration"],
  ["Component"],
  ["UI Kit"],
  ["API / Backend"],
  ["Mobile Application"],
];

/**
 * Flattened, in the order the pickers and the rail read.
 *
 * **Parents before children**, and it is load-bearing twice. A consumer cannot
 * set a child's `parentId` until the parent has an id, so every one of them
 * resolves parents in a second pass — listing parents first means that pass has
 * something to find whatever order the consumer iterates in. And `sortOrder`
 * carries the same order into `getTaxonomyIndex`, which is what makes the
 * grouped picker read as a tree rather than as a shuffled list.
 */
export const TAXONOMY_VOCABULARY: readonly VocabularyTerm[] = [
  ...categoryParents.map(({ name, slug, catalogue, description }, index) => ({
    kind: "category" as const,
    name,
    slug,
    catalogue,
    description,
    sortOrder: index,
  })),
  ...categories.map(([name, catalogue, description, parent, slug], index) => ({
    kind: "category" as const,
    name,
    catalogue,
    ...(description ? { description } : {}),
    ...(parent ? { parent } : {}),
    ...(slug ? { slug } : {}),
    // Offset past the parents, so `{sortOrder, name}` keeps the tiers apart
    // rather than interleaving them.
    sortOrder: categoryParents.length + index,
  })),
  // Industries are shared: Healthcare is an industry whichever shop you are in.
  ...industries.map(([name, slug], index) => ({
    kind: "industry" as const,
    name,
    catalogue: "both" as const,
    ...(slug ? { slug } : {}),
    sortOrder: index,
  })),
  ...technologies.map(([name, slug], index) => ({
    kind: "technology" as const,
    name,
    catalogue: "both" as const,
    ...(slug ? { slug } : {}),
    sortOrder: index,
  })),
  ...productTypes.map(([name, slug], index) => ({
    kind: "product_type" as const,
    name,
    catalogue: "both" as const,
    ...(slug ? { slug } : {}),
    sortOrder: index,
  })),
];

/** The `product_type` slug the catalogue field replaced. Deactivated, not deleted. */
export const RETIRED_PRODUCT_TYPE_SLUG = "template";

/**
 * Terms this vocabulary drops, which cannot simply be deleted.
 *
 * `deleteTaxonomy` refuses while any product references a term, and these are
 * referenced — so the backfill **deactivates** them instead. An inactive term
 * keeps resolving for the products that hold it (`slugsByIds` does not filter on
 * `isActive`), so nothing loses a facet; it just stops being offered.
 */
export const RETIRED_TERMS: ReadonlyArray<{
  kind: TaxonomyKind;
  slug: string;
  reason: string;
}> = [
  {
    kind: "product_type",
    slug: RETIRED_PRODUCT_TYPE_SLUG,
    reason:
      "Whether something is a template is which shop it is in, not what kind of thing it is.",
  },
  {
    kind: "product_type",
    slug: "script",
    reason: "'Complete Application' says the same thing and distinguishes it from a plugin.",
  },
];

/**
 * Auto-created strays, and the canonical term each one is now the same thing as.
 *
 * `seed-bulk.ts` used to invent a term whenever its weights named a slug this
 * list did not have, which is how `nextjs` came to exist beside `next-js` and
 * `node` beside `node-js`. Both halves are real terms with real products, so the
 * backfill **merges** rather than deactivating: it repoints every referencing
 * product at the canonical id, then turns the stray off.
 *
 * Deactivating alone would have been the cheaper edit and the wrong one — the
 * stray is the *popular* one in a bulk-seeded database, so the products would
 * have kept a facet pointing at a term the rail no longer offers.
 */
/**
 * Slugs that were written wrong and have to move.
 *
 * Not a general rename mechanism — a slug is stable by policy, and moving one
 * throws away whatever ranking it has. This list is for the narrow case where a
 * slug was **never correct**: it names a term nothing links to yet, produced by a
 * bug rather than by a decision.
 *
 * The one entry is the first non-ASCII name this vocabulary has ever carried.
 * `seed.ts`, `prod-bootstrap.ts` and the backfill each kept a private copy of
 * `slugify` — deliberately, and documented as such — and every copy was missing
 * the NFKD normalisation the real one has. They agreed for 37 ASCII terms and
 * diverged on the thirty-eighth: "Restaurant & Café" became `restaurant-and-caf`
 * from a seed and `restaurant-and-cafe` from the admin screen, which is two
 * spellings of one rule and exactly what those copies were warned against.
 *
 * All three now import `src/lib/slug`. This moves the row they already wrote.
 */
export const RENAMED_SLUGS: ReadonlyArray<{
  kind: TaxonomyKind;
  from: string;
  to: string;
}> = [{ kind: "industry", from: "restaurant-and-caf", to: "restaurant-and-cafe" }];

export const MERGED_TERMS: ReadonlyArray<{
  kind: TaxonomyKind;
  from: string;
  into: string;
}> = [
  { kind: "technology", from: "nextjs", into: "next-js" },
  { kind: "technology", from: "node", into: "node-js" },
];
