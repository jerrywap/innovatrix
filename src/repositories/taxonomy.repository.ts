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
   * child slug → parent slug, for the whole category vocabulary.
   *
   * One read of a two-field projection rather than a `$lookup` or a per-slug
   * query: the category vocabulary is a couple of hundred terms at its largest,
   * both tiers come back in the same pass, and the map is what `withAncestors`
   * needs to turn a product's categories into its facets.
   *
   * Deliberately **not** scoped by `isActive`. A product filed under a category
   * somebody has just deactivated still needs its parent facet — otherwise
   * deactivating a term would silently drop every one of its products off the
   * parent's landing page, which is the opposite of what "stop offering this"
   * means.
   */
  async parentSlugByChildSlug(): Promise<Map<string, string>> {
    const rows = await this.model
      .find({ kind: "category" })
      .select({ slug: 1, parentId: 1 })
      .lean<Array<{ _id: Types.ObjectId; slug: string; parentId?: Types.ObjectId }>>();

    const slugById = new Map(rows.map((row) => [String(row._id), row.slug]));

    const parents = new Map<string, string>();
    for (const row of rows) {
      const parentSlug = row.parentId ? slugById.get(String(row.parentId)) : undefined;
      if (parentSlug) parents.set(row.slug, parentSlug);
    }
    return parents;
  }

  /**
   * How many children a term has — the other half of the delete guard.
   *
   * `deleteTaxonomy` refuses while any *product* references a term, which is the
   * right guard for a leaf and no guard at all for a parent: a parent carries no
   * products of its own, so that count is zero and the delete would be waved
   * through, orphaning every child under it.
   *
   * Indexed by `{kind, parentId}`.
   */
  async countChildren(id: string | Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ parentId: toObjectId(String(id)) });
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
