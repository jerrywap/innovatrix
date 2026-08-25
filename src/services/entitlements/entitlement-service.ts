import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { EntitlementDoc, LicenceDoc } from "@/lib/db/models/commerce";
import type { ProductDoc, ProductFileDoc, ProductVersionDoc } from "@/lib/db/models/catalog";
import { ForbiddenError } from "@/lib/errors";
import { compareSemver, sortByVersionDesc } from "@/lib/semver";
import { maskLicenceKey } from "@/lib/licence-key";
import { entitlements, licences } from "@/repositories/entitlement.repository";
import { products } from "@/repositories/product.repository";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import { availableUpdate, canDownload, hasSupport, type DownloadDecision } from "./rules";
import { formatDay } from "@/lib/dates";

/**
 * What a customer owns — §29, §64, §65.
 *
 * ## Reads are org-scoped at the repository, not here
 *
 * `EntitlementRepository` refuses to build a query without an organisation id.
 * That is deliberate: an entitlement is proof of purchase, and the failure mode
 * of forgetting a scope is handing one customer's software to another. The
 * scope comes from `requireOrg()` in the caller, never from a request.
 */

export interface OwnedVersionView {
  id: string;
  version: string;
  releasedAt?: string;
  changelog?: string;
  isPurchased: boolean;
  /** Whether *this* customer may download it, and why not if not. */
  access: DownloadDecision;
  files: Array<{
    id: string;
    kind: string;
    filename: string;
    sizeBytes: number;
    checksumSha256?: string;
  }>;
}

export interface EntitlementView {
  id: string;
  status: EntitlementDoc["status"];
  product: {
    id: string;
    slug: string;
    name: string;
    imageUrl?: string;
    customisable: boolean;
    /**
     * Whether there is a demo environment to open at all — not whether *this*
     * viewer may see its credentials. That second question is
     * `canRevealCredentials()`, and an owner passes it by definition, which is
     * what `owners_only` exists for.
     */
    hasDemo: boolean;
  };
  purchasedVersion?: { id: string; version: string };
  /** Absent when there is nothing newer they are entitled to. */
  updateAvailable?: { id: string; version: string };
  updatesUntil?: string;
  supportUntil?: string;
  supportActive: boolean;
  updatesActive: boolean;
  licence?: {
    id: string;
    maskedKey: string;
    type: LicenceDoc["type"];
    status: LicenceDoc["status"];
    activationLimit: number;
    activationsUsed: number;
  };
  orderId: string;
}

/* ────────────────────────────────────────────── list */

/**
 * My Scripts — §29.
 *
 * Four queries for the whole page rather than four per row: entitlements, then
 * their products, licences and versions in bulk. With fifty entitlements the
 * per-row version is two hundred round trips, which is the difference between
 * the 1.5s target and a page nobody waits for.
 */
export async function listOwnedSoftware(organizationId: string): Promise<EntitlementView[]> {
  await connectToDatabase();

  const owned = await entitlements.listForOrganization(organizationId);
  if (owned.length === 0) return [];

  const productIds = [...new Set(owned.map((entitlement) => String(entitlement.productId)))];
  const [productDocs, licenceDocs] = await Promise.all([
    products.findManyByIds(productIds),
    licences.findManyByEntitlements(owned.map((entitlement) => String(entitlement._id))),
  ]);

  const versionDocs = await productVersions.listForProducts(productIds);

  const productById = new Map(productDocs.map((product) => [String(product._id), product]));
  const licenceByEntitlement = new Map(
    licenceDocs.map((licence) => [String(licence.entitlementId), licence]),
  );
  const versionsByProduct = new Map<string, ProductVersionDoc[]>();
  for (const version of versionDocs) {
    const key = String(version.productId);
    versionsByProduct.set(key, [...(versionsByProduct.get(key) ?? []), version]);
  }

  return owned
    .map((entitlement) =>
      toView(
        entitlement,
        productById.get(String(entitlement.productId)),
        licenceByEntitlement.get(String(entitlement._id)),
        versionsByProduct.get(String(entitlement.productId)) ?? [],
      ),
    )
    .filter((view): view is EntitlementView => view !== null);
}

