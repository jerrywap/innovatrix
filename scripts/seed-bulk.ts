/**
 * A thousand products, for the §94 performance work.
 *
 *   npm run db:seed:bulk        # 1000
 *   npm run db:seed:bulk -- 250
 *
 * ## Why the distribution is skewed, not uniform
 *
 * A uniform spread across 28 taxonomy terms gives every filter roughly 1/28th
 * of the catalogue, and every query looks equally fast. Real catalogues are
 * Zipfian: a third of everything is "CRM", and that is the query whose plan
 * actually matters. Uniform data hides exactly the selectivity problem this
 * exercise exists to find.
 *
 * ## Why the descriptions are English
 *
 * Lorem ipsum gives the text index nothing to score — every document has the
 * same nonsense words, so relevance ranking is untestable and `$text` looks
 * fine because it always matches everything or nothing.
 *
 * ## Deliberate gaps
 *
 * ~20% of products have no price in at least one currency, so the "price on
 * request" path is exercised rather than assumed, and ~10% are `owners_only`
 * demos — the target for ticket 09's payload assertion.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { buildProductFacets } from "../src/lib/db/models/catalog";
import { LICENCE_TYPES, type LicenceType } from "../src/lib/db/enums";
import { profileFor } from "./customization-vocabulary";

const TOTAL = Number(process.argv[2] ?? 1000);

/**
 * Typed, because it was once `"single_site"` — which is not a `LicenceType`.
 *
 * `bulkWrite` does not run document validators, so the bad value wrote cleanly
 * and sat there. It only surfaced at *checkout*, where `Order.create()` does
 * validate, as a Mongoose `ValidationError` — which is not one of our
 * `DomainError`s, so `withAction` reported it as "Something went wrong on our
 * side" with no field information. A thousand products were unbuyable and the
 * only symptom was a generic error on the last click of the funnel.
 *
 * The annotation is the fix that lasts: a typo here is now a compile error
 * rather than a support ticket.
 */
const BULK_LICENCE_TYPE: LicenceType = "single_installation";

/** Zipf-ish weights: the head is genuinely popular, the tail genuinely thin. */
const CATEGORY_WEIGHTS: Array<[string, number]> = [
  ["crm", 30],
  ["booking", 18],
  ["e-commerce", 14],
  ["property", 10],
  ["finance", 9],
  ["healthcare", 8],
  ["logistics", 6],
  ["hr-and-rota", 5],
];

/**
 * Template categories, kept separate from the script ones above.
 *
 * A template carrying "CRM" would be worse than the greyed-out leak the catalogue
 * scoping fixes: it would show a script category in the template rail at a
 * **non-zero** count, so it would look correct. This seed writes documents
 * directly and never goes through `saveClassification`, so the cross-catalogue
 * check does not protect it — the separation has to be here.
 */
const TEMPLATE_CATEGORY_WEIGHTS: Array<[string, number]> = [
  ["admin-dashboards", 40],
  ["ecommerce-pages", 25],
  ["corporate-and-business", 20],
  ["landing-pages", 15],
];

const INDUSTRY_WEIGHTS: Array<[string, number]> = [
  ["healthcare", 22],
  ["education", 18],
  ["retail", 16],
  ["property", 14],
  ["logistics", 12],
  ["hospitality", 10],
  ["professional-services", 8],
];

const TECH_WEIGHTS: Array<[string, number]> = [
  ["laravel", 34],
  ["react", 26],
  ["nextjs", 18],
  ["postgresql", 16],
  ["mysql", 14],
  ["node", 12],
  ["vue", 8],
  ["python", 6],
];

/*
 * `product_type` weights — reconciled with `scripts/taxonomy-vocabulary.ts`.
 *
 * `template` used to be here at 12%, which is the modelling the `catalogue` field
 * replaces: whether something is a template is *which shop it is in*, not what
 * kind of thing it is within one. Those rows now become genuine templates via the
 * `catalogue` weight below, and the retired term is deactivated by
 * `db:backfill:catalogue`.
 */
const TYPE_WEIGHTS: Array<[string, number]> = [
  ["complete-application", 55],
  ["module", 25],
  ["starter-kit", 12],
  ["integration", 8],
];

