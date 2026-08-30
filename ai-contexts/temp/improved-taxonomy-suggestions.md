# CoSetup Marketplace Taxonomy — revised

A revision of `taxonomy-suggestion.md`, restructured for a **two-tier** model
(parent → child) that maps one-to-one onto the URL scheme in
`new-taxonom-plan.md`:

```
/marketplace/{parent}                 e.g. /marketplace/logistics-mobility
/marketplace/{parent}/{child}         e.g. /marketplace/logistics-mobility/fleet-management
```

The original document is good work and most of it survives. What changes is
driven by four constraints the original could not have known about — the third of
which only surfaced when the vocabulary was actually loaded into the database.

---

## The four constraints

**1. A child belongs to exactly one parent.**

The URL *is* the hierarchy, so a term in two groups produces two URLs for one
thing — `/marketplace/commerce/payments` and `/marketplace/finance/payments` —
which is duplicate content competing with itself. The original has nine such
terms. Each is resolved below, and the rule is stated once here so the next
addition obeys it.

**2. Templates must not restate Industry.**

Eleven of the original's eighteen template groups are industries by another name:
Technology, E-commerce & Retail, Professional Services, Property & Construction,
Healthcare & Wellness, Education, Food & Hospitality, Automotive & Transport,
Entertainment, Media & Publishing, Nonprofit & Community.

That is not a small overlap — it is most of the axis. Two dimensions encoding one
fact will disagree the first time somebody tags a product with only one of them.

The fix is not to strip industry flavour from templates — buyers genuinely search
"restaurant website template", and pretending otherwise would be purism. It is to
put that query on the **industry** axis, which the routing plan gives its own
landing page:

| Query | Where it lands |
|---|---|
| "restaurant website template" | `/templates/industry/restaurant-cafe` |
| "landing page template" | `/templates/landing-marketing-pages` |
| "restaurant landing page" | filters, or a pair page if inventory earns one |

So Template **categories answer "what kind of thing is it"**, and Industry
answers "who is it for". One fact, one place.

**3. A slug is unique per *kind*, not per catalogue.**

Discovered on implementation, and it invalidates five pairs. `taxonomies` has a
unique index on `{kind, slug}` — categories are one kind whichever shop they are
in — so an application "Marketplace" and a template "Marketplace" cannot both
exist. The five: **Marketplace**, **Classifieds**, **Membership**, **News &
Magazine** and **Property Listing**.

The fix follows the distinction this document already draws between `E-commerce`
and `Ecommerce pages` — *software that sells* versus *pages that look like a
shop*. Four template terms are renamed to say which they are, and the fifth was a
genuine duplicate:

| Application term | Template term becomes |
|---|---|
| Marketplace *(Commerce)* | **Multi-vendor Store** *(E-commerce & Store)* |
| Classifieds *(Community & Support)* | **Classified Ads** *(Directory & Listing)* |
| Membership *(Community & Support)* | **Membership Site** *(Community & Nonprofit)* |
| Property Listing *(Property)* | **Property Directory** *(Directory & Listing)* |
| News & Magazine *(Content & Publishing)* | **removed** — Blog & Publishing already lists *Online Magazine*, so the template side carried the same thing twice |

That last one is the reason template children are 67 rather than 68.

**4. Every term has to render.**

The filter rail draws every term of every dimension with no cap, by design. The
counts below are chosen so the rail stays a control rather than a document, and
so a category navbar can hold the parent row.

---

## What this comes to

| Dimension | Original | Revised | Shape |
|---|---|---|---|
| Application categories | 149 in 18 groups | **18 parents, 133 children** | two-tier |
| Template categories | 135 in 18 groups | **12 parents, 67 children** | two-tier |
| Industries | 30 | **43** | flat; +13 for template search demand |
| Technologies | 72 in 11 groups | **70 in 10 groups** | flat vocabulary, grouped for display |
| Product types | 12 | **10** | flat |

Only the **parents** (30 across both catalogues) go in the navbar and get a
top-level URL. Children are the second segment, and the filter rail shows the
children of whichever parent is in scope rather than all of them at once.

---

# 1. CATEGORIES — APPLICATIONS & SCRIPTS

18 parents. Changes from the original are marked; everything unmarked is
unchanged.

