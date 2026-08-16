import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { Product, type ProductDoc } from "@/lib/db/models/catalog";
import type { ProductStatus } from "@/lib/db/enums";

/**
 * Products.
 *
 * Not org-scoped: a product belongs to Innovatrix, not to a customer, so this
 * extends `BaseRepository` rather than `OrgScopedRepository`. `ProductDoc`
 * *does* carry `deletedAt`, so `deleteById` soft-deletes and every read here
 * excludes deleted rows through `baseFilter()`.
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

  /** Retire the current slug into history, then take the new one. */
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
