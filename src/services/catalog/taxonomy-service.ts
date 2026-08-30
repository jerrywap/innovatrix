import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { TaxonomyDoc } from "@/lib/db/models/catalog";
import type { TaxonomyCatalogue, TaxonomyKind } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isReservedCatalogueSegment, RESERVED_CATALOGUE_SEGMENTS } from "@/config/catalogue";
import { slugify, uniqueSlug } from "@/lib/slug";
import { products } from "@/repositories/product.repository";
import { taxonomies } from "@/repositories/taxonomy.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { deriveFacetsForMany } from "./facets";

/**
 * Categories, industries, technologies and product types — §7.
 *
 * Small, and two of its operations are more dangerous than they look:
 *
 * - **Renaming a slug** invalidates `products.facets` on every referencing
 *   product, because facets store slugs. Missing that means the marketplace
 *   silently stops matching a filter that used to work.
 * - **Deleting** hard-deletes, because `TaxonomyDoc` has no `deletedAt`.
 *   Deleting one still in use leaves dangling ids and stale facet strings, and
 *   nothing errors.
 *
 * Both are handled here, and `INTEGRITY.md` records the rules.
 */

/** How many products get re-derived per `bulkWrite`. */
const REDERIVE_BATCH = 200;

export interface TaxonomyInput {
  kind: TaxonomyKind;
  /** `both` unless stated — see `TAXONOMY_CATALOGUES`. */
  catalogue?: TaxonomyCatalogue;
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  /** The browse-card image URL. `""` clears it. */
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
  /**
   * The parent category, for a `category` only. `null` clears it, making the
   * term a root; `undefined` leaves it alone.
   *
   * The tri-state matters because `Partial<TaxonomyInput>` is how an update
   * arrives, and "promote this to a root" and "do not touch the parent" are
   * different intents that both look like a missing field otherwise.
   */
  parentId?: string | null;
}

export async function createTaxonomy(
  input: TaxonomyInput,
  actor: AuditActor,
): Promise<TaxonomyDoc> {
  await connectToDatabase();

  const desired = input.slug ? slugify(input.slug) : slugify(input.name);
  assertNotReserved(desired, input.kind);
  const slug = await uniqueSlug(desired, (candidate) =>
    taxonomies.slugExists(input.kind, candidate),
  );

  const created = await taxonomies.create({
    kind: input.kind,
    catalogue: input.catalogue ?? "both",
    name: input.name.trim(),
    slug,
    ...(input.description ? { description: input.description } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
    // Only categories nest; `parentId` on any other kind is ignored rather than
    // rejected, because nothing offers the control for them in the first place.
    ...(input.kind === "category" && input.parentId
      ? { parentId: toObjectId(input.parentId) }
      : {}),
  } as Partial<TaxonomyDoc>);

  await writeAuditLog({
    action: "taxonomy.created",
    actor,
    after: { kind: created.kind, slug: created.slug, name: created.name },
  });

  return created;
}

/**
 * Update a taxonomy, re-deriving product facets when the slug moves.
 *
 * The re-derive is **not** `updateMany({ facets: "cat:old" }, { $set: {
 * "facets.$": "cat:new" } })`, tempting though that is as a single query. It
 * would make a second writer of a derived field, breaking the sorted and
 * deduplicated invariant `buildProductFacets()` establishes — precisely the
 * drift `ERD.md` warns about. Re-deriving from the ids is bounded (a taxonomy
 * has tens to low hundreds of products) and rare.
 */
export async function updateTaxonomy(
  id: string,
  input: Partial<TaxonomyInput>,
  actor: AuditActor,
): Promise<{ taxonomy: TaxonomyDoc; productsReindexed: number }> {
  await connectToDatabase();

  const existing = await taxonomies.findById(id);
  if (!existing) throw new NotFoundError("taxonomy", { id });

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.description !== undefined) update.description = input.description;
  if (input.icon !== undefined) update.icon = input.icon;
  if (input.imageUrl !== undefined) update.imageUrl = input.imageUrl;
  if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) update.isActive = input.isActive;
  if (input.catalogue !== undefined) update.catalogue = input.catalogue;

  /*
   * A parent change re-derives products, exactly as a slug change does.
   *
   * Not obvious, and the reason it is here rather than left out: a product
   * carries its category's parent in `facets` (see `withAncestors`). So
   * re-parenting a term changes the correct facets of every product filed under
   * it — and nothing about the *product* changed, so nothing else would ever
   * re-derive them. The parent's landing page would simply be missing products,
   * with nothing logged.
   */
  let parentChanged = false;
  if (input.parentId !== undefined) {
    const next = input.parentId ? toObjectId(input.parentId) : undefined;
    if (String(next ?? "") !== String(existing.parentId ?? "")) {
      if (existing.kind !== "category") {
        throw new ValidationError("Only categories can sit under a parent.", {
          parentId: ["This kind is a flat list."],
        });
      }
      if (next && String(next) === id) {
        throw new ValidationError("A category cannot be its own parent.", {
          parentId: ["Pick a different parent."],
        });
      }
      if (next) {
        const parent = await taxonomies.findById(String(next));
        if (!parent || parent.kind !== "category") {
          throw new ValidationError("That parent does not exist.", {
            parentId: ["Pick a category."],
          });
        }
        /*
         * One level deep, and this is where that is enforced rather than assumed.
         * `withAncestors` does a single lookup, so a grandchild would carry its
         * parent's facet and not its grandparent's — a tree that renders wrong
         * rather than one that errors.
         */
        if (parent.parentId) {
          throw new ValidationError("Categories only nest one level deep.", {
            parentId: [`"${parent.name}" is itself under another category.`],
          });
        }
      }
      if (next) update.parentId = next;
      parentChanged = true;
    }
  }

  let slugChanged = false;
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    if (slug !== existing.slug) {
      if (await taxonomies.slugExists(existing.kind, slug, id)) {
        throw new ValidationError("That address is already used by another entry.", {
          slug: [`"${slug}" is taken within ${existing.kind}.`],
        });
      }
      assertNotReserved(slug, existing.kind);
      update.slug = slug;
      slugChanged = true;
    }
  }

  const taxonomy = await taxonomies.updateById(id, {
    $set: update,
    // An empty image URL is a removal, not a value.
    ...(update.imageUrl === "" ? { $unset: { imageUrl: "" } } : {}),
    // Promoting a child to a root **unsets** rather than writing `null`:
    // `TaxonomyDoc.parentId` is "absent on a root", and a stored `null` would
    // make `{ parentId: { $exists: false } }` — the backfill's residual check —
    // quietly stop seeing it.
    ...(parentChanged && !update.parentId ? { $unset: { parentId: "" } } : {}),
  });
  if (!taxonomy) throw new NotFoundError("taxonomy", { id });

  const productsReindexed = slugChanged || parentChanged ? await reindexProductsFor(id) : 0;

  await writeAuditLog({
    action: "taxonomy.updated",
    actor,
    before: { slug: existing.slug, name: existing.name },
    after: { slug: taxonomy.slug, name: taxonomy.name, productsReindexed },
  });

  return { taxonomy, productsReindexed };
}

