import "dotenv/config";
import mongoose from "mongoose";
import { parseFacet, FACET_PREFIX } from "../src/lib/db/models/catalog";
import { profileFor } from "./customization-vocabulary";

/**
 * Give existing products a feature list and a set of customisable areas.
 *
 * ## Why anything needs backfilling
 *
 * The customisation assistant's product context is built from
 * `Product.features` and `Product.customization.suggestedAreas` — the first so
 * its opening question refers to something the product actually does, the second
 * so the interview steers towards roles for a CRM and availability for a booking
 * system. `seed-bulk.ts` never wrote either, so against this database they were
 * populated on 11 products out of 1016 and 0 out of 1016 respectively.
 *
 * Nothing broke. The prompt guards both lists and simply omitted them, so the
 * best-developed part of it ran against empty arrays on every listing and asked
 * generic questions instead — the exact failure the feature was built to avoid,
 * arriving silently. `seed-bulk.ts` now fills both for new products; this is the
 * thousand that already exist.
 *
 * ## Idempotent, and conditional on what it changes
 *
 * Every update is guarded on the state it is changing, so a second run reports
 * zero. That guard is not decoration: `timestamps: true` on this schema stamps
 * `updatedAt` on every **matched** document, so a `$set` to a value already
 * present still counts as a modification, still bumps the timestamp, and still
 * reports work it did not do — which quietly reorders the admin list's "what did
 * we touch most recently" sort. `backfill-catalogue.ts` learned that by being
 * run twice; this one inherits the lesson rather than repeating it.
 *
 * ## It never overwrites somebody's own work
 *
 * A product with features already has them because a vendor or a member of staff
 * wrote them, and those are better than anything here by definition. The filter
 * is "empty or absent", never "different from what we would generate".
 *
 * ## What it is not
 *
 * Not a production migration. These are placeholder features for a seeded
 * catalogue of generated names, consistent with each product's category so the
 * assistant has something plausible to open on. On a real deployment the right
 * answer is for vendors to fill their own listings in, and running this there
 * would put our words in their mouths.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Use --env-file=.env.local.");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  const M = await import("../src/lib/db/models");

  console.log("\nbackfilling features and customisable areas\n");

  /*
   * One document at a time, because the value written depends on the document.
   *
   * A single `updateMany` cannot do this: each product's features come from its
   * own category, so there is no one `$set`. Grouping by category and running a
   * dozen `updateMany` calls was the alternative and it buys little — this runs
   * against a thousand rows once, on a developer's machine, and the readable
   * version is the one that will still be correct when a category is added.
   */
  const products = await M.Product.find({
    deletedAt: null,
    $or: [
      { features: { $size: 0 } },
      { features: { $exists: false } },
      { "customization.suggestedAreas": { $size: 0 } },
      { "customization.suggestedAreas": { $exists: false } },
    ],
  })
    .select({ facets: 1, features: 1, customization: 1 })
    .lean<
      {
        _id: mongoose.Types.ObjectId;
        facets?: string[];
        features?: unknown[];
        customization?: { suggestedAreas?: string[] };
      }[]
    >();

  console.log(`candidates:                     ${products.length}`);

  let featuresWritten = 0;
  let areasWritten = 0;
  const operations: Parameters<typeof M.Product.bulkWrite>[0] = [];

  for (const product of products) {
    const categorySlug = (product.facets ?? [])
      .map((facet) => parseFacet(facet))
      .find((parsed) => parsed?.prefix === FACET_PREFIX.category)?.slug;

    const profile = profileFor(categorySlug);

    /*
     * Seeded on the id, so a given product gets the same list every run and a
     * screenshot stays valid. `Math.random()` here would mean the second run
     * disagreed with the first about what it had already written.
     */
    const spread = Number(String(product._id).slice(-2).replace(/\D/g, "") || 0);

    const set: Record<string, unknown> = {};

    if (!product.features?.length) {
      set.features = profile.features.slice(0, 4 + (spread % 3));
      featuresWritten += 1;
    }

    if (!product.customization?.suggestedAreas?.length) {
      set["customization.suggestedAreas"] = profile.areas.slice(0, 2 + (spread % 3));
      areasWritten += 1;
    }

    // Both already present. The `$or` above matched on one being empty, so this
    // is only reachable if the other filled in between the read and here.
    if (Object.keys(set).length === 0) continue;

    operations.push({ updateOne: { filter: { _id: product._id }, update: { $set: set } } });
  }

  if (operations.length > 0) await M.Product.bulkWrite(operations);

  console.log(`feature lists written:          ${featuresWritten}`);
  console.log(`suggested-area lists written:   ${areasWritten}`);

  /*
   * The residual is what this script exists to make zero, and the number to look
   * at before believing it worked. A non-zero count after a run means a category
   * with no profile *and* no generic fallback, which should be impossible —
   * `profileFor` always returns something.
   */
  const remaining = await M.Product.countDocuments({
    deletedAt: null,
    $or: [{ features: { $size: 0 } }, { "customization.suggestedAreas": { $size: 0 } }],
  });
  console.log(`\nstill empty after this run:     ${remaining}`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
