import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { PRODUCT_VERSION_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { Product, type ProductVersionDoc } from "@/lib/db/models/catalog";
import type { ProductVersionStatus } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isEmptyDocument, type RichTextDocument } from "@/lib/rich-text/schema";
import { compareSemver, isSemver, sortByVersionDesc, supersedes } from "@/lib/semver";
import { products } from "@/repositories/product.repository";
import { emit } from "@/lib/events";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import { statusChange, writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Versions — §45.
 *
 * ## What "immutable once released" actually protects
 *
 * A released version is the thing a customer paid for and may re-download years
 * later. If its artefacts can be swapped, then "I bought 2.4.0" stops meaning
 * anything: the bytes behind that name changed and nobody can tell. So the rule
 * is not "discourage editing", it is that **the artefacts of a released version
 * cannot change at all** — a correction ships as 2.4.1.
 *
 * That rule is enforced in three places rather than one, because a single guard
 * is a single thing to forget:
 *
 * 1. `releasedVersionEditSchema` does not *have* the artefact fields.
 * 2. `updateVersion` refuses non-note fields on a released version.
 * 3. `addFile`/`removeFile` refuse outright once released.
 *
 * ## The current-version pointer only moves forward
 *
 * Re-releasing an old version, or releasing a backported 1.9.1 after 2.0.0, must
 * not drag `currentVersionId` backwards — customers would be handed an older
 * download than the one they already have. `supersedes()` is the whole rule.
 */

export interface CreateVersionInput {
  productId: string;
  version: string;
  changelog?: string;
  releaseNotes?: RichTextDocument;
  minimumRequirements?: string;
  releaseDate?: string;
  updateEligibility?: {
    includesPriorMajor: boolean;
    freeFromVersion?: string;
    note?: string;
  };
}

export async function createVersion(
  input: CreateVersionInput,
  actor: AuditActor,
): Promise<ProductVersionDoc> {
  await connectToDatabase();

  const product = await products.findById(input.productId);
  if (!product) throw new NotFoundError("product", { id: input.productId });

  if (!isSemver(input.version)) {
    throw new ValidationError("That is not a version number.", {
      version: ["Use major.minor.patch — for example 2.4.0."],
    });
  }

  const existing = await productVersions.findByVersionString(input.productId, input.version);
  if (existing) {
    throw new ConflictError(`Version ${input.version} already exists for this product.`, {
      version: [`${input.version} is already here. Pick the next number.`],
    });
  }

  let created: ProductVersionDoc;
  try {
    created = await productVersions.create({
      productId: toObjectId(input.productId),
      version: input.version,
      status: "draft",
      ...notesFields(input.releaseNotes),
      ...(input.changelog ? { changelog: input.changelog } : {}),
      ...(input.minimumRequirements ? { minimumRequirements: input.minimumRequirements } : {}),
      ...(input.releaseDate ? { releaseDate: new Date(input.releaseDate) } : {}),
      ...(input.updateEligibility ? { updateEligibility: input.updateEligibility } : {}),
    } as Partial<ProductVersionDoc>);
  } catch (error) {
    // The unique index on `{productId, version}` is the authority; the lookup
    // above is only a nicer message for the common case.
    if (isDuplicateKey(error)) {
      throw new ConflictError(`Version ${input.version} was just created by someone else.`);
    }
    throw error;
  }

  await writeAuditLog({
    action: "product_version.created",
    actor,
    subject: { type: "product", id: input.productId },
    after: { version: created.version, status: "draft" },
  });

  return created;
}

/**
 * Edit a version.
 *
 * Which fields are writable depends on status, and the refusal names the reason
 * rather than dropping the field silently — an edit that appears to save and
 * does nothing is worse than one that is refused.
 */
export async function updateVersion(
  versionId: string,
  input: Partial<Omit<CreateVersionInput, "productId" | "version">>,
  actor: AuditActor,
): Promise<ProductVersionDoc> {
  await connectToDatabase();

  const version = await productVersions.findById(versionId);
  if (!version) throw new NotFoundError("version", { id: versionId });

  const update: Record<string, unknown> = {};
  if (input.changelog !== undefined) update.changelog = input.changelog;
  if (input.releaseNotes !== undefined) Object.assign(update, notesFields(input.releaseNotes));
  if (input.updateEligibility !== undefined) {
    update.updateEligibility = input.updateEligibility;
  }

  // The two fields that describe *what you get*, rather than how it is
  // described. Frozen at release.
  const artefactFields: string[] = [];
  if (input.minimumRequirements !== undefined) artefactFields.push("minimumRequirements");
  if (input.releaseDate !== undefined) artefactFields.push("releaseDate");

  if (version.status !== "draft" && artefactFields.length > 0) {
    throw new ValidationError(
      `Version ${version.version} is released. Only its notes and update rules can be ` +
        `changed — anything that alters what a customer gets ships as a new version.`,
      Object.fromEntries(artefactFields.map((field) => [field, ["Frozen once released."]])),
    );
  }

  if (input.minimumRequirements !== undefined) {
    update.minimumRequirements = input.minimumRequirements;
  }
  if (input.releaseDate !== undefined) {
    update.releaseDate = input.releaseDate ? new Date(input.releaseDate) : undefined;
  }

  const saved = await productVersions.updateById(versionId, splitUpdate(update));
  if (!saved) throw new NotFoundError("version", { id: versionId });

  await writeAuditLog({
    action: "product_version.updated",
    actor,
    subject: { type: "product", id: String(version.productId) },
    after: { version: version.version, fields: Object.keys(update) },
  });

  return saved;
}

/**
 * Release a version, and move the product's pointer if this is the newest.
 *
 * Refuses without a package file, because a released version with nothing to
 * download is the failure that looks like success: the product page shows
 * "2.4.0 available", the customer pays, and there is no artefact. `readiness.ts`
 * already treats that as a publish gap; catching it here means it never reaches
 * that state.
 */
export async function releaseVersion(
  versionId: string,
  actor: AuditActor,
): Promise<ProductVersionDoc> {
  await connectToDatabase();

  const version = await productVersions.findById(versionId);
  if (!version) throw new NotFoundError("version", { id: versionId });

  assertTransition("productVersion", PRODUCT_VERSION_TRANSITIONS, version.status, "released");

  const packages = await productFiles.countByKind(versionId, "application_package");
  if (packages === 0) {
    throw new ValidationError(
      `Version ${version.version} has no application package. Upload one before releasing — ` +
        `a released version with nothing to download looks available and is not.`,
      { files: ["Upload an application package first."] },
    );
  }

  const releasedAt = new Date();
  const updated = await productVersions.setStatusIfCurrent(
    versionId,
    "draft",
    "released",
    // Set once. Ticket 14 measures the update window from it, so a later edit
    // would move every customer's entitlement.
    { releasedAt, ...(version.releaseDate ? {} : { releaseDate: releasedAt }) },
  );

  if (!updated) {
    throw new ConflictError(
      "Someone else released this version while you were working. Reload and try again.",
    );
  }

  await maybeAdvanceCurrentVersion(String(version.productId), updated);

  await writeAuditLog({
    action: "product_version.released",
    actor,
    subject: { type: "product", id: String(version.productId) },
    ...statusChange("draft", "released", { version: updated.version }),
    source: "admin",
  });

  /*
   * §69's update notice, fanning out to everyone with an active entitlement.
   *
   * Emitted after the audit and outside any transaction: a notification
   * failing must not un-release a version, and the version is genuinely
   * released whether or not anybody was told.
   */
  const product = await Product.findById(version.productId)
    .select({ name: 1 })
    .lean<{ name: string }>();

  await emit("ProductVersionReleased", {
    productId: String(version.productId),
    productName: product?.name ?? "Your software",
    versionId: String(version._id),
    version: updated.version,
  });

  return updated;
}

export async function deprecateVersion(
  versionId: string,
  actor: AuditActor,
): Promise<ProductVersionDoc> {
  await connectToDatabase();

  const version = await productVersions.findById(versionId);
  if (!version) throw new NotFoundError("version", { id: versionId });

  assertTransition("productVersion", PRODUCT_VERSION_TRANSITIONS, version.status, "deprecated");

  const updated = await productVersions.setStatusIfCurrent(versionId, "released", "deprecated");
  if (!updated) {
    throw new ConflictError("That version's status changed while you were working.");
  }

  // Deprecating what the product currently points at would leave customers
  // being offered a version we have just said not to use.
  const product = await products.findById(String(version.productId));
  if (product && String(product.currentVersionId) === versionId) {
    const replacement = await newestReleased(String(version.productId), versionId);
    await products.updateById(String(version.productId), {
      ...(replacement
        ? { $set: { currentVersionId: replacement._id } }
        : { $unset: { currentVersionId: "" } }),
    });
  }

  await writeAuditLog({
    action: "product_version.deprecated",
    actor,
    subject: { type: "product", id: String(version.productId) },
    ...statusChange("released", "deprecated", { version: updated.version }),
    source: "admin",
  });

  return updated;
}

/**
 * Delete a version. Draft only — a released version is somebody's purchase.
 */
export async function deleteVersion(versionId: string, actor: AuditActor): Promise<void> {
  await connectToDatabase();

  const version = await productVersions.findById(versionId);
  if (!version) throw new NotFoundError("version", { id: versionId });

  if (version.status !== "draft") {
    throw new ValidationError(
      `Version ${version.version} has been released and cannot be deleted. Deprecate it ` +
        `instead — customers who own it keep their download.`,
      { status: ["Released versions are permanent."] },
    );
  }

  const files = await productFiles.listForVersion(versionId);
  if (files.length > 0) {
    throw new ValidationError(
      `Remove the ${files.length} file${files.length === 1 ? "" : "s"} on this version first.`,
      { files: ["Delete the files before the version."] },
    );
  }

  await productVersions.deleteById(versionId);

  await writeAuditLog({
    action: "product_version.deleted",
    actor,
    subject: { type: "product", id: String(version.productId) },
    before: { version: version.version, status: version.status },
  });
}

/* ────────────────────────────────────────────── reads */

/** One version by id — used by actions to decide which edit schema applies. */
export async function findVersion(versionId: string): Promise<ProductVersionDoc | null> {
  await connectToDatabase();
  return productVersions.findById(versionId);
}

/** Newest first, which is the only order a version list is ever read in. */
export async function listVersions(productId: string): Promise<ProductVersionDoc[]> {
  await connectToDatabase();
  const rows = await productVersions.listForProduct(productId);
  return sortByVersionDesc(rows, (row) => row.version);
}

/**
 * What a *customer* may see (§45) — released versions, newest first.
 *
 * Draft versions are staff-only work in progress and deprecated ones are
 * withdrawn; neither belongs on a product page. Ticket 14 narrows this further
 * by entitlement.
 */
export async function listCustomerVersions(productId: string): Promise<ProductVersionDoc[]> {
  const rows = await listVersions(productId);
  return rows.filter((row) => row.status === "released");
}

/* ────────────────────────────────────────────── internals */

async function maybeAdvanceCurrentVersion(
  productId: string,
  released: ProductVersionDoc,
): Promise<void> {
  const product = await products.findById(productId);
  if (!product) return;

  const current = product.currentVersionId
    ? await productVersions.findById(String(product.currentVersionId))
    : null;

  // §45's forward-only rule. A backported 1.9.1 released after 2.0.0 is a real
  // release, but it is not the current version.
  if (!supersedes(released.version, current?.version)) return;

  await products.updateById(productId, { $set: { currentVersionId: released._id } });
}

async function newestReleased(
  productId: string,
  excludeVersionId: string,
): Promise<ProductVersionDoc | null> {
  const rows = await productVersions.listForProduct(productId);
  const candidates = rows.filter(
    (row) => row.status === "released" && String(row._id) !== excludeVersionId,
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((newest, row) =>
    compareSemver(row.version, newest.version) > 0 ? row : newest,
  );
}

/** Release notes are a tree; an empty one clears the field rather than storing `{}`. */
function notesFields(notes: RichTextDocument | undefined): { releaseNotes?: RichTextDocument } {
  if (isEmptyDocument(notes)) return { releaseNotes: undefined };
  return { releaseNotes: notes };
}

/** Same `$set`/`$unset` split as `product-service` — `$set` drops `undefined`. */
function splitUpdate(update: Record<string, unknown>) {
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export type { ProductVersionStatus };
