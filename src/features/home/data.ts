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
 * `label` is what reads well on a pill; `q` is what actually finds something —
 * they differ because a care manager says "rota & timesheets" and the text index
 * scores "rota timesheets".
 *
 * Four, not five. The three-column hero gives this column about 410px, and five
 * of these measure 486px — so the fifth wrapped to a line of its own at every
 * width. A single orphaned chip reads as a mistake; the search box above it is
 * the route to anything not listed here. "Rota & timesheets" was the one dropped,
 * because it was the longest and the least likely first guess.
 */
export const HERO_CHIPS = [
  { label: "CRM", q: "crm" },
  { label: "Booking", q: "booking" },
  { label: "Property", q: "property" },
  { label: "Inventory", q: "inventory" },
] as const;

/**
 * The rows in the hero's catalogue panel.
 *
 * Kinds of software, not names of ours, and no prices — the reason is worth
 * keeping: these were once four real seeded products with hardcoded prices and
 * "adapted 23×" counts, which made the homepage a stale mirror of live rows. The
 * panel reads the same and asserts nothing. The real, named, priced inventory is
 * three bands below, straight from the catalogue.
 *
 * `free` is the *shape* of a badge, not a claim about a product — there genuinely
 * are free listings, and the panel would misrepresent the catalogue if it showed
 * only paid ones.
 *
 * The thumbnails are supplied brand assets in `public/brand/`, not product media:
 * each illustrates a *category*, which is why they can be committed and why they
 * carry no alt text — the panel is decorative in full, see `HeroSurface`.
 *
 * They are matched to the row by subject rather than by the order they arrived in:
 * the admin dashboard sits on "Client manager", the shop-and-cart screens on
 * "Storefront", the phone infographic on "Shift planner". Filenames are the
 * *role*, not the source, so re-pointing one is a copy over the file rather than
 * an edit here.
 */
export const HERO_WINDOWS = [
  {
    title: "Client manager",
    kind: "Sales",
    src: "/brand/preview-client-manager.png",
    free: false,
  },
  { title: "Storefront", kind: "Retail", src: "/brand/preview-storefront.png", free: true },
  {
    title: "Shift planner",
    kind: "Care & HR",
    src: "/brand/preview-shift-planner.png",
    free: false,
  },
] as const;

/**
 * The hero's background photograph, and the template screenshot in front of it.
 *
 * Both live in `public/brand/` rather than in object storage: they are brand
 * furniture that changes when the brand does, and a homepage which cannot paint
 * until S3 answers is a homepage with a worse first paint.
 */
export const HERO_MEDIA = {
  background: "/brand/hero-studio.jpg",
  templateShot: "/brand/template-preview.png",
  /** Intrinsic size, so the box is reserved and the screenshot cannot shift. */
  templateShotSize: { width: 757, height: 480 },
  /** What the mock address bar reads. Not a destination — it is the promise. */
  templateUrl: "https://your-website.com",
} as const;

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