## Business & Operations
- CRM
- ERP
- Business Management
- Project Management
- Task Management
- Workflow & Automation *(merged: "Workflow Management" + "Automation" from Developer Tools — the same product to a buyer)*
- Operations Management
- Document Management
- Knowledge Base
- Forms & Surveys
- Reporting & Analytics
- Admin & Back Office

*Dropped: "Office Management" — nothing distinguishes it from Business Management.*

## Sales & Customer
- Sales Management
- Lead Management
- Customer Portal
- Loyalty & Rewards
- Reviews & Feedback
- Marketing Automation
- Email Marketing

*Dropped: "Customer Management" — it is CRM under a second name.*
*Moved out: Helpdesk & Support, Live Chat & Messaging → Support & Community.*

## Commerce
- E-commerce
- Marketplace
- Point of Sale (POS)
- Inventory Management
- Order Management
- Product Management
- Subscription Management
- Procurement
- Vendor Management

*Moved out: "Billing & Invoicing" and "Payments" → Finance. Both appeared twice in the original; Finance is where a buyer looks for them.*

## Booking & Scheduling
- Booking & Reservations
- Appointment Scheduling
- Calendar Management
- Rental Management
- Queue Management

*Moved out: "Ticketing" → Events (it appeared in both).*
*Renamed: "Calendar & Events" → "Calendar Management", so it does not shadow the Events parent.*

## HR & Workforce
- HR Management
- Rota & Shift Management
- Attendance & Time Tracking
- Payroll
- Recruitment & Hiring
- Employee Management
- Leave Management

*Dropped: "Workforce Management" — indistinguishable from HR Management plus Rota.*

## Finance
- Accounting
- Billing & Invoicing
- Payments
- Expense Management
- Budgeting
- Financial Management
- Investment & Trading
- Banking & Fintech
- Fundraising & Donations

## Property
- Property Management
- Real Estate
- Property Listing
- Tenant Management
- Facility Management

*Moved out: "Hotel & Accommodation Management" → Food & Hospitality, which already had "Hotel Management".*

## Healthcare
- Hospital Management
- Clinic Management
- Patient Management
- Medical Records
- Pharmacy Management
- Laboratory Management
- Care Management

*Dropped: "Appointment Management" — it is Appointment Scheduling under Booking. A healthcare buyer reaches it through the Healthcare **industry**, which is the axis that exists for exactly this.*

## Education
- Learning Management (LMS)
- School Management
- Course Management
- Examination & Assessment
- Student Management
- Library Management

*Dropped: "E-learning" — a synonym of LMS at this level. It stays useful as search vocabulary.*

## Logistics & Mobility
- Logistics Management
- Delivery Management
- Fleet Management
- Transport Management
- Dispatch Management
- Courier Management
- Shipping
- Tracking
- Ride Booking

## Food & Hospitality
- Restaurant Management
- Food Ordering
- Table Reservation
- Hotel & Accommodation Management
- Kitchen Management

*Dropped: "Hospitality Management" — the parent already says it.*

## Content & Publishing
- CMS
- Blogging & Publishing
- News & Magazine
- Media Management
- File Management
- Digital Asset Management
- Video & Streaming
- Podcast & Audio

## Community & Support
- Helpdesk & Support
- Live Chat & Messaging
- Social Network
- Community Platform
- Forum
- Membership
- Dating
- Classifieds
- Directory & Listings

*Renamed from "Community & Communication" and merged with the support terms — a helpdesk and a forum are the same shelf to a buyer.*
*Dropped: "Messaging & Chat" — same term as Live Chat & Messaging.*

## Events
- Event Management
- Event Booking
- Ticketing
- Venue Management
- Conference Management

## Security & Access
- Authentication & User Management
- Access Control
- Identity & Verification
- Security Tools

*Renamed: "Membership & Access Control" → "Access Control" (Membership lives under Community).*
*Moved out: "Monitoring & Logging" → Developer & Technical, which also had "Monitoring".*

## Developer & Technical
- Developer Tools
- API & Backend
- API Management
- Database Tools
- Integration Tools
- DevOps & Deployment *(merged: "DevOps" + "Deployment")*
- Monitoring & Logging
- Search
- File Upload & Storage
- Code Generation

*Moved out: "Automation" → Business & Operations.*

