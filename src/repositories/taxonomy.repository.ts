import type { ClientSession, Types } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { Taxonomy, type TaxonomyDoc } from "@/lib/db/models/catalog";
import type { TaxonomyCatalogue, TaxonomyKind } from "@/lib/db/enums";

/**
 * Categories, industries, technologies and product types — §7.
 *
 * One collection, four kinds, and slugs unique **per kind**: there can be a
 * `finance` category and a `finance` industry, which is why every lookup here
 * takes a kind.
 *
 * Note `TaxonomyDoc` has no `deletedAt`, so `BaseRepository.deleteById` **hard
 * deletes**. Nothing may call it without first proving the taxonomy is unused —
 * a dangling id in `products.categoryIds` and a stale slug in `products.facets`
 * are both invisible failures. `TaxonomyService.remove` is the only sanctioned
 * caller.
 */
export class TaxonomyRepository extends BaseRepository<TaxonomyDoc> {
  /** Everything of one kind, in the order an admin arranged it. */
  async listByKind(
    kind: TaxonomyKind,
    options: { activeOnly?: boolean; session?: ClientSession } = {},
  ): Promise<TaxonomyDoc[]> {
    return this.model
      .find({ kind, ...(options.activeOnly ? { isActive: true } : {}) })
      .sort({ sortOrder: 1, name: 1 })
      .session(options.session ?? null)
      .lean<TaxonomyDoc[]>();
  }

  /**
   * Every taxonomy, for the marketplace's cached vocabulary.
   *
   * Bounded by the nature of the thing — a storefront has tens of categories,
   * not thousands — so this is one of the few reads that legitimately has no
   * pagination (§94's "no unbounded reads" is about user-controlled sets).
   */
  async listAll(options: { activeOnly?: boolean } = {}): Promise<TaxonomyDoc[]> {
    return this.model
      .find(options.activeOnly ? { isActive: true } : {})
      .sort({ kind: 1, sortOrder: 1, name: 1 })
      .limit(500)
      .lean<TaxonomyDoc[]>();
  }

  async findBySlug(kind: TaxonomyKind, slug: string): Promise<TaxonomyDoc | null> {
    return this.model.findOne({ kind, slug }).lean<TaxonomyDoc>();
  }

  /** Is this slug already used *within its kind*? */
  async slugExists(kind: TaxonomyKind, slug: string, exceptId?: string): Promise<boolean> {
    const found = await this.model
      .findOne({ kind, slug })
      .select({ _id: 1 })
      .lean<{ _id: unknown }>();
    if (!found) return false;
    return exceptId ? String(found._id) !== exceptId : true;
  }

  /**
   * id → slug, for deriving `products.facets`.
   *
   * A map rather than a list because the caller is joining three id arrays
   * against it and wants O(1) lookups, not three nested scans.
   */
  async slugsByIds(ids: readonly (string | Types.ObjectId)[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    // Deduplicated first: a product commonly shares an id between two of its
    // taxonomy arrays, and asking twice is a wasted key in the index scan.
    const unique = [...new Set(ids.map(String))].map((id) => toObjectId(id));

    const docs = await this.model
      .find({ _id: { $in: unique } })
      .select({ slug: 1 })
      .lean<Array<{ _id: Types.ObjectId; slug: string }>>();

    return new Map(docs.map((doc) => [String(doc._id), doc.slug]));
  }

  /**
   * Each term's catalogue scope, for checking a classification against it.
   *
   * Returns names alongside the scope because the only caller refuses with a
   * message that has to say *which* terms were wrong — an error listing object ids
   * is one the person reading it cannot act on.
   */
  async scopesByIds(
    ids: readonly (string | Types.ObjectId)[],
  ): Promise<Map<string, { catalogue: TaxonomyCatalogue; name: string }>> {
    if (ids.length === 0) return new Map();

    const unique = [...new Set(ids.map(String))].map((id) => toObjectId(id));

    const docs = await this.model
      .find({ _id: { $in: unique } })
      .select({ catalogue: 1, name: 1 })
      .lean<Array<{ _id: Types.ObjectId; catalogue?: TaxonomyCatalogue; name: string }>>();

    return new Map(
      docs.map((doc) => [
        String(doc._id),
        // Absent ⇒ `both`, matching the schema default, so a term written before
        // the field existed is usable in either catalogue rather than neither.
        { catalogue: doc.catalogue ?? "both", name: doc.name },
      ]),
    );
  }
}

export const taxonomies = new TaxonomyRepository(Taxonomy);
