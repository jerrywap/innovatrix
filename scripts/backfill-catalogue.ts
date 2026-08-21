import "dotenv/config";
import mongoose from "mongoose";
import { TAXONOMY_VOCABULARY, RETIRED_PRODUCT_TYPE_SLUG } from "./taxonomy-vocabulary";

/**
 * Give every existing product and taxonomy term a catalogue.
 *
 * ## Run this **after** `db:indexes` and **before** deploying the reading code
 *
 * `db:indexes` swaps `{status, facets}` for `{status, catalogue, facets}`. This
 * fills the field the new index sorts on. The storefront tolerates a missing
 * `catalogue` on purpose — the script predicate is
 * `{ $in: ["script", null] }`, which matches an absent field — so the window
 * between the two is safe rather than merely short. That tolerance is a seatbelt,
 * not a licence to skip this: the eventual template extraction, the readiness gate
 * and admin filtering all want the field to really be there.
 *
 * ## Idempotent
 *
 * Every write is conditional on the state it is changing. Run it twice and the
 * second run reports zero.
 *
 * The residual count printed at the end is the number this script exists to make
 * zero — and the number anybody tempted to "tidy" the `$in` into a plain
 * `"script"` equality needs to see first.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Use --env-file=.env.local.");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  const M = await import("../src/lib/db/models");

  console.log("\nbackfilling catalogues\n");

  /*
   * 1. Products that are already templates, by the old modelling.
   *
   * `type:template` in `facets` is how a template was expressed before this
   * field: a `product_type` term. Reading it here is what makes a bulk-seeded
   * development database demoable immediately instead of showing an empty
   * `/templates`, and it is the honest production rule too — nothing real has
   * been a template any other way.
   */
  const promoted = await M.Product.updateMany(
    /*
     * `catalogue: { $ne: "template" }` is not redundant.
     *
     * Mongoose has `timestamps: true` on this schema, so it stamps `updatedAt`
     * on every **matched** document — which means a `$set` to the value a
     * document already has still counts as a modification, still bumps the
     * timestamp, and still reports itself as work done. Without this guard a
     * second run re-reported all 114 rows and quietly reordered
     * `{ status, updatedAt }`, which is the admin list's "what did we touch most
     * recently" sort. Found by running it twice.
     */
    { facets: `type:${RETIRED_PRODUCT_TYPE_SLUG}`, catalogue: { $ne: "template" } },
    { $set: { catalogue: "template" } },
  );
  console.log(`products promoted to template:  ${promoted.modifiedCount}`);

  // 2. Everything else is a script. `$exists: false` rather than a blanket write,
  //    so re-running cannot overwrite a decision somebody has since made.
  const scripts = await M.Product.updateMany(
    { catalogue: { $exists: false } },
    { $set: { catalogue: "script" } },
  );
  console.log(`products defaulted to script:   ${scripts.modifiedCount}`);

  /*
   * 3. Taxonomy scopes, from the canonical vocabulary.
   *
   * Only terms the vocabulary names. Anything somebody added through
   * `/admin/taxonomies` keeps the schema default of `both`, which is the right
   * answer for a term whose intended catalogue nobody has stated — usable in
   * either rather than in neither.
   */
  let scoped = 0;
  for (const term of TAXONOMY_VOCABULARY) {
    const slug = slugify(term.name);
    const result = await M.Taxonomy.updateOne(
      { kind: term.kind, slug, catalogue: { $ne: term.catalogue } },
      { $set: { catalogue: term.catalogue } },
    );
    scoped += result.modifiedCount;
  }
  console.log(`taxonomy terms scoped:          ${scoped}`);

  /*
   * 4. Retire the `template` product type.
   *
   * Deactivated, not deleted: `TaxonomyService.remove` refuses to delete a term
   * any product references, and after step 1 the promoted products still carry
   * `type:template` in `facets` until their next classification save. `isActive`
   * takes it out of every picker and every rail without dangling anything.
   */
  const retired = await M.Taxonomy.updateOne(
    { kind: "product_type", slug: RETIRED_PRODUCT_TYPE_SLUG, isActive: true },
    { $set: { isActive: false } },
  );
  console.log(`retired the template type:      ${retired.modifiedCount}`);

  // 5. The number this script exists to make zero.
  const residual = await M.Product.countDocuments({ catalogue: { $exists: false } });
  console.log(`\nproducts still missing it:      ${residual}`);
  if (residual > 0) {
    console.log(
      "\n⚠️  Not zero. The storefront tolerates it (the script predicate matches a\n" +
        "    missing field), but do not change that predicate to a plain equality\n" +
        "    until this reads 0.",
    );
  }

  const counts = await M.Product.aggregate<{ _id: string; count: number }>([
    { $group: { _id: "$catalogue", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log("\nby catalogue:");
  for (const row of counts) console.log(`  ${row._id ?? "(missing)"}: ${row.count}`);

  await mongoose.disconnect();
  console.log("\ndone\n");
}

/** The same slug rule the seed uses, so the two agree on `hr-and-rota`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