function toView(
  entitlement: EntitlementDoc,
  product: ProductDoc | undefined,
  licence: LicenceDoc | undefined,
  versions: readonly ProductVersionDoc[],
): EntitlementView | null {
  // A product deleted outright. The entitlement is still real — the customer
  // paid — but there is nothing to render, so it is skipped rather than shown
  // as a broken tile. `INTEGRITY.md` makes `entitlements.productId` a
  // `restrict`, so this should not happen; skipping is the safe read.
  if (!product) return null;

  const facts = {
    status: entitlement.status,
    ...(entitlement.purchasedVersionId
      ? { purchasedVersionId: String(entitlement.purchasedVersionId) }
      : {}),
    ...(entitlement.updatesUntil ? { updatesUntil: entitlement.updatesUntil } : {}),
  };

  const purchased = entitlement.purchasedVersionId
    ? versions.find((version) => String(version._id) === String(entitlement.purchasedVersionId))
    : undefined;

  const update = availableUpdate(
    facts,
    versions.map((version) => ({
      id: String(version._id),
      status: version.status,
      ...(version.releasedAt ? { releasedAt: version.releasedAt } : {}),
      version: version.version,
    })),
    compareSemver,
    purchased?.version,
  ) as (ReturnType<typeof availableUpdate> & { version?: string }) | undefined;

  const now = new Date();

  return {
    id: String(entitlement._id),
    status: entitlement.status,
    product: {
      id: String(product._id),
      slug: product.slug,
      name: product.name,
      ...(product.media?.find((item) => item.url)?.url
        ? { imageUrl: product.media.find((item) => item.url)!.url! }
        : {}),
      customisable: Boolean(product.customization?.available),
      hasDemo: Boolean(
        product.demo?.publicUrl || product.demo?.customerUrl || product.demo?.adminUrl,
      ),
    },
    ...(purchased
      ? { purchasedVersion: { id: String(purchased._id), version: purchased.version } }
      : {}),
    ...(update?.version ? { updateAvailable: { id: update.id, version: update.version } } : {}),
    ...(entitlement.updatesUntil ? { updatesUntil: formatDay(entitlement.updatesUntil) } : {}),
    ...(entitlement.supportUntil ? { supportUntil: formatDay(entitlement.supportUntil) } : {}),
    supportActive: hasSupport(entitlement.supportUntil, now),
    updatesActive: Boolean(entitlement.updatesUntil && entitlement.updatesUntil >= now),
    ...(licence
      ? {
          licence: {
            id: String(licence._id),
            // Masked here, server-side. The full key is only ever sent by the
            // licence page, which asks for it explicitly.
            maskedKey: maskLicenceKey(licence.key),
            type: licence.type,
            status: licence.status,
            activationLimit: licence.activationLimit,
            activationsUsed: licence.activations.filter((a) => !a.releasedAt).length,
          },
        }
      : {}),
    orderId: String(entitlement.orderId),
  };
}

/* ────────────────────────────────────────────── one entitlement */

export interface EntitlementDetail extends EntitlementView {
  versions: OwnedVersionView[];
}

