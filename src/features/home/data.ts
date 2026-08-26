import type { Route } from "next";

/**
 * The homepage's constants.
 *
 * Everything here is *editorial* — the words and the routes the page offers.
 * Nothing here is inventory: product names, prices and free/paid states all come
 * from the catalogue at render time, because a hardcoded price on this page is a
 * screenshot in a complaint. That distinction is why the earlier version's
 * hero rows were deliberately de-named, and it still holds.
 *
 * `as const` throughout so each `href` stays a string *literal*. Widened to
 * `string` they would fail `typedRoutes` — and, worse, a typo would stop being a
 * compile error.
 */

/**
 * The three focal points COS-7 names, in the order the ticket names them.
 *
 * A fourth — selling — is deliberately *not* here. It is a different audience,
 * and giving it a fourth equally-loud card is the mistake the brief calls out:
 * four shouting buttons and no hierarchy. It gets a quiet line under these and a
 * band of its own further down.
 *
 * An `icon`, not a photograph. These three sit directly beneath the headline and
 * the search box, and three large stock images there is exactly the "decorative
 * media competing with the CTA hierarchy" the brief warns about — as well as three
 * more requests on the LCP path. The real screenshots start one band down, where
 * they are product evidence rather than decoration.
 */
export const HERO_PATHS = [
  {
    href: "/marketplace" as Route,
    eyebrow: "Buy",
    title: "Applications & scripts",
    body: "Complete, working software with the source included. Install it as it stands, or have it adapted.",
    icon: "package",
  },
  {
    href: "/templates" as Route,
    eyebrow: "Browse",
    title: "Website templates",
    body: "Front-ends you can put live and make your own — storefronts, dashboards, corporate sites.",
    icon: "layout",
  },
  {
    href: "/custom-software" as Route,
    eyebrow: "Build",
    title: "Custom build",
    body: "Nothing fits? Describe what your business needs to do and we scope it, then quote it.",
    icon: "wand",
  },
] as const;

/**
 * Hero search chips.
 *
 * `label` is what reads well on a pill; `q` is what actually finds something.
 * They differ because "Rota & timesheets" is how a care manager says it and
 * "rota timesheets" is what the text index scores.
 */
export const HERO_CHIPS = [
  { label: "CRM", q: "crm" },
  { label: "Booking", q: "booking" },
  { label: "Property", q: "property" },
  { label: "Rota & timesheets", q: "rota timesheets" },
  { label: "Inventory", q: "inventory" },
] as const;

/**
 * The stylised windows in the hero illustration.
 *
 * Kinds of software, not names of ours, and no prices — the reason is worth
 * keeping: these were once four real seeded products with hardcoded prices and
 * "adapted 23×" counts, which made the homepage a stale mirror of live rows. The
 * picture reads the same and asserts nothing. The real, named, priced inventory
 * is three bands below, straight from the catalogue.
 *
 * `free` is the *shape* of a badge, not a claim about a product — there genuinely
 * are free listings, and the illustration would misrepresent the catalogue if it
 * showed only paid ones.
 */
export const HERO_WINDOWS = [
  { title: "Client manager", kind: "Sales", thumb: "chart", free: true },
  { title: "Storefront", kind: "Retail", thumb: "grid", free: true },
  { title: "Shift planner", kind: "Care & HR", thumb: "rows", free: false },
] as const;

/** What CoSetup does after the software exists. Order is the lifecycle order. */
export const SERVICES = [
  {
    title: "Installation & setup",
    body: "Running on your infrastructure, configured for how you work.",
  },
  {
    title: "Cloud & DevOps",
    body: "Hosting, pipelines, backups and the monitoring that catches things first.",
  },
  {
    title: "Customisation",
    body: "Changes to something you already bought, scoped and quoted before it starts.",
  },
  {
    title: "Integrations",
    body: "Connected to the tools you already run, so data stops being retyped.",
  },
  {
    title: "Maintenance",
    body: "Updates, security patches and someone to call when it matters.",
  },
] as const;

/** What the requirements assistant will and will not do. Load-bearing honesty. */
export const CUSTOM_BUILD_PROMISES = [
  "Never invents a requirement you didn't confirm",
  "Flags what it assumed, separately from what you said",
  "Won't quote a price or promise a date — a person does that",
] as const;

/** Product families a vendor may list. Mirrors what the catalogue actually holds. */
export const VENDOR_FAMILIES = [
  "Applications",
  "Scripts",
  "Website templates",
  "Plugins & add-ons",
] as const;
