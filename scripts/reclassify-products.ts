import "dotenv/config";
import mongoose from "mongoose";
import { classifyProduct, kindOf } from "./classification-vocabulary";

/**
 * Spread the seeded catalogue across the two-tier vocabulary.
 *
 *   npm run db:reclassify
 *
 * ## Why this is not "inferring" anything
 *
 * The thousand bulk products are synthetic, and their classification always was:
 * `seed-bulk.ts` picks the name's kind word ("Atlas **Ledger** 42") and the
 * category from two independent weighted draws, so a product called Ledger is as
 * likely to be filed under Booking as under Finance. There is no signal in the
 * data to recover — nothing was ever encoded.
 *
 * So this does two things rather than one. It spreads the catalogue across the
 * new vocabulary, which is what makes the two-tier UI and the landing pages
 * evaluable at all. And it makes the classification **agree with the name** for
 * the first time: a Ledger lands in Finance, a Dispatch in Logistics & Mobility.
 * The second is not cosmetic — a catalogue whose names contradict its filters is
 * a poor thing to judge a filter design on.
 *
 * ## Deterministic, therefore idempotent
 *
 * Every choice is drawn from a generator seeded with the product's **slug**, so
 * the same product gets the same answer on every run and the second run reports
 * zero. That is also why re-running after adding a product is safe: existing rows
 * do not shuffle underneath it.
 *
 * ## What it does not touch
 *
 * `catalogue`, `status`, prices, media, the vendor. This is a classification
 * pass; a product does not change shop because its category moved.
 */

/**
 * The sixteen hand-authored products, by hand.
 *
 * They have real names and real summaries, so a weighted draw would be strictly
 * worse than reading them. `gracia-daily` is the one worth noticing: a devotional
 * app that had been filed under Booking **and** Property, which is the incoherence
 * this pass exists to end.
 */
const DEMO_CATEGORIES: Record<string, string> = {
  "atlas-crm": "crm",
  tenancy: "tenant-management",
  roster: "rota-and-shift-management",
  freightline: "logistics",
  "brightpath-dispatch": "dispatch-management",
  "brightpath-dispatch-6bcm": "dispatch-management",
  "brightpath-dispatch-2vj4": "dispatch-management",
  "brightpath-dispatch-gf83": "dispatch-management",
  "brightpath-dispatch-8aeb": "dispatch-management",
  "gracia-daily": "membership",
  "storefront-starter": "e-commerce",
  komando: "crm",
  "meridian-admin": "admin-dashboards",
  "vitrine-storefront": "ecommerce-pages",
  "atrium-corporate": "corporate-and-business",
  "atlas-crm-template": "crm-dashboard",
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Use --env-file=.env.local.");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  const M = await import("../src/lib/db/models");
  const { deriveFacets } = await import("../src/services/catalog/facets");

  console.log("\nreclassifying the seeded catalogue\n");

  const terms = await M.Taxonomy.find({ isActive: true }).select({ kind: 1, slug: 1 }).lean();
  const idOf = new Map(terms.map((t) => [`${t.kind}:${t.slug}`, t._id]));
  const need = (kind: string, slug: string) => {
    const id = idOf.get(`${kind}:${slug}`);
    if (!id) throw new Error(`missing ${kind}:${slug} — run db:backfill:taxonomy-tree first`);
    return id;
  };

  const products = await M.Product.find({ deletedAt: null })
    .select({
      slug: 1,
      catalogue: 1,
      categoryIds: 1,
      industryIds: 1,
      technologyIds: 1,
      productTypeId: 1,
      vendorSlug: 1,
      facets: 1,
    })
    .lean();

  let changed = 0;
  let skipped = 0;
  const perCategory = new Map<string, number>();

  for (const product of products) {
    const catalogue = product.catalogue === "template" ? "template" : "script";
    const demo = DEMO_CATEGORIES[product.slug];

    // A product whose name matches no kind and is not one of the sixteen. Left
    // exactly as it is rather than filed at random — an unexplained product is a
    // better outcome than a confidently wrong one.
    if (!demo && !kindOf(product.slug)) {
      skipped += 1;
      continue;
    }

    const chosen = classifyProduct(product.slug, catalogue, demo);
    perCategory.set(chosen.categorySlug, (perCategory.get(chosen.categorySlug) ?? 0) + 1);

    const categoryIds = [need("category", chosen.categorySlug)];
    const next = {
      categoryIds,
      primaryCategoryId: categoryIds[0]!,
      industryIds: chosen.industrySlugs.map((s) => need("industry", s)),
      technologyIds: chosen.technologySlugs.map((s) => need("technology", s)),
      productTypeId: need("product_type", chosen.typeSlug),
    };

    const facets = await deriveFacets({
      ...next,
      ...(product.vendorSlug ? { vendorSlug: product.vendorSlug } : {}),
    });

    /*
     * Written only when something actually differs.
     *
     * `timestamps: true` stamps `updatedAt` on every *matched* document, so a
     * blanket `$set` would restamp the whole catalogue on every run and reorder
     * the admin list's "what did we touch most recently" sort — the trap
     * `backfill-catalogue.ts` documents after being caught by it. Comparing the
     * derived facets is the cheapest complete check: they are a function of all
     * four id fields.
     */
    if ((product.facets ?? []).join(" ") === facets.join(" ")) continue;

    await M.Product.updateOne({ _id: product._id }, { $set: { ...next, facets } });
    changed += 1;
  }

  console.log(`products reclassified:          ${changed}`);
  console.log(`left alone (no matching name):  ${skipped}`);

  const top = [...perCategory.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\ncategories now in use:          ${top.length}`);
  console.log(top.map(([slug, n]) => `  ${slug} ${n}`).join("\n"));

  await mongoose.disconnect();
  console.log("\ndone\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