export async function getOwnedSoftware(
  entitlementId: string,
  organizationId: string,
): Promise<EntitlementDetail | null> {
  await connectToDatabase();

  const entitlement = await entitlements.findByIdForOrganization(entitlementId, organizationId);
  if (!entitlement) return null;

  const [product, licence, versions] = await Promise.all([
    products.findById(String(entitlement.productId)),
    licences.findByEntitlement(entitlementId),
    productVersions.listForProduct(String(entitlement.productId)),
  ]);

  const view = toView(entitlement, product ?? undefined, licence ?? undefined, versions);
  if (!view) return null;

  const released = sortByVersionDesc(
    versions.filter((version) => version.status !== "draft"),
    (version) => version.version,
  );

  const files = await productFiles.listForVersions(released.map((v) => String(v._id)));
  const filesByVersion = new Map<string, ProductFileDoc[]>();
  for (const file of files) {
    const key = String(file.versionId);
    filesByVersion.set(key, [...(filesByVersion.get(key) ?? []), file]);
  }

  const facts = {
    status: entitlement.status,
    ...(entitlement.purchasedVersionId
      ? { purchasedVersionId: String(entitlement.purchasedVersionId) }
      : {}),
    ...(entitlement.updatesUntil ? { updatesUntil: entitlement.updatesUntil } : {}),
  };

  return {
    ...view,
    versions: released.map((version) => {
      const access = canDownload(facts, {
        id: String(version._id),
        status: version.status,
        ...(version.releasedAt ? { releasedAt: version.releasedAt } : {}),
      });

      return {
        id: String(version._id),
        version: version.version,
        ...(version.releasedAt ? { releasedAt: formatDay(version.releasedAt) } : {}),
        ...(version.changelog ? { changelog: version.changelog } : {}),
        isPurchased: String(version._id) === String(entitlement.purchasedVersionId),
        access,
        // The file *list* renders whether or not access is allowed — a locked
        // version showing "3 files, and here is why you can't have them" is
        // more useful than one that pretends to be empty.
        files: (filesByVersion.get(String(version._id)) ?? []).map((file) => ({
          id: String(file._id),
          kind: file.kind,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          ...(file.checksumSha256 ? { checksumSha256: file.checksumSha256 } : {}),
        })),
      };
    }),
  };
}

/* ────────────────────────────────────────────── authorisation */

export interface DownloadAuthorisation {
  entitlement: EntitlementDoc;
  file: ProductFileDoc;
  version: ProductVersionDoc;
}

/**
 * May this organisation download this file — §66.
 *
 * The whole check, in the order that matters:
 *
 * 1. The file exists.
 * 2. Its version exists.
 * 3. **This organisation has an entitlement for that product.**
 * 4. `canDownload` — status and the update window.
 *
 * ## Steps 1–3 all fail identically, on purpose
 *
 * Every one of them throws `ForbiddenError` with the same sentence. An earlier
 * version threw `NotFoundError` for a missing file and `ForbiddenError` for one
 * you don't own, which turns the endpoint into an existence oracle: probe ids,
 * watch which error comes back, and you have enumerated the catalogue's private
 * files without owning any of them. The download route flattened both to 403,
 * so the deployed behaviour was safe — but that made the safety a property of
 * one caller rather than of the rule, and the next caller would not know.
 *
 * The cost is that an *owner* whose file row points at a deleted version reads
 * "you don't have a licence" instead of "that file is missing". `INTEGRITY.md`
 * makes those deletes a `restrict`, so it should not happen, and a confusing
 * message in a case that shouldn't occur is cheaper than an enumerable one that
 * can.
 *
 * Throws rather than returning a decision: every caller must refuse, and a
 * boolean invites somebody to log it and carry on.
 */
const REFUSAL = "You don't have a licence for this product.";

export async function authoriseDownload(
  fileId: string,
  organizationId: string,
): Promise<DownloadAuthorisation> {
  await connectToDatabase();

  const file = await productFiles.findById(fileId);
  if (!file) throw new ForbiddenError(REFUSAL);

  const version = await productVersions.findById(String(file.versionId));
  if (!version) throw new ForbiddenError(REFUSAL);

  const entitlement = await entitlements.findForProduct(organizationId, String(file.productId));
  if (!entitlement) throw new ForbiddenError(REFUSAL);

  const decision = canDownload(
    {
      status: entitlement.status,
      ...(entitlement.purchasedVersionId
        ? { purchasedVersionId: String(entitlement.purchasedVersionId) }
        : {}),
      ...(entitlement.updatesUntil ? { updatesUntil: entitlement.updatesUntil } : {}),
    },
    {
      id: String(version._id),
      status: version.status,
      ...(version.releasedAt ? { releasedAt: version.releasedAt } : {}),
    },
  );

  if (!decision.allowed) {
    throw new ForbiddenError(decision.message ?? "You can't download this version.");
  }

  return { entitlement, file, version };
}

/** Ticket 13's idempotency check, exposed so fulfilment can be explicit. */
export async function hasEntitlementsForOrder(
  orderId: string,
  session?: ClientSession,
): Promise<boolean> {
  return entitlements.existsForOrder(orderId, session);
}

export { toObjectId };
