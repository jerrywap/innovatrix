import type { ClientSession, UpdateQuery } from "mongoose";
import { BaseRepository, RepositoryError } from "./base";
import { toObjectId } from "@/lib/db/base";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";
import { Product, type ProductDoc } from "@/lib/db/models/catalog";
import type { ProductStatus } from "@/lib/db/enums";

/**
 * Products.
 *
 * Not org-scoped: a product belongs to CoSetup or to a **vendor**, never to a
 * customer, so this extends `BaseRepository` rather than `OrgScopedRepository`.
 * Vendor ownership arrives as a *second* axis — `findScoped` / `updateScoped`
 * below — rather than as a base filter, because staff read across every vendor and
 * most products have no vendor at all. `ProductDoc` *does* carry `deletedAt`, so
 * `deleteById` soft-deletes and every read here excludes deleted rows through
 * `baseFilter()`.
 *
 * Queries only. Anything that decides *whether* a change is allowed —
 * transitions, publish readiness, facet derivation — lives in
 * `services/catalog/`.
 */
export class ProductRepository extends BaseRepository<ProductDoc> {
  async findBySlug(slug: string, options: { session?: ClientSession } = {}) {
    return this.findOne({ slug }, options);
  }

  /**
   * Find by a slug that may be an old one.
   *
   * `slugHistory` is what lets a renamed product keep answering its previous
   * URL with a 301 instead of a 404 — every link anyone ever shared stays
   * good. The caller compares `doc.slug` to what was asked for to decide
   * whether to redirect.
   */
  async findByCurrentOrPastSlug(slug: string) {
    return this.findOne({ $or: [{ slug }, { slugHistory: slug }] });
  }

  /**
   * Is this slug taken?
   *
   * Checks `slugHistory` too: reusing a retired slug would silently hijack the
   * redirect of the product that used to own it.
   *
   * A courtesy check only. The unique index on `slug` is the authority, and two
   * requests can both pass this before either writes — so the caller must still
   * handle a duplicate-key error.
   */
  async slugExists(slug: string, exceptId?: string): Promise<boolean> {
    const found = await this.model
      .findOne({ $or: [{ slug }, { slugHistory: slug }] })
      .select({ _id: 1 })
      .lean<{ _id: unknown }>();
    if (!found) return false;
    return exceptId ? String(found._id) !== exceptId : true;
  }

