/**
 * How a seeded product is classified — **one table, two consumers.**
 *
 * `seed-bulk.ts` writes a thousand products from it; `reclassify-products.ts`
 * applies it to the ones already written. They used to hold separate weight
 * lists, which is precisely the failure `taxonomy-vocabulary.ts` exists to
 * prevent one level up: two seeds disagreeing about what the catalogue looks
 * like, and neither of them wrong on its own terms.
 *
 * ## The kind word decides the family
 *
 * `seed-bulk.ts` names a product `{Noun} {Kind} {n}` — "Atlas Ledger 42" — and
 * used to draw its category from a **separate** weighted list. So a Ledger was as
 * likely to be a Booking product as a Finance one, and the catalogue's names
 * contradicted its own filters. Here the kind picks the family and the weights
 * pick which sibling within it, so the two finally agree.
 *
 * Every family stays inside one parent. That is what makes a spread coherent
 * rather than merely wide — and three or four children per family is what gives
 * the subcategory rail something to show, since a parent with one populated child
 * renders no second tier at all.
 */
import type { ProductCatalogue } from "../src/lib/db/enums";

/** Zipf-ish within a family: the first child is the head, the rest are the tail. */
export type Weights = ReadonlyArray<readonly [string, number]>;

/**
 * The name's kind word decides the family; the weights decide which sibling.
 *
 * Every entry stays inside **one parent**, which is what makes the result
 * coherent rather than merely spread: a Rota is somewhere in HR & Workforce
 * whichever of the four it lands on. Three or four children per family is also
 * what gives the subcategory rail something to show — a parent with one populated
 * child renders no second tier at all, by design.
 */
export const KIND_CATEGORIES: Record<string, { script: Weights; template: Weights }> = {
  CRM: {
    script: [
      ["crm", 60],
      ["workflow-and-automation", 15],
      ["reporting-and-analytics", 15],
      ["admin-and-back-office", 10],
    ],
    template: [
      ["crm-dashboard", 60],
      ["admin-dashboards", 40],
    ],
  },
  Console: {
    script: [
      ["admin-and-back-office", 50],
      ["knowledge-base", 20],
      ["document-management", 20],
      ["forms-and-surveys", 10],
    ],
    template: [
      ["admin-dashboards", 55],
      ["application-ui", 45],
    ],
  },
  Booking: {
    script: [
      ["booking", 60],
      ["appointment-scheduling", 25],
      ["rental-management", 15],
    ],
    template: [
      ["booking-and-reservation", 60],
      ["venue", 40],
    ],
  },
  Scheduler: {
    script: [
      ["appointment-scheduling", 55],
      ["calendar-management", 30],
      ["queue-management", 15],
    ],
    template: [
      ["event-and-conference", 60],
      ["wedding", 40],
    ],
  },
  Ledger: {
    script: [
      ["accounting", 55],
      ["financial-management", 25],
      ["budgeting", 20],
    ],
    template: [["finance-dashboard", 100]],
  },
  Billing: {
    script: [
      ["billing-and-invoicing", 60],
      ["payments", 25],
      ["expense-management", 15],
    ],
    template: [
      ["pricing-page", 60],
      ["product-landing-page", 40],
    ],
  },
  Rota: {
    script: [
      ["rota-and-shift-management", 45],
      ["attendance-and-time-tracking", 25],
      ["leave-management", 15],
      ["payroll", 15],
    ],
    template: [
      ["application-ui", 60],
      ["saas-dashboard", 40],
    ],
  },
  Dispatch: {
    script: [
      ["dispatch-management", 45],
      ["delivery-management", 30],
      ["courier-management", 25],
    ],
    template: [
      ["service-directory", 60],
      ["local-directory", 40],
    ],
  },
  Tracker: {
    script: [
      ["tracking", 50],
      ["fleet-management", 30],
      ["shipping", 20],
    ],
    template: [["analytics-dashboard", 100]],
  },
  Inventory: {
    script: [
      ["inventory-management", 50],
      ["order-management", 25],
      ["product-management", 25],
    ],
    template: [
      ["ecommerce-pages", 50],
      ["electronics-store", 25],
      ["furniture-and-home-store", 25],
    ],
  },
  Portal: {
    script: [
      ["customer-portal", 50],
      ["loyalty-and-rewards", 25],
      ["reviews-and-feedback", 25],
    ],
    template: [
      ["corporate-and-business", 50],
      ["small-business", 25],
      ["professional-services", 25],
    ],
  },
  Desk: {
    script: [
      ["helpdesk-and-support", 55],
      ["live-chat-and-messaging", 25],
      ["forum", 20],
    ],
    template: [
      ["business-directory", 60],
      ["job-board", 40],
    ],
  },
  Registry: {
    script: [
      ["directory-and-listings", 60],
      ["membership", 25],
      ["community-platform", 15],
    ],
    template: [
      ["local-directory", 50],
      ["classified-ads", 50],
    ],
  },
  Studio: {
    script: [
      ["media-management", 40],
      ["digital-asset-management", 25],
      ["cms", 20],
      ["video-and-streaming", 15],
    ],
    template: [
      ["portfolio", 40],
      ["personal-portfolio", 20],
      ["photography", 20],
      ["creative-agency", 20],
    ],
  },
};