/**
 * Roughly one in eight bulk products is a template, so `/templates` has a
 * realistic grid and the split can be seen doing something at scale.
 */
const TEMPLATE_SHARE = 0.12;

const NOUNS = [
  "Atlas",
  "Beacon",
  "Cadence",
  "Delta",
  "Ember",
  "Forge",
  "Granite",
  "Harbour",
  "Ivory",
  "Junction",
  "Keystone",
  "Lantern",
  "Meridian",
  "Nimbus",
  "Orbit",
  "Pillar",
  "Quarry",
  "Relay",
  "Summit",
  "Tempo",
  "Union",
  "Vertex",
  "Willow",
  "Zenith",
  "Anchor",
  "Bridge",
  "Compass",
  "Drift",
  "Echo",
  "Foundry",
];

const KINDS = [
  "CRM",
  "Booking",
  "Portal",
  "Desk",
  "Ledger",
  "Rota",
  "Dispatch",
  "Studio",
  "Inventory",
  "Billing",
  "Scheduler",
  "Tracker",
  "Registry",
  "Console",
];

/** Real sentences, so the text index has something to weight. */
const OPENERS = [
  "Tracks every enquiry from first contact to signed contract",
  "Handles appointments, reminders and cancellations",
  "Keeps stock counts accurate across warehouses and shopfronts",
  "Turns timesheets into approved payroll without a spreadsheet",
  "Manages tenancies, inspections and rent collection",
  "Issues invoices, chases payment and reconciles the bank feed",
  "Routes deliveries and gives drivers a single job list",
  "Runs the referral pathway from triage to discharge",
  "Publishes a catalogue and takes orders online",
  "Coordinates shifts across sites and flags gaps before they happen",
];

const CLAUSES = [
  "with role-based access for admins, staff and read-only auditors",
  "including a customer portal and email notifications",
  "with exportable reports and a scheduled digest",
  "and integrates with the accounting package already in use",
  "with a full audit trail against every record",
  "including bulk import from CSV and a migration checklist",
  "and works offline, syncing when the connection returns",
  "with configurable approval steps per department",
];