  /**
   * Move a product between states, but only from the state we think it is in.
   *
   * The `status: from` in the filter is optimistic concurrency, not decoration:
   * two administrators clicking publish at the same moment both pass the
   * service's checks, and without this both would write — producing two audit
   * entries for one transition. Here the second gets `null` and the service
   * turns that into a conflict the person can act on.
   */
  async setStatusIfCurrent(
    id: string,
    from: ProductStatus,
    to: ProductStatus,
    extra: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<ProductDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id), status: from, deletedAt: null },
        { $set: { status: to, ...extra } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<ProductDoc>();
  }

  /** Products referencing a taxonomy — for the rename re-derive and the delete guard. */
  /**
   * Several products by id, in one query.
   *
   * The cart's read path needs the live product for every line, and asking per
   * line is the N+1 that makes a five-item basket five round trips on every
   * page load. Bounded, like every list here.
   */
  async findManyByIds(
    ids: readonly string[],
    options: { session?: ClientSession } = {},
  ): Promise<ProductDoc[]> {
    if (ids.length === 0) return [];

    return this.model
      .find({ _id: { $in: ids.map((id) => toObjectId(id)) } })
      .limit(200)
      .session(options.session ?? null)
      .lean<ProductDoc[]>();
  }

  async idsReferencingTaxonomy(taxonomyId: string): Promise<string[]> {
    const id = toObjectId(taxonomyId);
    const docs = await this.model
      .find({
        $or: [
          { categoryIds: id },
          { industryIds: id },
          { technologyIds: id },
          { productTypeId: id },
        ],
        deletedAt: null,
      })
      .select({ _id: 1 })
      .limit(5000)
      .lean<Array<{ _id: unknown }>>();

    return docs.map((doc) => String(doc._id));
  }

  /**
   * How many products reference **every** taxonomy term, in one aggregation.
   *
   * The admin screen shows a usage count per row, and it used to get them by
   * firing `countReferencingTaxonomy` once per term, concurrently. Its docblock
   * justified that with "that is 28 counts … the bound is the size of the
   * vocabulary" — which was true, and is the problem: the vocabulary is the thing
   * about to grow. At a few hundred terms that is a few hundred simultaneous
   * `countDocuments` on an uncached admin page load.
   *
   * `$unwind` over the four id arrays instead: one pass, one round trip, bounded
   * by the number of *products* rather than by the number of terms.
   *
   * `productTypeId` is a single value rather than an array, so it is folded into
   * a one-element array before the unwind — `$unwind` on a scalar is an error,
   * and on a missing field it drops the document, which is what
   * `preserveNullAndEmptyArrays` guards against for the products that carry none.
   */
  async countsByTaxonomy(): Promise<Map<string, number>> {
    const rows = await this.model.aggregate<{ _id: unknown; count: number }>([
      { $match: { deletedAt: null } },
      {
        $project: {
          terms: {
            $setUnion: [
              { $ifNull: ["$categoryIds", []] },
              { $ifNull: ["$industryIds", []] },
              { $ifNull: ["$technologyIds", []] },
              { $cond: [{ $ifNull: ["$productTypeId", false] }, ["$productTypeId"], []] },
            ],
          },
        },
      },
      { $unwind: { path: "$terms", preserveNullAndEmptyArrays: false } },
      { $group: { _id: "$terms", count: { $sum: 1 } } },
    ]);

    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  /** How many products would a taxonomy delete orphan? */
  async countReferencingTaxonomy(taxonomyId: string): Promise<number> {
    const id = toObjectId(taxonomyId);
    return this.model.countDocuments({
      $or: [
        { categoryIds: id },
        { industryIds: id },
        { technologyIds: id },
        { productTypeId: id },
      ],
      deletedAt: null,
    });
  }

  /**
   * Rewrite `facets` for many products at once.
   *
   * Used after a taxonomy slug rename, which invalidates the derived slugs on
   * every referencing product. One `bulkWrite` rather than N updates because a
   * popular category can have hundreds.
   */
  async bulkSetFacets(
    entries: ReadonlyArray<{ id: string; facets: string[] }>,
    session?: ClientSession,
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const result = await this.model.bulkWrite(
      entries.map((entry) => ({
        updateOne: {
          filter: { _id: toObjectId(entry.id) },
          update: { $set: { facets: entry.facets } },
        },
      })),
      { session: session ?? undefined },
    );

    return result.modifiedCount ?? 0;
  }

  /* ────────────────────────────────────────────── vendor ownership */

  /**
   * One product, scoped to its owner — vendor ticket 04.
   *
   * `vendorFilter` throws on a blank scope rather than widening to every vendor,
   * which is the whole reason it exists. Omitting `vendorId` is a *staff* read and
   * has to be deliberate at the call site.
   *
   * Returns `null` for a product belonging to somebody else, which is what lets the
   * service answer **404 rather than 403**: distinguishing the two turns the
   * workspace into an oracle for which product ids are real, and the platform
   * already takes that position on downloads and AI conversations.
   */
  async findScoped(id: string, scope: VendorScope, options: { session?: ClientSession } = {}) {
    this.assertVendorPathExists();
    return this.findOne({ _id: toObjectId(id), ...vendorFilter(scope) }, options);
  }

  /**
   * Refuse to run a vendor-scoped query against a schema that has no `vendorId`.
   *
   * ## The fail-open this closes
   *
   * `connectToDatabase()` sets **`strictQuery: true`**, which makes Mongoose silently
   * drop filter conditions on paths the registered schema does not declare. Combined
   * with `defineModel()` — idempotent by design, so a long-running process keeps the
   * schema it first registered — a scoped read can lose its scope and become a read
   * across **every vendor**, with no error anywhere.
   *
   * Found exactly that way: a dev server started before `vendorId` was added to
   * `productSchema` served one vendor a first-party product's edit form, while the
   * same call in a fresh process correctly returned `null`. Nothing was wrong with the
   * query, the scope, or the session — the *schema* in that process predated the field,
   * so `{ vendorId }` was stripped before it reached Mongo.
   *
   * In production the schema always matches the process, so this cannot happen. That
   * is precisely why it is worth asserting: the failure mode is invisible, it appears
   * only in the environment where nobody is looking for it, and it fails **open**.
   * `products.test.ts` asserts the path exists so a removal is caught at test time
   * rather than here.
   */
  private assertVendorPathExists(): void {
    if (!this.model.schema.path("vendorId")) {
      throw new RepositoryError(
        "Product schema has no `vendorId` path, so a vendor-scoped query would be " +
          "silently unscoped (strictQuery drops unknown paths). Refusing to run it. " +
          "If this is a dev server, restart it — `defineModel` keeps the schema it " +
          "first registered, so a field added since startup is not in it.",
      );
    }
  }

  /**
   * Update a product only if it belongs to this vendor.
   *
   * The predicate is **in the filter**, not in a read-then-write. Two reasons: a
   * check-then-update is a race, and more importantly a caller who forgets the
   * check gets nothing rather than somebody else's product — removing the
   * page-level guard alone opens nothing.
   */
  async updateScoped(
    id: string,
    scope: VendorScope,
    update: UpdateQuery<ProductDoc>,
    options: { session?: ClientSession } = {},
  ): Promise<ProductDoc | null> {
    this.assertVendorPathExists();
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id), deletedAt: null, ...vendorFilter(scope) },
        update,
        {
          returnDocument: "after",
          runValidators: true,
          session: options.session ?? null,
        },
      )
      .lean<ProductDoc>();
  }

  /**
   * Re-denormalise a vendor's display name across their products.
   *
   * `vendorName` is a cache on `Product` so a marketplace card can attribute itself
   * without a query per row (§94). `Vendor` remains the source of truth (§103), so
   * a rename has to sweep — the alternative is cards that name the vendor something
   * they no longer call themselves.
   *
   * The **slug** is not swept because it cannot change once a vendor is verified.
   * That is what keeps the `vend:` facet and the storefront URL stable, and it is
   * why the two are separate fields.
   */
  async renameVendor(vendorId: string, displayName: string): Promise<number> {
    const result = await this.model.updateMany(
      { vendorId: toObjectId(vendorId) },
      { $set: { vendorName: displayName } },
    );
    return result.modifiedCount ?? 0;
  }

  /** Retire the current slug into history, then take the new one. */
  /**
   * The website template listing that says it is the front-end of this script.
   *
   * `baseFilter()` already excludes soft-deleted rows, which matches the partial
   * unique index's own `deletedAt: null` condition — so this and the index agree
   * about what "already linked" means.
   *
   * Read on an authoring screen and by `softDelete`, never on a hot path.
   */
  async findTemplateSiblingOf(scriptId: string) {
    return this.model
      .findOne({ ...this.baseFilter(), scriptListingId: toObjectId(scriptId) })
      .lean<ProductDoc>();
  }

  /**
   * Point this template at a script, but only if it is not already pointed
   * somewhere — COS-9.
   *
   * `createTemplateSibling` does not need this: it writes the edge on the document
   * it has just inserted, which nothing else can be holding. `createScriptSibling`
   * runs the pair the other way round and writes the edge on the *existing*
   * template, so two vendors (or two tabs) racing would otherwise have the second
   * silently overwrite the first's pointer and strand a linked script.
   *
   * The `$exists: false` in the **filter** is what makes that impossible: the loser
   * matches nothing and gets `null` back, which the service turns into the same
   * `ConflictError` the partial unique index would have raised. A read-then-write
   * would leave the window open.
   */
  async linkScriptListing(templateId: string, scriptId: string) {
    return this.model
      .findOneAndUpdate(
        {
          _id: toObjectId(templateId),
          deletedAt: null,
          scriptListingId: { $exists: false },
        },
        { $set: { scriptListingId: toObjectId(scriptId) } },
        { returnDocument: "after" },
      )
      .lean<ProductDoc>();
  }

  /** How many live templates point at this script — for `softDelete`'s refusal. */
  async countTemplateSiblingsOf(scriptId: string): Promise<number> {
    return this.model.countDocuments({
      ...this.baseFilter(),
      scriptListingId: toObjectId(scriptId),
    });
  }

  async changeSlug(id: string, from: string, to: string, session?: ClientSession) {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id), deletedAt: null },
        { $set: { slug: to }, $addToSet: { slugHistory: from } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<ProductDoc>();
  }
}

export const products = new ProductRepository(Product);
