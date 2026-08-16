import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { PRODUCT_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { descriptionFields, type ProductDoc } from "@/lib/db/models/catalog";
import type { ProductStatus } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isEmptyDocument, type RichTextDocument } from "@/lib/rich-text/schema";
import { slugify, uniqueSlug } from "@/lib/slug";
import { withTransaction } from "@/lib/db/transaction";
import { products } from "@/repositories/product.repository";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import { statusChange, writeAuditLog, type AuditActor } from "@/services/audit";
import { deriveFacets } from "./facets";
import {
  DEFAULT_TESTING_CHECKLIST,
  computeReadiness,
  type Readiness,
  type ReadinessSnapshot,
} from "./readiness";

/**
 * Products — creation, section saves, and the §46 lifecycle.
 *
 * All the rules live here. Actions validate input and call in; components never
 * do. That is the architectural rule from `AGENTS.md`, and it is also what puts
 * every interesting decision inside vitest's coverage floor.
 */

/* ────────────────────────────────────────────── creation */

export interface CreateDraftInput {
  name: string;
  summary: string;
  description?: RichTextDocument;
}

/**
 * Create a `draft` and return its id.
 *
 * The slug is derived from the name and made unique here, but the **unique
 * index is the authority**: two administrators creating "Atlas CRM" at the same
 * moment both pass `uniqueSlug`, and only one insert can win. The loser gets a
 * `ConflictError` naming the problem rather than a duplicate-key stack trace.
 */
export async function createDraft(
  input: CreateDraftInput,
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const slug = await uniqueSlug(input.name, (candidate) => products.slugExists(candidate));

  let created: ProductDoc;
  try {
    created = await products.create({
      name: input.name,
      summary: input.summary,
      slug,
      status: "draft",
      ...descriptionFields(input.description),
      // Present-but-empty rather than absent: `facets` is derived on every
      // classification save, and a missing field would make the marketplace's
      // `$in` behave differently from an empty one.
      facets: [],
      // §47 — the checklist exists from the start so "not yet tested" is
      // visible rather than being indistinguishable from "no checklist".
      testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
        item,
        status: "pending" as const,
      })),
    } as Partial<ProductDoc>);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError(
        "A product with that name was just created. Try again — the slug will differ.",
      );
    }
    throw error;
  }

  await writeAuditLog({
    action: "product.created",
    actor,
    subject: { type: "product", id: String(created._id) },
    after: { name: created.name, slug: created.slug, status: "draft" },
  });

  return created;
}

/* ────────────────────────────────────────────── section saves */

/**
 * Write one wizard section.
 *
 * `$set` of named paths, never a whole-document replace — otherwise saving the
 * SEO step would blank the pricing entered two steps earlier. The section
 * schemas make that structural: each one describes only its own fields, so
 * there is nothing else to write.
 */
export async function saveSection(
  productId: string,
  section: string,
  update: Record<string, unknown>,
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const saved = await products.updateById(productId, setAndUnset(update));
  if (!saved) throw new NotFoundError("product", { id: productId });

  await writeAuditLog({
    action: "product.section_updated",
    actor,
    subject: { type: "product", id: productId },
    // The changed keys, not the values: a pricing save would otherwise put
    // every price in the audit log, and a demo save would put ciphertext there.
    after: { section, fields: Object.keys(update) },
  });

  return saved;
}

/**
 * Split a section's fields into `$set` and `$unset`.
 *
 * MongoDB **drops `undefined` from `$set`** rather than clearing the field, so
 * the obvious `{ $set: update }` makes every optional field write-only: an
 * administrator who deletes the description, the turnaround estimate or an SEO
 * override saves successfully, sees the form come back empty, and the old value
 * is still on the live product page. Nothing errors, and the form agrees with
 * them — the stale value only shows up where a customer sees it.
 *
 * So `undefined` means "clear this", which is what clearing a field in the UI
 * produced in the first place. Fields the section did not mention are simply
 * absent from `update` and are untouched either way.
 */
function setAndUnset(update: Record<string, unknown>): {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "">;
} {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) unset[key] = "";
    else set[key] = value;
  }

  return {
    ...(Object.keys(set).length > 0 ? { $set: set } : {}),
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
  };
}

/**
 * Save classification **and** re-derive `facets` in the same write.
 *
 * Its own function because this is the one section that can change what the
 * marketplace matches on. Doing it as a plain `saveSection` would leave the
 * facets describing the previous taxonomy — the product would keep appearing
 * under its old category and stop appearing under its new one.
 */
export async function saveClassification(
  productId: string,
  input: {
    categoryIds: string[];
    industryIds: string[];
    technologyIds: string[];
    productTypeId?: string;
  },
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const facets = await deriveFacets(input);

  return saveSection(
    productId,
    "classification",
    {
      categoryIds: input.categoryIds.map((id) => toObjectId(id)),
      industryIds: input.industryIds.map((id) => toObjectId(id)),
      technologyIds: input.technologyIds.map((id) => toObjectId(id)),
      ...(input.productTypeId
        ? { productTypeId: toObjectId(input.productTypeId) }
        : { productTypeId: undefined }),
      facets,
    },
    actor,
  );
}

