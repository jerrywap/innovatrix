import type { TaxonomyCatalogue, TaxonomyKind } from "../src/lib/db/enums";

/**
 * The one taxonomy vocabulary, shared by both seeds.
 *
 * ## Why this file exists
 *
 * `seed.ts` and `seed-bulk.ts` each carried their own `product_type` list and the
 * two **disagreed**: the demo seed used "Complete application / Script / Admin
 * panel / Starter kit", the bulk seed used "complete-application / module /
 * template / integration" and auto-created whatever was missing. So a
 * bulk-seeded database ended up with eight product types, four of which no screen
 * had ever been designed around, and `template` was a *product type* — which is
 * the thing the catalogue split replaces.
 *
 * One list, imported by both, so they cannot drift again.
 *
 * ## `catalogue` is stated for every term
 *
 * Not defaulted. `both` is the schema default and the right one for a term
 * somebody adds through the admin screen, but a seed writing the canonical
 * vocabulary should say what it means — and the eight original categories being
 * explicitly `script` *is* the "templates must not pollute script browsing"
 * requirement, rather than a consequence of a default.
 */

export interface VocabularyTerm {
  kind: TaxonomyKind;
  name: string;
  catalogue: TaxonomyCatalogue;
  description?: string;
  sortOrder: number;
}

const categories: Array<[string, TaxonomyCatalogue, string?]> = [
  // Business domains — scripts. These are what an application *does*, and none of
  // them describes a template.
  ["CRM", "script"],
  ["Booking", "script"],
  ["Property", "script"],
  ["Healthcare", "script"],
  ["Logistics", "script"],
  ["HR & Rota", "script"],
  ["E-commerce", "script"],
  ["Finance", "script"],

  /*
   * Template categories. Real prose on each, because the landing pages read
   * `Taxonomy.description` and the SEO criterion fails with N identical strings —
   * the whole reason these get landing pages and technology does not.
   *
   * `Ecommerce pages` does not collide with the `E-commerce` category above:
   * slugs are unique per *kind*, and these are all `category`. They are different
   * things with similar names — one is "software that sells", the other is "pages
   * that look like a shop" — which is itself an argument for the split.
   */
  [
    "Admin dashboards",
    "template",
    "Back-office layouts with the tables, charts, forms and navigation already built — the part of an internal tool nobody wants to design twice.",
  ],
  [
    "Ecommerce pages",
    "template",
    "Storefront, product, basket and checkout pages, styled and responsive, ready to wire to whatever is selling behind them.",
  ],
  [
    "Corporate & business",
    "template",
    "Company sites: services, about, team, case studies and contact, in a tone that suits an organisation rather than a start-up.",
  ],
  [
    "Landing pages",
    "template",
    "Single-page layouts built to convert — a hero, proof, pricing and one clear call to action.",
  ],
];

const industries = [
  "Healthcare",
  "Education",
  "Logistics",
  "Hospitality",
  "Property",
  "Finance",
  "Retail",
  "Nonprofit",
];

const technologies = [
  "Laravel",
  "Next.js",
  "Django",
  "PostgreSQL",
  "MongoDB",
  "MySQL",
  "Redis",
  "Stripe",
  // Front-end frameworks, added with the template catalogue — "a Tailwind admin
  // dashboard" is how somebody actually searches for one. `both`, because a
  // script's front end is built with these too.
  "Bootstrap",
  "Tailwind CSS",
];

/**
 * `product_type` — reconciled, and **without** `template`.
 *
 * `template` used to live here, and that is exactly the modelling the catalogue
 * field replaces: whether something is a template is *which shop it is in*, not
 * what kind of thing it is within one. `module`, `integration` and `plugin` are
 * kept because they are real answers to "what kind" — a plugin especially, now
 * that plugins are a thing customers buy.
 *
 * The old `template` term cannot be hard-deleted (`deleteTaxonomy` refuses while
 * any product references it, and 12% of a bulk-seeded catalogue does), so the
 * backfill deactivates it instead.
 */
const productTypes = [
  "Complete application",
  "Script",
  "Admin panel",
  "Starter kit",
  "Plugin",
  "Module",
  "Integration",
];

export const TAXONOMY_VOCABULARY: readonly VocabularyTerm[] = [
  ...categories.map(([name, catalogue, description], index) => ({
    kind: "category" as const,
    name,
    catalogue,
    ...(description ? { description } : {}),
    sortOrder: index,
  })),
  // Industries are shared: Healthcare is an industry whichever shop you are in.
  ...industries.map((name, index) => ({
    kind: "industry" as const,
    name,
    catalogue: "both" as const,
    sortOrder: index,
  })),
  ...technologies.map((name, index) => ({
    kind: "technology" as const,
    name,
    catalogue: "both" as const,
    sortOrder: index,
  })),
  ...productTypes.map((name, index) => ({
    kind: "product_type" as const,
    name,
    catalogue: "both" as const,
    sortOrder: index,
  })),
];

/** The `product_type` slug the catalogue field replaced. Deactivated, not deleted. */
export const RETIRED_PRODUCT_TYPE_SLUG = "template";