/**
 * Refuse a slug that would be shadowed by a static route segment.
 *
 * Categories only, because they are the only kind that gets a one-segment URL
 * directly under `/marketplace` or `/templates`. An industry called `category`
 * lives at `/marketplace/industry/category` and collides with nothing.
 *
 * A refusal rather than a silent rename, and here rather than in the form,
 * because this is the write path — the admin screen is one caller and the seeds
 * are others. `uniqueSlug` already lives beside it, so the two slug rules sit
 * together instead of one being remembered and the other enforced.
 */
function assertNotReserved(slug: string, kind: TaxonomyKind): void {
  if (kind !== "category" || !isReservedCatalogueSegment(slug)) return;
  throw new ValidationError("That address is reserved by the marketplace itself.", {
    slug: [
      `"${slug}" cannot be used — ${RESERVED_CATALOGUE_SEGMENTS.join(" and ")} are routes.`,
    ],
  });
}

/**
 * Re-derive `facets` on every product referencing a taxonomy.
 *
 * Batched because a popular category can have hundreds of products and one
 * `bulkWrite` per 200 is the difference between a save that returns and one
 * that times out.
 */
async function reindexProductsFor(taxonomyId: string): Promise<number> {
  const ids = await products.idsReferencingTaxonomy(taxonomyId);
  if (ids.length === 0) return 0;

  let reindexed = 0;

  for (let offset = 0; offset < ids.length; offset += REDERIVE_BATCH) {
    const batch = ids.slice(offset, offset + REDERIVE_BATCH);

    const docs = await Promise.all(batch.map((id) => products.findById(id)));
    const present = docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null);

    const derived = await deriveFacetsForMany(
      present.map((doc) => ({
        id: String(doc._id),
        categoryIds: doc.categoryIds,
        industryIds: doc.industryIds,
        technologyIds: doc.technologyIds,
        productTypeId: doc.productTypeId,
      })),
    );

    reindexed += await products.bulkSetFacets(derived);
  }

  return reindexed;
}

/**
 * Delete a taxonomy — refused while anything references it.
 *
 * `restrict`, not `cascade`: removing a category from every product that uses
 * it is a data change nobody asked for, and the administrator almost always
 * means "stop offering this", which is `isActive: false`.
 *
 * The count is in the message because "it's in use" without a number leaves
 * someone hunting.
 */
export async function deleteTaxonomy(id: string, actor: AuditActor): Promise<void> {
  await connectToDatabase();

  const taxonomy = await taxonomies.findById(id);
  if (!taxonomy) throw new NotFoundError("taxonomy", { id });

  const inUse = await products.countReferencingTaxonomy(id);
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} product${inUse === 1 ? "" : "s"} still use this ${label(taxonomy.kind)}. ` +
        `Reassign them first, or set it inactive to stop offering it without ` +
        `breaking what already exists.`,
    );
  }

  /*
   * The product count above is not a guard for a *parent*.
   *
   * A parent category carries no products of its own — products are filed under
   * children — so `inUse` is zero for exactly the term whose deletion does the
   * most damage. Without this the delete succeeds, every child keeps a
   * `parentId` pointing at nothing, and each of them quietly reappears as a root
   * with its own top-level landing page.
   */
  const children = await taxonomies.countChildren(id);
  if (children > 0) {
    throw new ConflictError(
      `${children} categor${children === 1 ? "y is" : "ies are"} filed under this one. ` +
        `Move them somewhere else first, or set it inactive — an inactive parent ` +
        `keeps its children where they are.`,
    );
  }

  await taxonomies.deleteById(id);

  await writeAuditLog({
    action: "taxonomy.deleted",
    actor,
    before: { kind: taxonomy.kind, slug: taxonomy.slug, name: taxonomy.name },
  });
}

/** How many products would a delete break? Shown next to the delete control. */
export async function usageCount(id: string): Promise<number> {
  await connectToDatabase();
  return products.countReferencingTaxonomy(id);
}

export async function listByKind(kind: TaxonomyKind): Promise<TaxonomyDoc[]> {
  await connectToDatabase();
  return taxonomies.listByKind(kind);
}

function label(kind: TaxonomyKind): string {
  return kind.replace(/_/g, " ");
}