/**
 * Change the public URL, retiring the old slug into history.
 *
 * Separate from the basics form because it is a different kind of event:
 * renaming a product does not move it, changing its slug does, and every link
 * anyone has shared depends on `slugHistory` catching the old one.
 */
export async function changeSlug(
  productId: string,
  desired: string,
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  const slug = slugify(desired);
  if (slug === product.slug) return product;

  if (await products.slugExists(slug, productId)) {
    // Includes slugs retired by *other* products — reusing one would hijack
    // their redirect.
    const suggestion = await uniqueSlug(slug, (candidate) =>
      products.slugExists(candidate, productId),
    );
    throw new ValidationError("That address is already taken.", {
      slug: [`"${slug}" is in use. Try "${suggestion}".`],
    });
  }

  const updated = await products.changeSlug(productId, product.slug, slug);
  if (!updated) throw new NotFoundError("product", { id: productId });

  await writeAuditLog({
    action: "product.slug_changed",
    actor,
    subject: { type: "product", id: productId },
    before: { slug: product.slug },
    after: { slug },
  });

  return updated;
}

/* ────────────────────────────────────────────── readiness */

/**
 * Everything blocking publish, for one product.
 *
 * Two reads: the product itself, and one aggregate over versions and files.
 * The rest is already embedded on the document, which is the payoff of the
 * embed-vs-reference split in `ERD.md`.
 */
export async function readinessFor(product: ProductDoc): Promise<Readiness> {
  const versions = await productVersions.listForProduct(String(product._id));
  const released = versions.filter((version) => version.status === "released");
  const withPackage = await productFiles.versionIdsWithPackage(
    released.map((version) => String(version._id)),
  );

  return computeReadiness(snapshotOf(product, released.length > 0, withPackage.size > 0));
}