/** Twenty-one of forty-three, so the rail has range without every term at n=3. */
export const INDUSTRY_WEIGHTS: Weights = [
  ["healthcare", 16],
  ["retail", 14],
  ["education", 12],
  ["property", 11],
  ["logistics", 10],
  ["professional-services", 9],
  ["hospitality", 8],
  ["finance", 8],
  ["technology-and-saas", 7],
  ["construction", 6],
  ["marketing-and-advertising", 6],
  ["manufacturing", 5],
  ["legal", 5],
  ["nonprofit", 4],
  ["events", 4],
  ["automotive", 3],
  ["insurance", 3],
  ["recruitment-and-staffing", 3],
  ["fitness-and-gym", 2],
  ["restaurant-and-cafe", 2],
  ["hotel-and-accommodation", 2],
];

/** Twenty-four of seventy. A stack, not a shopping list — hence the pairs below. */
export const TECH_WEIGHTS: Weights = [
  ["laravel", 20],
  ["react", 18],
  ["typescript", 16],
  ["php", 14],
  ["next-js", 13],
  ["javascript", 12],
  ["mysql", 12],
  ["postgresql", 11],
  ["node-js", 10],
  ["tailwind-css", 9],
  ["python", 8],
  ["vue", 8],
  ["bootstrap", 7],
  ["mongodb", 7],
  ["django", 6],
  ["express-js", 5],
  ["redis", 5],
  ["stripe", 5],
  ["docker", 4],
  ["firebase", 4],
  ["rest-api", 4],
  ["wordpress", 3],
  ["flutter", 3],
  ["graphql", 3],
];

/**
 * Types split by catalogue, because "Complete Application" is a lie about a
 * template — it is a front end, which is the distinction `catalogue` exists to
 * carry and the reason `Website Template` was removed from this axis.
 */
export const TYPE_WEIGHTS: Record<ProductCatalogue, Weights> = {
  script: [
    ["complete-application", 45],
    ["module", 20],
    ["starter-kit", 12],
    ["integration", 10],
    ["api-backend", 8],
    ["mobile-application", 5],
  ],
  template: [
    ["ui-kit", 40],
    ["component", 30],
    ["starter-kit", 30],
  ],
};

/** The kind words a bulk product can be named after — the table's own keys. */
export const KINDS = Object.keys(KIND_CATEGORIES);

/** Deterministic, so two runs produce the same catalogue and a diff is readable. */
export function pickWeighted(weights: Weights, random: () => number): string {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [value, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weights[0]![0];
}

/**
 * A generator seeded from a product's **slug**.
 *
 * Two properties follow, and both are the reason this is shared rather than
 * written twice.
 *
 * A product's classification is a pure function of its slug, so
 * `db:seed:bulk` and `db:reclassify` produce the **same answer** for the same
 * product — which is what lets one be run after the other without churning a
 * thousand rows, and what makes `db:reclassify` report zero on a second run.
 *
 * And it is independent of iteration order: `db:seed:bulk -- 250` classifies
 * "atlas-crm-42" exactly as `-- 1000` does. A single shared stream advanced by
 * every draw gave a different answer depending on how many products came before.
 */
export function classificationRandom(slug: string): () => number {
  let seed = 2166136261;
  for (let index = 0; index < slug.length; index += 1) {
    seed ^= slug.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  seed = seed >>> 0;

  return function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `atlas-crm-42` → `CRM`. Absent for a hand-authored product. */
export function kindOf(slug: string): string | undefined {
  const match = /^[a-z]+-([a-z]+)-\d+$/.exec(slug);
  if (!match) return undefined;
  const word = match[1]!;
  return KINDS.find((kind) => kind.toLowerCase() === word);
}

export interface Classification {
  categorySlug: string;
  industrySlugs: string[];
  technologySlugs: string[];
  typeSlug: string;
}

/**
 * The whole decision, in one place.
 *
 * Both consumers call **this**, not the tables — and that is the point. Keeping
 * two copies of "draw a category, then an industry, then maybe a second one"
 * in sync by hand is not a thing that stays true: the draws share one generator,
 * so a single extra `random()` in one of them silently changes every answer it
 * gives. Sharing the tables but not the sequence would have looked shared and
 * not been.
 *
 * A second industry on about a third, and a third technology on about half, so
 * neither dimension is uniformly one-per-product — the rail's OR-within-a-
 * dimension behaviour needs something to act on.
 */
export function classifyProduct(
  slug: string,
  catalogue: ProductCatalogue,
  categoryOverride?: string,
): Classification {
  const random = classificationRandom(slug);
  const kind = kindOf(slug);

  const categorySlug =
    categoryOverride ?? (kind ? pickWeighted(KIND_CATEGORIES[kind]![catalogue], random) : "");

  const industrySlugs = [pickWeighted(INDUSTRY_WEIGHTS, random)];
  if (random() < 0.35) industrySlugs.push(pickWeighted(INDUSTRY_WEIGHTS, random));

  const technologySlugs = [
    pickWeighted(TECH_WEIGHTS, random),
    pickWeighted(TECH_WEIGHTS, random),
  ];
  if (random() < 0.5) technologySlugs.push(pickWeighted(TECH_WEIGHTS, random));

  return {
    categorySlug,
    industrySlugs: [...new Set(industrySlugs)],
    technologySlugs: [...new Set(technologySlugs)],
    typeSlug: pickWeighted(TYPE_WEIGHTS[catalogue], random),
  };
}