## AI
- AI Assistants
- AI Content Generation
- AI Chatbots
- AI Automation
- AI Image Tools
- AI Audio & Voice
- AI Video Tools
- AI Productivity
- AI Developer Tools

*Kept whole. It is the one group where the market is moving fast enough that granularity earns its keep, and the terms are what people actually type.*

## Utilities
- Calculators
- Converters
- URL & Link Management
- QR Code Tools
- Notification Systems
- Backup Tools
- Import & Export Tools

*Dropped: "Search Tools" (Developer & Technical has "Search") and "Miscellaneous Utilities" (see the note on "Other" below).*

---

# 2. CATEGORIES — WEBSITE TEMPLATES

**12 parents, organised by what the thing is** — not by who it is for. Industry
carries that, and gets its own landing pages.

## Business & Corporate
- Corporate
- Small Business
- Startup
- Agency
- Consulting
- Professional Services

## E-commerce & Store
- Online Store
- Fashion & Apparel Store
- Electronics Store
- Furniture & Home Store
- Grocery & Food Store
- Single Product
- Marketplace

## Portfolio & Creative
- Portfolio
- Personal Portfolio
- Designer Portfolio
- Developer Portfolio
- Photography
- Art & Illustration
- Creative Agency

## Landing & Marketing Pages
- Landing Page
- Product Landing Page
- App Landing Page
- SaaS Landing Page
- Lead Generation
- Coming Soon
- Pricing Page

## Admin & Application UI
- Admin Dashboard
- CRM Dashboard
- Analytics Dashboard
- E-commerce Dashboard
- Finance Dashboard
- Project Management Dashboard
- SaaS Dashboard
- Application UI

## Blog & Publishing
- Blog
- News & Magazine
- Online Magazine
- Podcast
- Publishing

## Directory & Listing
- Business Directory
- Classifieds
- Job Board
- Property Listing
- Service Directory
- Local Directory

## Personal & Resume
- Personal Website
- Personal Blog
- Resume & CV
- Freelancer

## Events & Booking
- Event & Conference
- Booking & Reservation
- Venue
- Wedding

## Education & Learning
- School & University
- Online Course
- E-learning Platform
- Training & Coaching

## Community & Nonprofit
- Community
- Membership
- Charity & Nonprofit
- Church & Religious
- Fundraising

## Utility Pages
- 404 & Error Pages
- Login & Registration
- Under Construction
- Maintenance
- Email Template

### What moved to Industry instead

Thirty-one template *categories* in the original were industries wearing a
category's clothes. They are now served by `/templates/industry/{slug}`, which the
routing plan creates.

**The rule, restated, because it is the one that is easy to get wrong:** a
category moves to Industry only if an industry exists **at the same
specificity**. Where none did, section 3 adds one rather than collapsing the term
into a broader word nobody searches. Never both — a term is a category or an
industry, not each.

| Template category | Industry it becomes | |
|---|---|---|
| Hospital & Clinic, Doctor & Medical | Healthcare | |
| Dentist | **Dental** | ✦ added |
| Pharmacy | **Pharmacy** | ✦ added |
| Restaurant & Cafe | **Restaurant & Café** | ✦ added |
| Hotel & Resort, Vacation & Accommodation | **Hotel & Accommodation** | ✦ added |
| Fitness & Gym, Yoga & Wellness | **Fitness & Gym** | ✦ added |
| Beauty & Spa | **Salon, Spa & Wellness** | ✦ added |
| Architecture | **Architecture** | ✦ added |
| Interior Design | **Interior Design** | ✦ added |
| Car Dealer, Car Rental | **Car Dealership & Rental** | ✦ added |
| Gaming | **Gaming & Esports** | ✦ added |
| Music & Band | **Music & Performing Arts** | ✦ added |
| Cleaning Services, Home Services, Repair & Maintenance | **Home & Trade Services** | ✦ added |
| Environmental | **Environmental & Sustainability** | ✦ added |
| Health & Wellness | Healthcare | |
| Real Estate, Property Management | Property & Real Estate | |
| Construction, Building & Renovation | Construction | |
| Automotive, Auto Repair | Automotive | |
| Legal & Law Firm | Legal | |
| Accounting & Finance | Finance & Fintech | |
| Insurance | Insurance | |
| Recruitment & HR | Recruitment & Staffing | |
| Security Services | Professional Services | |
| Government, Political | Government & Public Sector | |
| Film & Video | Entertainment & Media | |
| Sports | Sports | |
| Travel & Tourism | Travel & Tourism | |