function snapshotOf(
  product: ProductDoc,
  hasReleasedVersion: boolean,
  hasReleasedVersionWithPackage: boolean,
): ReadinessSnapshot {
  return {
    status: product.status,
    priceCount: product.prices.length,
    licencePackageCount: product.licencePackages.length,
    screenshotCount: product.media.filter((item) => item.kind === "screenshot").length,
    hasDescription: !isEmptyDocument(product.description),
    hasReleasedVersion,
    hasReleasedVersionWithPackage,
    checklist: product.testingChecklist.map((item) => ({
      status: item.status,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
  };
}

/**
 * Readiness for a whole page of products, in two queries rather than 2N.
 *
 * The admin list shows a "what's blocking publish" column per row. Computing it
 * per row is the N+1 that makes a list feel slow at exactly the point somebody
 * is scanning it.
 */
export async function readinessForMany(
  page: readonly ProductDoc[],
): Promise<Map<string, Readiness>> {
  if (page.length === 0) return new Map();

  const ids = page.map((product) => String(product._id));
  const releasedByProduct = await productVersions.productIdsWithReleasedVersion(ids);

  // Only products that have a released version can have a package on one.
  const releasedVersions = (
    await Promise.all(
      page
        .filter((product) => releasedByProduct.has(String(product._id)))
        .map(async (product) => ({
          productId: String(product._id),
          versions: (await productVersions.listForProduct(String(product._id))).filter(
            (version) => version.status === "released",
          ),
        })),
    )
  ).flatMap((entry) =>
    entry.versions.map((version) => ({
      productId: entry.productId,
      versionId: String(version._id),
    })),
  );

  const versionsWithPackage = await productFiles.versionIdsWithPackage(
    releasedVersions.map((entry) => entry.versionId),
  );

  const productsWithPackage = new Set(
    releasedVersions
      .filter((entry) => versionsWithPackage.has(entry.versionId))
      .map((entry) => entry.productId),
  );

  return new Map(
    page.map((product) => {
      const id = String(product._id);
      return [
        id,
        computeReadiness(
          snapshotOf(product, releasedByProduct.has(id), productsWithPackage.has(id)),
        ),
      ];
    }),
  );
}

/* ────────────────────────────────────────────── lifecycle */

/**
 * Move a product through §46's lifecycle.
 *
 * ## Order of checks
 *
 * `assertTransition` runs **first**, then readiness. Reversing them would tell
 * someone attempting `draft → published` to "add a screenshot" when their
 * actual problem is skipping review — and `StateTransitionError` already says
 * the useful thing for that case.
 *
 * ## Concurrency
 *
 * The write is a guarded `findOneAndUpdate({ _id, status: from })`. Two
 * administrators clicking publish at the same moment both pass every check
 * above; without the guard both would write, producing two audit entries for
 * one transition. The second gets `null` and a conflict it can act on.
 *
 * The audit row goes inside the transaction deliberately — a transition that
 * committed without its record is exactly what §90 exists to prevent, and an
 * insert made in the session cannot be duplicated by a replay.
 */
export async function transition(
  productId: string,
  to: ProductStatus,
  actor: AuditActor,
  options: { reason?: string; ip?: string; userAgent?: string } = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  const from = product.status;
  assertTransition("product", PRODUCT_TRANSITIONS, from, to);

  if (to === "published") await assertPublishable(product);
  if (to === "ready") await assertTestingComplete(product);

  const extra: Record<string, unknown> = {};
  // Set once, on first publish. Re-publishing after deprecation must not
  // rewrite it — `publishedAt` is what "new this month" sorts on.
  if (to === "published" && !product.publishedAt) extra.publishedAt = new Date();

  const write = async (session?: ClientSession) => {
    const updated = await products.setStatusIfCurrent(productId, from, to, extra, session);
    if (!updated) {
      throw new ConflictError(
        "Someone else changed this product's status while you were working. " +
          "Reload and try again.",
      );
    }

    await writeAuditLog(
      {
        action: "product.status_changed",
        actor,
        subject: { type: "product", id: productId },
        ...statusChange(from, to, options.reason ? { reason: options.reason } : {}),
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        source: "admin",
      },
      session,
    );

    return updated;
  };

  // Local development runs a standalone mongod, which cannot transact. The
  // guarded update still gives concurrency safety there; only the atomicity of
  // status-plus-audit is lost, and the audit write is retried best-effort.
  return supportsTransactions() ? withTransaction(write) : write();
}

async function assertPublishable(product: ProductDoc): Promise<void> {
  const { gaps } = await readinessFor(product);
  if (gaps.length === 0) return;

  throw new ValidationError(
    `This product can't be published yet: ${gaps.map((gap) => gap.message.toLowerCase()).join("; ")}.`,
    // Keyed by gap code so the form can link each one to its step.
    Object.fromEntries(gaps.map((gap) => [gap.code, [gap.message]])),
  );
}

async function assertTestingComplete(product: ProductDoc): Promise<void> {
  const { isTestingComplete } = await readinessFor(product);
  if (isTestingComplete) return;

  throw new ValidationError(
    "Every item on the internal testing checklist has to pass — or be marked " +
      "not applicable with a note — before this is ready.",
    { testing_incomplete: ["The internal testing checklist is not finished."] },
  );
}

/**
 * Publish or unpublish several products at once.
 *
 * Per-product tolerant rather than all-or-nothing: a selection of twelve where
 * one is missing a screenshot should publish eleven and say why the twelfth
 * did not. A batch that fails whole makes the administrator find the culprit by
 * bisection.
 *
 * A product already in the target state is reported as **skipped**, not failed.
 * `assertTransition` throws when `from === to`, so without this a selection
 * containing an already-published product would report an error for a row where
 * nothing was wrong.
 */
export async function bulkTransition(
  productIds: readonly string[],
  to: ProductStatus,
  actor: AuditActor,
): Promise<{
  changed: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
}> {
  const changed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const id of productIds) {
    try {
      const product = await products.findById(id);
      if (!product) {
        failed.push({ id, reason: "No longer exists." });
        continue;
      }
      if (product.status === to) {
        skipped.push({ id, reason: `Already ${to.replace(/_/g, " ")}.` });
        continue;
      }

      await transition(id, to, actor);
      changed.push(id);
    } catch (error) {
      failed.push({ id, reason: messageOf(error) });
    }
  }

  return { changed, skipped, failed };
}

/* ────────────────────────────────────────────── deletion */

/**
 * Soft-delete a product.
 *
 * Deliberately narrow. `archived` is the lifecycle terminal — the way a product
 * that existed stops being sold — and `deletedAt` is for **mistakes only**: a
 * draft created by accident, before anyone saw it. Anything with a version, an
 * order or an entitlement is archived instead, and `INTEGRITY.md` already makes
 * `entitlements.productId` a `restrict` so ownership outlives delisting.
 */
export async function softDelete(productId: string, actor: AuditActor): Promise<void> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  if (product.status !== "draft") {
    throw new ValidationError(
      "Only a draft can be deleted. Archive this product instead — archiving keeps " +
        "it for anyone who already owns it.",
      { status: ["This product is not a draft."] },
    );
  }

  const versions = await productVersions.listForProduct(productId);
  if (versions.length > 0) {
    throw new ValidationError("This product has versions. Archive it instead of deleting it.", {
      versions: [`${versions.length} version(s) exist.`],
    });
  }

  await products.deleteById(productId);

  await writeAuditLog({
    action: "product.deleted",
    actor,
    subject: { type: "product", id: productId },
    before: { slug: product.slug, status: product.status },
  });
}

/* ────────────────────────────────────────────── helpers */

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
