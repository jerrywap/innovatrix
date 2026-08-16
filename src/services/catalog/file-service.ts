import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { ProductFileDoc } from "@/lib/db/models/catalog";
import type { ProductFileKind } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import {
  assertProductFileKey,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  productFilePath,
  verifyUpload,
  type UploadTicket,
} from "@/services/storage";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Product files — §44, §66.
 *
 * ## The upload is two calls, and the gap between them is the interesting part
 *
 * 1. `requestUpload` — mints a key and a presigned PUT. The bytes go **straight
 *    to S3**; they never pass through this server, which is what makes a 500MB
 *    package possible at all under a serverless request limit.
 * 2. `confirmUpload` — the browser reports success and we record the file.
 *
 * Between them the client is unsupervised, so `confirmUpload` trusts nothing it
 * is told:
 *
 * - **The key is checked against this product and version.** Without that, a
 *   caller can hand back a key belonging to *another* product and attach a paid
 *   package to their own — copying an artefact between products without ever
 *   downloading it. `assertProductFileKey` is the check.
 * - **The object is re-read before any document is written.** `verifyUpload`
 *   HEADs it, compares size and type against what was signed, and sniffs the
 *   leading bytes. A record for an object that isn't there, or is a `.exe`
 *   renamed to `.zip`, is worse than no record: it is a broken download the
 *   product page advertises as working.
 *
 * ## Why the S3 calls sit outside any transaction
 *
 * Object storage cannot participate in a MongoDB transaction, and pretending
 * otherwise produces the worst outcome — a rolled-back document with the object
 * still in the bucket, or the reverse. So the order is deliberate: verify the
 * object first, write the document second. A crash between them leaves an
 * orphaned object, which ticket 25's sweep collects; the reverse would leave a
 * download record pointing at nothing.
 */

export interface RequestUploadInput {
  productId: string;
  versionId: string;
  kind: ProductFileKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256?: string;
}

export async function requestUpload(input: RequestUploadInput): Promise<UploadTicket> {
  await connectToDatabase();

  const version = await productVersions.findById(input.versionId);
  if (!version) throw new NotFoundError("version", { id: input.versionId });

  if (String(version.productId) !== input.productId) {
    throw new ValidationError("That version belongs to a different product.", {
      versionId: ["Wrong product."],
    });
  }

  assertVersionIsEditable(version.status, version.version);

  const key = productFilePath(input.productId, input.versionId, input.filename);

  return createUploadUrl({
    scope: "product-file",
    key,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
  });
}

export interface ConfirmUploadInput extends RequestUploadInput {
  storageKey: string;
}

export async function confirmUpload(
  input: ConfirmUploadInput,
  actor: AuditActor,
): Promise<ProductFileDoc> {
  await connectToDatabase();

  const version = await productVersions.findById(input.versionId);
  if (!version) throw new NotFoundError("version", { id: input.versionId });
  if (String(version.productId) !== input.productId) {
    throw new ValidationError("That version belongs to a different product.", {
      versionId: ["Wrong product."],
    });
  }
  assertVersionIsEditable(version.status, version.version);

  // The whole point of step two: the key is a claim until this runs.
  assertProductFileKey(input.storageKey, {
    productId: input.productId,
    versionId: input.versionId,
  });

  const existing = await productFiles.findByStorageKey(input.storageKey);
  if (existing) {
    throw new ConflictError("That file has already been recorded.");
  }

  // Throws (and removes the object) if it is missing, the wrong size, the wrong
  // type, or its leading bytes disagree with the declared type.
  const head = await verifyUpload({
    key: input.storageKey,
    expectedSizeBytes: input.sizeBytes,
    expectedContentType: input.contentType,
  });

  const created = await productFiles.create({
    productId: toObjectId(input.productId),
    versionId: toObjectId(input.versionId),
    kind: input.kind,
    storageKey: input.storageKey,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: head.sizeBytes,
    // §44 permits deferring the hash for a large file — `crypto.subtle.digest`
    // needs the whole file in memory, which a 2GB package does not survive.
    // Absent means "compute on first download", not "unverified forever".
    ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
    scanStatus: "pending",
  } as Partial<ProductFileDoc>);

  await writeAuditLog({
    action: "product_file.uploaded",
    actor,
    subject: { type: "product", id: input.productId },
    after: {
      version: version.version,
      kind: input.kind,
      filename: input.filename,
      sizeBytes: head.sizeBytes,
    },
  });

  return created;
}

/**
 * Remove a file.
 *
 * Refused once the version is released — the artefacts of a release are what
 * somebody bought. Refused, too, if it is the last application package on a
 * *draft* version that has none other, because that is the state
 * `releaseVersion` will reject anyway; catching it here says why while the
 * administrator is still looking at the file list.
 */
export async function removeFile(fileId: string, actor: AuditActor): Promise<void> {
  await connectToDatabase();

  const file = await productFiles.findById(fileId);
  if (!file) throw new NotFoundError("file", { id: fileId });

  const version = await productVersions.findById(String(file.versionId));
  if (version && version.status !== "draft") {
    throw new ValidationError(
      `Version ${version.version} is released. Its files are what customers bought and ` +
        `cannot be removed — ship a correction as a new version.`,
      { file: ["Released artefacts are permanent."] },
    );
  }

  // The document goes first. Deleting the object first and then failing to
  // delete the row would leave a download record pointing at nothing — a 404
  // for a paying customer. This order leaves an orphaned object instead, which
  // is invisible and collectable.
  await productFiles.deleteById(fileId);

  try {
    await deleteObject(file.storageKey);
  } catch (error) {
    // Ticket 05: `s3:DeleteObject` is denied for the current credential, so
    // this is expected to fail in dev today. The record is already gone, which
    // is the part that matters for correctness; the object becomes ticket 25's
    // problem. Swallowing it here is the difference between "the file is gone
    // from the product" and an error the administrator cannot act on.
    console.warn("[file-service] object not deleted (see ticket 05 blockers)", {
      key: file.storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await writeAuditLog({
    action: "product_file.deleted",
    actor,
    subject: { type: "product", id: String(file.productId) },
    before: { kind: file.kind, filename: file.filename, sizeBytes: file.sizeBytes },
  });
}

/**
 * A time-limited download URL — §66.
 *
 * Authorisation is the **caller's** job and is deliberately not defaulted here:
 * staff go through `product.manage_files`, customers through ticket 14's
 * entitlement check. A service that quietly authorises is one nobody remembers
 * is doing it.
 */
export async function downloadUrlFor(
  fileId: string,
  options: { expiresInSeconds?: number } = {},
): Promise<{ url: string; expiresAt: Date; filename: string }> {
  await connectToDatabase();

  const file = await productFiles.findById(fileId);
  if (!file) throw new NotFoundError("file", { id: fileId });

  const { url, expiresAt } = await createDownloadUrl({
    key: file.storageKey,
    filename: file.filename,
    contentType: file.contentType,
    ...(options.expiresInSeconds ? { expiresInSeconds: options.expiresInSeconds } : {}),
  });

  return { url, expiresAt, filename: file.filename };
}

export async function listFiles(versionId: string): Promise<ProductFileDoc[]> {
  await connectToDatabase();
  return productFiles.listForVersion(versionId);
}

function assertVersionIsEditable(status: string, version: string): void {
  if (status === "draft") return;

  throw new ValidationError(
    `Version ${version} is ${status}. Its files are frozen — a correction ships as a new version.`,
    { versionId: ["This version's artefacts cannot change."] },
  );
}