**The four that stayed categories**, because the category already contains the
searched word and adding an industry would duplicate it: *Wedding* (Events &
Booking), *Church & Religious* and *Charity & Nonprofit* (Community & Nonprofit),
*Photography* (Portfolio & Creative).

A template for a dentist is a **Business & Corporate** or **Landing** template in
the *Dental* industry. That is one product, two true facts, and one URL each —
and `/templates/industry/dental` says the word the buyer typed.

---

# 3. INDUSTRIES — SHARED

**43 terms: the original 30, plus 13 the template market actually searches for.**

The original list is a good *B2B* industry vocabulary and it was written for the
applications catalogue, where it is exactly right. Borrowing it unchanged for
templates was my mistake in the first draft of this document, and it cost the
thing this taxonomy exists to win.

## Why it had to grow

The first draft moved 31 industry-flavoured template categories onto this axis
and collapsed them into ~15 generic terms. Test it against a real query:

> **"hospital management website templates"**

- Template categories: no "Hospital" — it had moved here
- Industries: only "Healthcare"
- "Hospital Management" survives, but as an *application* category

Best URL: `/templates/industry/healthcare` — and the word **hospital** appears
nowhere in it. The same happens to *"restaurant website template"*, one of the
highest-volume queries in this market, which had no page saying "restaurant" at
all.

Deduplicating categories against industries was right. Collapsing to a generic
30 was too far. An industry list for a template marketplace is not the same list
as an industry list for enterprise software, and it should be tuned for the
queries people type.

## The rule this produces

**A template category moves to Industry only if an industry exists at the same
specificity.** If collapsing it would lose the word somebody searches for,
either the industry gains that term, or the category keeps it. Never both.

## The list

*Added (13), marked ✦. One rename: "Sports & Fitness" → "Sports", so it no longer
overlaps the new "Fitness & Gym".*

Agriculture · Architecture ✦ · Automotive · Aviation · Beauty & Cosmetics ·
Car Dealership & Rental ✦ · Construction · Consulting ·
Dental ✦ · Education · Energy & Utilities · Entertainment & Media ·
Environmental & Sustainability ✦ · Events · Fashion & Apparel ·
Finance & Fintech · Fitness & Gym ✦ · Food & Beverage · Gaming & Esports ✦ ·
Government & Public Sector · Healthcare · Home & Trade Services ✦ · Hospitality ·
Hotel & Accommodation ✦ · Insurance · Interior Design ✦ · Legal · Logistics &
Transportation · Manufacturing · Marketing & Advertising ·
Music & Performing Arts ✦ · Nonprofit & Charity · Pharmacy ✦ ·
Professional Services · Property & Real Estate · Recruitment & Staffing ·
Restaurant & Café ✦ · Retail · Salon, Spa & Wellness ✦ · Sports ·
Technology & SaaS · Telecommunications · Travel & Tourism

## Where the pairs are deliberate

Several of these sit next to a broader term, and the pairing is the point — one
is the sector, the other is the thing people search:

| Broad | Specific | Why both |
|---|---|---|
| Healthcare | Dental, Pharmacy | "dental website template" is its own query; "healthcare" still covers hospitals and health systems |
| Hospitality | Hotel & Accommodation | Hospitality is the sector; a hotel is what gets searched |
| Food & Beverage | Restaurant & Café | F&B is production and supply; a restaurant is a venue |
| Automotive | Car Dealership & Rental | The industry vs the two site types that dominate it |
| Beauty & Cosmetics | Salon, Spa & Wellness | A product industry vs a service business |
| Construction | Architecture, Interior Design | Adjacent professions with distinct audiences and distinct queries |
| Entertainment & Media | Gaming & Esports, Music & Performing Arts | Both carry real volume on their own |

A product may of course carry both — "Healthcare" *and* "Dental" — and the
primary is what drives its breadcrumb.

**"Church & Religious" is the rule going the other way.** It has real volume and
no industry at its specificity — but it is already a template *category*, at
`/templates/community-nonprofit/church-religious`, and that URL contains the
word. The query is answered, so no industry is added. Never both.