function pickWeighted(weights: Array<[string, number]>, random: () => number): string {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [value, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weights[0]![0];
}

/** Deterministic, so two runs produce the same catalogue and diffs are readable. */
function mulberry32(seed: number): () => number {
  return function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — copy .env.example to .env.local");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });
  console.log("connected:", mongoose.connection.name);

  const M = await import("../src/lib/db/models");

  // Resolve taxonomy ids by slug, so a product's `categoryIds` and its `facets`
  // agree — the invariant `ERD.md` warns about drifting.
  const terms = await M.Taxonomy.find({}).select({ kind: 1, slug: 1 }).lean();
  const idBySlug = new Map(terms.map((t) => [`${t.kind}:${t.slug}`, t._id]));

  const missing = [
    ...CATEGORY_WEIGHTS.map(([s]) => `category:${s}`),
    ...TEMPLATE_CATEGORY_WEIGHTS.map(([s]) => `category:${s}`),
    ...INDUSTRY_WEIGHTS.map(([s]) => `industry:${s}`),
    ...TECH_WEIGHTS.map(([s]) => `technology:${s}`),
    ...TYPE_WEIGHTS.map(([s]) => `product_type:${s}`),
  ].filter((key) => !idBySlug.has(key));

  if (missing.length > 0) {
    console.log(`\n${missing.length} taxonomy terms are missing; creating them.`);
    for (const key of missing) {
      const [kind, slug] = key.split(":") as [string, string];
      const doc = await M.Taxonomy.findOneAndUpdate(
        { kind: kind as never, slug },
        {
          $setOnInsert: {
            kind,
            slug,
            name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            isActive: true,
            sortOrder: 50,
          },
        },
        { upsert: true, returnDocument: "after" },
      ).lean();
      if (doc) idBySlug.set(key, doc._id);
    }
  }

  const random = mulberry32(20260816);
  // `AnyBulkWriteOperation<ProductDoc>` would need every id non-optional, and
  // the ids come from a Map lookup. The seed is not the place to litigate that
  // — a missing term would have thrown above.
  const operations: Parameters<(typeof M.Product)["bulkWrite"]>[0] = [];
  let noGbp = 0;
  let free = 0;
  let templates = 0;
  let ownersOnly = 0;

  for (let index = 0; index < TOTAL; index += 1) {
    const noun = NOUNS[Math.floor(random() * NOUNS.length)]!;
    const kind = KINDS[Math.floor(random() * KINDS.length)]!;
    const name = `${noun} ${kind} ${index + 1}`;
    const slug = `${noun.toLowerCase()}-${kind.toLowerCase()}-${index + 1}`;

    // Decided before the category, because it decides *which* vocabulary the
    // category comes from.
    const isTemplate = random() < TEMPLATE_SHARE;
    if (isTemplate) templates += 1;

    const categorySlug = pickWeighted(
      isTemplate ? TEMPLATE_CATEGORY_WEIGHTS : CATEGORY_WEIGHTS,
      random,
    );
    const industrySlug = pickWeighted(INDUSTRY_WEIGHTS, random);
    const techSlugs = [
      ...new Set([pickWeighted(TECH_WEIGHTS, random), pickWeighted(TECH_WEIGHTS, random)]),
    ];
    const typeSlug = pickWeighted(TYPE_WEIGHTS, random);

    const summary = `${OPENERS[Math.floor(random() * OPENERS.length)]} ${
      CLAUSES[Math.floor(random() * CLAUSES.length)]
    }.`;

    // ~20% are missing a price in at least one currency. The card must render
    // "Price on request" for those, never £0.00.
    const gap = random();
    /*
     * ~5% are genuinely **free**, priced at zero in every currency.
     *
     * Deliberately distinct from the ~20% above that are missing a price: the
     * grid has to show "Free" for one and "Price on request" for the other, and
     * a filter that confused them would be the worst possible bug on `?free=true`.
     * Priced in *all three* currencies so free stays free whichever one the
     * viewer is browsing in.
     */
    const isFree = random() < 0.05;
    const base = isFree ? 0 : 19_900 + Math.floor(random() * 480_000);
    const prices: Array<{ currency: string; amount: number; compareAtAmount?: number }> = [];
    if (isFree) {
      free += 1;
      prices.push(
        { currency: "GBP", amount: 0 },
        { currency: "USD", amount: 0 },
        { currency: "NGN", amount: 0 },
      );
    } else {
      if (gap > 0.1) prices.push({ currency: "GBP", amount: base });
      else noGbp += 1;
      if (gap > 0.2) prices.push({ currency: "USD", amount: Math.round(base * 1.27) });
      if (gap > 0.35) prices.push({ currency: "NGN", amount: Math.round(base * 21) * 100 });
    }

    const exposure =
      random() < 0.1 ? "owners_only" : random() < 0.5 ? "authenticated" : "public";
    if (exposure === "owners_only") ownersOnly += 1;

    const facets = buildProductFacets({
      categorySlugs: [categorySlug],
      industrySlugs: [industrySlug],
      technologySlugs: techSlugs,
      productTypeSlug: typeSlug,
    });

    operations.push({
      updateOne: {
        filter: { slug },
        update: {
          $set: {
            name,
            slug,
            summary,
            descriptionText: `${summary} ${OPENERS[Math.floor(random() * OPENERS.length)]}.`,
            status: "published",
            publishedAt: new Date(Date.now() - Math.floor(random() * 400) * 86_400_000),
            categoryIds: [idBySlug.get(`category:${categorySlug}`)],
            industryIds: [idBySlug.get(`industry:${industrySlug}`)],
            technologyIds: techSlugs.map((s) => idBySlug.get(`technology:${s}`)),
            productTypeId: idBySlug.get(`product_type:${typeSlug}`),
            catalogue: isTemplate ? "template" : "script",
            facets,
            prices,
            media: [
              {
                kind: "screenshot",
                // `picsum.photos`, seeded on the slug.
                //
                // The first attempt built Unsplash URLs by adding an index to a
                // base photo id — which produced a thousand ids that do not
                // exist, so every card 404'd and the dev log filled with
                // "upstream image response failed". Placeholder art has to come
                // from a service that *generates* it, not one that happens to
                // have real photos at guessable addresses.
                //
                // Seeded on the slug rather than random, so the catalogue looks
                // identical on every machine and a screenshot stays valid.
                //
                // 1600×900, not 800×500. The hero renders at up to 780px and the
                // lightbox at up to 1280px, so an 800px source was a 1.6× upscale
                // in the one place somebody opens to look closely — and it made
                // every judgement about image quality here a judgement about a
                // scaled placeholder.
                url: `https://picsum.photos/seed/${slug}/1600/900`,
                alt: `${name} dashboard`,
                sortOrder: 0,
                isPrimary: true,
              },
            ],
            licencePackages: [
              {
                key: "standard",
                name: "Standard",
                licenceType: BULK_LICENCE_TYPE,
                activationLimit: 1,
                supportMonths: 12,
                updateMonths: 12,
                prices,
              },
            ],
            "customization.available": random() < 0.65,
            "customization.aiWorkflowEnabled": random() < 0.5,
            /*
             * Features and suggested areas, from the category.
             *
             * These were both absent, and their absence was invisible: the
             * customisation assistant reads `features` to open on something the
             * product does and `suggestedAreas` to decide what to ask about, and
             * with a thousand products carrying neither, every interview it ran
             * was the generic one the prompt exists to avoid. Nothing failed —
             * it just quietly asked worse questions.
             *
             * Sliced by the seeded `random()` so the count varies per product
             * but a given slug gets the same list on every machine, like the
             * placeholder image above.
             */
            features: profileFor(categorySlug).features.slice(0, 4 + Math.floor(random() * 3)),
            "customization.suggestedAreas": profileFor(categorySlug).areas.slice(
              0,
              2 + Math.floor(random() * 3),
            ),
            "demo.exposure": exposure,
            isFeatured: random() < 0.04,
            orderCount: Math.floor(random() ** 3 * 240),
            deletedAt: null,
          },
        },
        upsert: true,
      },
    });
  }

  console.log(`\nwriting ${operations.length} products…`);
  const started = Date.now();
  // Batched, because one bulkWrite of a thousand upserts exceeds the 16MB
  // command limit once media and prices are attached.
  for (let index = 0; index < operations.length; index += 200) {
    await M.Product.bulkWrite(operations.slice(index, index + 200), { ordered: false });
    process.stdout.write(".");
  }
  console.log(`\ndone in ${Date.now() - started}ms`);

  /*
   * `bulkWrite` bypasses document validators, so this is the only thing
   * standing between a mistyped enum and a thousand products that cannot be
   * bought. Checked here rather than trusted, because the failure surfaces
   * three screens away — at checkout, as a generic error.
   */
  const invalidLicenceTypes = await M.Product.distinct("licencePackages.licenceType", {
    "licencePackages.licenceType": { $nin: LICENCE_TYPES },
  });
  if (invalidLicenceTypes.length > 0) {
    throw new Error(
      `Seeded an invalid licenceType: ${invalidLicenceTypes.join(", ")}. ` +
        `Valid values are ${LICENCE_TYPES.join(", ")}. These products would fail at checkout.`,
    );
  }

  const published = await M.Product.countDocuments({ status: "published", deletedAt: null });
  console.log(`\npublished products:      ${published}`);
  console.log(`no GBP price:            ${noGbp} (${Math.round((noGbp / TOTAL) * 100)}%)`);
  console.log(`free (0 in all three):  ${free} (${Math.round((free / TOTAL) * 100)}%)`);
  console.log(
    `templates:              ${templates} (${Math.round((templates / TOTAL) * 100)}%)`,
  );
  console.log(
    `owners_only demos:       ${ownersOnly} (${Math.round((ownersOnly / TOTAL) * 100)}%)`,
  );

  const top = await M.Product.aggregate([
    { $match: { status: "published" } },
    { $unwind: "$facets" },
    { $match: { facets: /^cat:/ } },
    { $group: { _id: "$facets", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  console.log("\ncategory distribution (skewed on purpose):");
  for (const row of top) console.log(`  ${String(row._id).padEnd(22)} ${row.count}`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
