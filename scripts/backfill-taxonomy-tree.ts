import "dotenv/config";
import mongoose from "mongoose";
import { slugify } from "../src/lib/slug";
import {
  MERGED_TERMS,
  RENAMED_SLUGS,
  RETIRED_TERMS,
  TAXONOMY_VOCABULARY,
} from "./taxonomy-vocabulary";

/**
 * Give the category vocabulary a first tier, and every product a primary category.
 *
 * ## Run this **after** `db:indexes` and **before** deploying the reading code
 *
 * `db:indexes` builds `{kind, parentId}`, which `countChildren` sorts on. Nothing
 * here depends on that index existing, but the delete guard it feeds does.
 *
 * The four passes are ordered, and the order is not arbitrary: a child cannot be
 * linked before its parent has an id, and the ancestor facets in pass 4 cannot be
 * derived before the links in pass 2 exist. Running pass 4 first produces a
 * silent no-op, not an error — the facets simply come out the way they already are.
 *
 * ## Idempotent
 *
 * Every write is conditional on the state it is changing — `$setOnInsert` for the
 * parents, `parentId: { $ne: … }` for the links, `$exists: false` for the primary,
 * and a comparison against the stored array for the facets. Run it twice and the
 * second run reports zero on all four.
 *
 * `$setOnInsert` rather than `$set` on the parents is the specific trap
 * `backfill-catalogue.ts` documents after being caught by it: `timestamps: true`
 * stamps `updatedAt` on every **matched** document, so a `$set` to a value the
 * document already holds still counts as a modification, still bumps the
 * timestamp, and still reports itself as work done — while quietly reordering the
 * admin list's `{status, updatedAt}` sort.
 *
 * ## What it does *not* do
 *
 * It does not rename, re-slug or move any existing term. Every one of the twelve
 * categories that exists today keeps its slug and its products; nine of them gain
 * a parent above them and three stay roots. A category URL that moves takes its
 * rankings with it, which is the whole reason the starter tree is shaped this way.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Use --env-file=.env.local.");

  /*
   * `--dry-run` counts what would change and writes nothing.
   *
   * This is the one script here meant to be pointed at a live database, and the
   * numbers it prints are the only way to know beforehand whether it is about to
   * touch nine rows or nine hundred. The guard wraps the writes rather than
   * returning early, so a dry run still executes every read and every decision —
   * a rehearsal that skipped the lookups would not rehearse the thing that can
   * fail.
   *
   * **A later pass can overstate.** Each one sees the database as it *is*, not as
   * the passes before it would have left it — so pass 4 counts every product whose
   * facets differ today, including ones that only differ because pass 2 has not
   * linked their parent yet. Measured: a rehearsal predicted 250 re-facets where
   * the real run needed none. The counts for passes 1 and 2 are exact, and they
   * are the ones that say how large the change is.
   */
  const dryRun = process.argv.includes("--dry-run");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  const M = await import("../src/lib/db/models");

  console.log(
    dryRun ? "\ndry run — nothing will be written\n" : "\nbackfilling the category tree\n",
  );

  /*
   * 0. Slugs written wrong, moved before anything matches on one.
   *
   * Must run first: pass 1 matches on `{kind, slug}`, so a stale slug left in
   * place would make the corrected term look absent and be **created alongside**
   * it — two rows for one concept, which is the thing the unique index cannot
   * catch because the slugs genuinely differ. See `RENAMED_SLUGS`.
   */
  let renamed = 0;
  for (const rename of RENAMED_SLUGS) {
    if (dryRun) {
      renamed += await M.Taxonomy.countDocuments({ kind: rename.kind, slug: rename.from });
      continue;
    }
    const result = await M.Taxonomy.updateOne(
      { kind: rename.kind, slug: rename.from },
      { $set: { slug: rename.to } },
    );
    renamed += result.modifiedCount;
  }
  if (renamed > 0) console.log(`slugs corrected:                ${renamed}`);

  /*
   * 1. Every term in the vocabulary.
   *
   * Not just the parents any more — this script is how an existing database gets
   * the whole 353-term list, the way `prod-bootstrap` gets it into an empty one.
   *
   * **A field is written only when it actually differs.** `timestamps: true`
   * stamps `updatedAt` on every *matched* document, so a blanket `$set` reports
   * itself as work, restamps the entire vocabulary, and reorders the admin list's
   * `{status, updatedAt}` sort — the trap `backfill-catalogue.ts` documents after
   * being caught by it. Diffing first is what makes a second run report zero.
   *
   * `name` is in the diff on purpose. Nine terms are **renamed** here — `booking`
   * becomes "Booking & Reservations", `hr-and-rota` becomes "HR Management" — and
   * every one of them keeps its slug, because a category URL that moves takes its
   * rankings with it. That is a visible change on live pages, and it is the
   * intended one.
   */
  const existing = new Map(
    (
      await M.Taxonomy.find({})
        .select({
          kind: 1,
          slug: 1,
          name: 1,
          catalogue: 1,
          description: 1,
          sortOrder: 1,
          isActive: 1,
        })
        .lean()
    ).map((row) => [`${row.kind}:${row.slug}`, row]),
  );

  let created = 0;
  let updated = 0;
  for (const term of TAXONOMY_VOCABULARY) {
    const slug = term.slug ?? slugify(term.name);
    const current = existing.get(`${term.kind}:${slug}`);

    if (!current) {
      created += 1;
      if (dryRun) continue;
      await M.Taxonomy.create({
        kind: term.kind,
        slug,
        name: term.name,
        catalogue: term.catalogue,
        sortOrder: term.sortOrder,
        isActive: true,
        ...(term.description ? { description: term.description } : {}),
      });
      continue;
    }

    const changes: Record<string, unknown> = {};
    if (current.name !== term.name) changes.name = term.name;
    if (current.catalogue !== term.catalogue) changes.catalogue = term.catalogue;
    if (current.sortOrder !== term.sortOrder) changes.sortOrder = term.sortOrder;
    if (term.description && current.description !== term.description) {
      changes.description = term.description;
    }
    if (current.isActive !== true) changes.isActive = true;

    if (Object.keys(changes).length > 0) {
      updated += 1;
      if (!dryRun) await M.Taxonomy.updateOne({ _id: current._id }, { $set: changes });
    }
  }
  console.log(`terms created:                  ${created}`);
  console.log(`terms updated:                  ${updated}`);

  /*
   * 2. The links.
   *
   * `parentId: { $ne: parentId }` is what makes a second run report zero, and it
   * is also what stops this overwriting a parent somebody has since changed by
   * hand — it only ever writes the link that is missing or different, never the
   * one already correct.
   */
  const idByName = new Map(
    (await M.Taxonomy.find({ kind: "category" }).select({ name: 1 }).lean()).map((row) => [
      row.name,
      row._id,
    ]),
  );

  let linked = 0;
  for (const child of TAXONOMY_VOCABULARY) {
    if (child.kind !== "category" || !child.parent) continue;
    const parentId = idByName.get(child.parent);

    /*
     * On a real run a missing parent is a bug — pass 1 has just written every
     * one of them, so absence means the vocabulary names a parent it does not
     * define, and continuing would file children under nothing.
     *
     * On a **dry run** it is the expected state: pass 1 wrote nothing, so a
     * parent this migration would create is not there to be found. The child is
     * counted as "would link" rather than throwing — a rehearsal that aborts at
     * the first thing it declined to do rehearses only its own first step.
     */
    if (!parentId) {
      if (!dryRun) {
        throw new Error(`missing parent category "${child.parent}" for "${child.name}"`);
      }
      linked += 1;
      continue;
    }

    const filter = {
      kind: "category" as const,
      slug: child.slug ?? slugify(child.name),
      parentId: { $ne: parentId },
    };
    if (dryRun) {
      linked += await M.Taxonomy.countDocuments(filter);
      continue;
    }
    const result = await M.Taxonomy.updateOne(filter, { $set: { parentId } });
    linked += result.modifiedCount;
  }
  console.log(`children linked:                ${linked}`);

  /*
   * 3. The primary category.
   *
   * A pipeline update rather than a read loop: `$arrayElemAt` reads the field the
   * document already has, so a thousand products is one round trip.
   *
   * `$exists: false` is the guard, and it does a second job — it means this can
   * never overwrite a primary a vendor has since chosen. Re-running after the
   * wizard ships is safe by construction rather than by timing.
   *
   * Worth knowing before you read the diff on a live product page: `categoryIds[0]`
   * is *submission* order, while the category the page shows today is the
   * alphabetically-first `cat:` facet (`buildProductFacets` sorts). Those are
   * different values, so this will change the visible category on some published
   * pages. That is the point — the alphabetical one was never anybody's intent —
   * but it is a content change, not a no-op.
   */
  const primaryFilter = {
    "categoryIds.0": { $exists: true },
    primaryCategoryId: { $exists: false },
  };
  const primaries = dryRun
    ? { modifiedCount: await M.Product.countDocuments(primaryFilter) }
    : await M.Product.updateMany(
        primaryFilter,
        [{ $set: { primaryCategoryId: { $arrayElemAt: ["$categoryIds", 0] } } }],
        // Mongoose refuses an array update without this — it cannot tell a pipeline
        // from someone passing the wrong shape, and defaults to assuming the mistake.
        { updatePipeline: true },
      );
  console.log(`products given a primary:       ${primaries.modifiedCount}`);

  /*
   * 4. Merge the auto-created strays into their canonical terms.
   *
   * `seed-bulk.ts` used to invent a term whenever its weights named a slug the
   * vocabulary did not have, which is how `nextjs` came to exist beside `next-js`.
   * Both are real terms with real products — in a bulk-seeded database the stray
   * is the *popular* one — so this repoints every referencing product at the
   * canonical id before turning the stray off.
   *
   * Before the facet pass, deliberately: the re-derive below reads
   * `technologyIds`, so merging afterwards would leave every one of those
   * products carrying the stray's slug in `facets` until something else touched
   * them.
   *
   * `$addToSet` then `$pull`, in that order and never a single `$set`.
   * `$addToSet` is a no-op for a product that already holds the canonical term,
   * so the pair needs no guard against ending up with it twice — and doing the
   * `$pull` first would lose the reference on any product that held only the
   * stray.
   */
  const ID_FIELD = {
    category: "categoryIds",
    industry: "industryIds",
    technology: "technologyIds",
    // `productTypeId` is a single value rather than an array, so it would need a
    // `$set`/`$unset` pair rather than `$addToSet`/`$pull`. Nothing merges a
    // product type today; this refuses rather than writing the wrong shape.
    product_type: null,
  } as const;

  let merged = 0;
  let mergedProducts = 0;
  for (const merge of MERGED_TERMS) {
    const field = ID_FIELD[merge.kind as keyof typeof ID_FIELD];
    if (!field) throw new Error(`merging a ${merge.kind} is not supported`);

    const from = await M.Taxonomy.findOne({ kind: merge.kind, slug: merge.from }).lean();
    const into = await M.Taxonomy.findOne({ kind: merge.kind, slug: merge.into }).lean();
    if (!from || !into) continue;

    if (dryRun) {
      mergedProducts += await M.Product.countDocuments({ [field]: from._id });
      if (from.isActive) merged += 1;
      continue;
    }

    await M.Product.updateMany({ [field]: from._id }, { $addToSet: { [field]: into._id } });
    const pulled = await M.Product.updateMany(
      { [field]: from._id },
      { $pull: { [field]: from._id } },
    );
    mergedProducts += pulled.modifiedCount;

    if (from.isActive) {
      await M.Taxonomy.updateOne({ _id: from._id }, { $set: { isActive: false } });
      merged += 1;
    }
  }
  console.log(
    `strays merged:                  ${merged} (${mergedProducts} products repointed)`,
  );

  /*
   * 5. Retire the terms this vocabulary drops.
   *
   * Deactivated rather than deleted: `deleteTaxonomy` refuses while any product
   * references a term, and these are referenced. An inactive term keeps resolving
   * for the products that hold it — `slugsByIds` does not filter on `isActive` —
   * so nothing loses a facet, it just stops being offered.
   */
  let retired = 0;
  for (const term of RETIRED_TERMS) {
    const filter = { kind: term.kind, slug: term.slug, isActive: true };
    if (dryRun) {
      retired += await M.Taxonomy.countDocuments(filter);
      continue;
    }
    const result = await M.Taxonomy.updateOne(filter, { $set: { isActive: false } });
    retired += result.modifiedCount;
  }
  console.log(`terms retired:                  ${retired}`);

  /*
   * 4. The ancestor facets.
   *
   * This is the pass that makes the parent landing pages mean anything. A product
   * filed under `crm` needs `cat:business-operations` in `facets` too — see
   * `withAncestors` for why that is stored rather than computed — and nothing
   * about the *products* changed here, so nothing else would ever write it.
   *
   * It has to run after pass 2: `deriveFacetsForMany` reads the parent links, so
   * running it first is a silent no-op rather than an error.
   *
   * Only products that actually gain a term are written. Comparing the derived
   * array against the stored one is what makes a second run report zero — and
   * it is not optional politeness: `timestamps: true` would otherwise restamp
   * every product in the catalogue on every run.
   */
  const { deriveFacetsForMany } = await import("../src/services/catalog/facets");

  const withCategories = await M.Product.find({ "categoryIds.0": { $exists: true } })
    .select({
      categoryIds: 1,
      industryIds: 1,
      technologyIds: 1,
      productTypeId: 1,
      vendorSlug: 1,
      facets: 1,
    })
    .lean();

  let refaceted = 0;
  for (let offset = 0; offset < withCategories.length; offset += 200) {
    const batch = withCategories.slice(offset, offset + 200);
    const derived = await deriveFacetsForMany(
      batch.map((product) => ({
        id: String(product._id),
        categoryIds: product.categoryIds,
        industryIds: product.industryIds,
        technologyIds: product.technologyIds,
        productTypeId: product.productTypeId,
        ...(product.vendorSlug ? { vendorSlug: product.vendorSlug } : {}),
      })),
    );
    const storedById = new Map(batch.map((p) => [String(p._id), (p.facets ?? []).join(" ")]));

    const writes = derived
      .filter((row) => row.facets.join(" ") !== storedById.get(row.id))
      .map((row) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(row.id) },
          update: { $set: { facets: row.facets } },
        },
      }));

    if (writes.length > 0) {
      if (dryRun) {
        refaceted += writes.length;
      } else {
        const result = await M.Product.bulkWrite(writes);
        refaceted += result.modifiedCount;
      }
    }
  }
  console.log(`products re-faceted:            ${refaceted}`);

  /*
   * 5. Residuals — the numbers this script exists to make zero, and one that is
   *    a report rather than a failure.
   */
  const unparented = await M.Taxonomy.countDocuments({
    kind: "category",
    slug: {
      $in: TAXONOMY_VOCABULARY.filter((t) => t.kind === "category" && t.parent).map(
        (t) => t.slug ?? slugify(t.name),
      ),
    },
    parentId: { $exists: false },
  });
  const missingPrimary = await M.Product.countDocuments({
    "categoryIds.0": { $exists: true },
    primaryCategoryId: { $exists: false },
  });

  console.log(`\nchildren still unparented:      ${unparented}`);
  console.log(`products still missing primary: ${missingPrimary}`);

  /*
   * Not an error. These are terms an admin added, or the ones `seed-bulk.ts`
   * auto-created before its weights were reconciled with the vocabulary. They
   * render as roots, which is correct — and printing the count is what stops
   * somebody "tidying" pass 2 into a blanket write over every category.
   */
  const known = new Set(
    TAXONOMY_VOCABULARY.filter((t) => t.kind === "category").map(
      (t) => t.slug ?? slugify(t.name),
    ),
  );
  const strays = (
    await M.Taxonomy.find({ kind: "category" }).select({ slug: 1 }).lean()
  ).filter((row) => !known.has(row.slug));
  console.log(
    `categories outside the tree:    ${strays.length}${
      strays.length > 0 ? ` (${strays.map((s) => s.slug).join(", ")})` : ""
    }`,
  );

  if (unparented > 0 || missingPrimary > 0) {
    console.log(
      "\n⚠️  Not zero. The storefront tolerates both — an unparented child renders\n" +
        "    as a root, and a missing primary falls back to the first category — but\n" +
        "    the two-tier landing pages are wrong until this reads 0.",
    );
  }

  await mongoose.disconnect();
  console.log("\ndone\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