---

# 4. TECHNOLOGIES — SHARED

**70 terms, flat, grouped only for display.** Technology is not a browse
hierarchy — nobody navigates *to* "Backend" — so the groups below are headings in
a picker, not URL segments. There are no `/marketplace/backend/laravel` pages.

**Two removals**, both because they are not what a buyer filters on:
`Foundation` and `Bulma`, which is effectively dead. One group goes too —
`Electron` was a "Desktop" section of one, and folds into Backend & Full Stack.
So 72 terms in 11 groups becomes **70 in 10**.

*(An earlier draft of this section claimed four removals and 68 terms. It listed
`Alpine.js` and `C#` among them and then kept both, which is why the arithmetic
disagreed with the list underneath it. The list was right.)*

### Languages & Core Web
HTML5 · CSS3 · JavaScript · TypeScript · PHP · Python · Java · C# · Dart · Ruby ·
Go · Kotlin · Swift

### Frontend
React · Next.js · Vue · Nuxt · Angular · Svelte · SvelteKit · Alpine.js · jQuery

### CSS & UI
Bootstrap · Tailwind CSS · Material UI · Chakra UI · Sass / SCSS

### Backend & Full Stack
Laravel · Symfony · CodeIgniter · Node.js · Express.js · NestJS · Django · Flask ·
FastAPI · Ruby on Rails · ASP.NET · Spring Boot · Electron

### Databases
MySQL · PostgreSQL · MongoDB · SQLite · MariaDB · Microsoft SQL Server ·
Firebase · Supabase

### Cache & Infrastructure
Redis · Elasticsearch · Docker

### CMS & Commerce Platforms
WordPress · WooCommerce · Shopify · Magento · Drupal · Joomla · Webflow

### Mobile
Flutter · React Native · Android · iOS · Ionic

### Payments & Services
Stripe · PayPal · Flutterwave · Paystack

### APIs & Architecture
REST API · GraphQL · WebSockets

> **UI blocker, not a taxonomy problem.** The vendor wizard renders technologies
> in a flat scrolling grid with **no search**, while categories and industries get
> the searchable `MultiSelect`. 68 terms in that grid is unusable. Switching
> technologies to `MultiSelect` is a prerequisite for this section, and it is a
> component swap rather than a redesign.

---

# 5. PRODUCT TYPES — SHARED

**10 terms.** Two removals.

- Complete Application
- Admin Panel / Dashboard
- Starter Kit / Boilerplate
- Plugin
- Module / Add-on
- Integration
- Component
- UI Kit
- API / Backend
- Mobile Application

*Removed: **"Website Template"** and **"PWA"**.*

"Website Template" duplicates `catalogue`, which is already a first-class axis
driving two separate storefronts, two listing pages and two category trees. A
second encoding of the same fact can disagree with the first, and then something
has to decide which wins. "Complete Application" is kept because it distinguishes
a whole app from a plugin *within* the script catalogue — that is information
`catalogue` does not carry.

"PWA" is a delivery characteristic, not a type — a PWA is a Complete Application
or a Mobile Application. It belongs in Technologies if anywhere.

---

# 6. Rules

**A child belongs to exactly one parent.** The URL is the hierarchy; two parents
means two URLs for one thing.

**One primary category, then extras.** The primary drives the breadcrumb, the
canonical and the JSON-LD. The model has no notion of this today —
`categoryIds[]` has no ordering semantics — so it needs adding. See the plan.

**A product may carry a parent alone.** Not everything has a sensible child, and
forcing one produces noise. `/marketplace/finance` lists everything under
Finance, children included.

**No "Other", and no "Miscellaneous".** A category nobody should pick and
everybody will. If a product genuinely fits nothing, the answer is a missing
category, and that is worth discovering rather than absorbing.

**Categories are not keywords** — the original's rule, and it matters more now.
Terms that did not survive the cuts above ("E-learning", "Hospitality
Management", "Search Tools") are not lost: they are exactly what the `q=` search
box and the search-landing suggestion chips are for, and they work better there
than as checkboxes nobody scrolls to.

**Slugs are stable and hyphenated**, derived once and never re-derived from a
renamed term — a category URL that moves takes its rankings with it. A rename
changes `name`, never `slug`.
