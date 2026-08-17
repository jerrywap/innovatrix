import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Vendor, VendorDocument, type VendorDocumentDoc } from "@/lib/db/models/vendors";
import type { VendorDocumentKind, VendorVerificationLevel } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import {
  assertVendorDocumentKey,
  createUploadUrl,
  deleteObject,
  vendorDocumentPath,
  verifyUpload,
  type UploadTicket,
} from "@/services/storage";

/**
 * Vendor verification documents — vendor ticket 02.
 *
 * ## Bytes never pass through the server
 *
 * Both directions are presigned: a `PUT` the browser sends itself, and a `GET`
 * the read route 307s to. The only bytes this process reads are the 4KB range
 * read inside `verifyUpload()`, which sniffs magic numbers and never reaches a
 * client.
 *
 * That is not a preference. The bucket is shared with unrelated live
 * applications, so every key is built server-side and checked against the
 * environment prefix — and `publicObjectUrl()` must never be reachable from any
 * code path here, because the bucket answers a known key over plain HTTPS with
 * no signature. An unguessable URL is not protection for a passport scan.
 *
 * ## The order of operations
 *
 * Verify the object, then write the document — the same order as
 * `catalog/file-service.ts`, and for the stated reason: a crash between them
 * leaves an orphaned object, which is untidy, where the reverse leaves a record
 * pointing at nothing, which is a broken screen.
 */

export interface RequestUploadInput {
  vendorId: string;
  level: VendorVerificationLevel;
  kind: VendorDocumentKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * A presigned `PUT` for one document.
 *
 * The key is built here, from the vendor id the session already established. A
 * client-supplied key is a claim about where bytes may land, and this never
 * accepts one.
 */
export async function requestUpload(input: RequestUploadInput): Promise<UploadTicket> {
  await connectToDatabase();

  const vendor = await Vendor.findOne({ _id: toObjectId(input.vendorId), deletedAt: null })
    .select({ _id: 1 })
    .lean();
  if (!vendor) throw new NotFoundError("vendor", { id: input.vendorId });

  return createUploadUrl({
    scope: "vendor-document",
    key: vendorDocumentPath(input.vendorId, input.filename),
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });
}

export interface ConfirmUploadInput extends RequestUploadInput {
  storageKey: string;
  /** base64(sha256(bytes)), from the browser. Recorded, not trusted. */
  checksumSha256?: string;
}

/**
 * Attach an uploaded object to the vendor.
 *
 * `assertVendorDocumentKey` runs before anything else touches the key: being
 * inside the environment prefix only proves it is one of ours, not that it is
 * *this* vendor's, and the second half of a two-step upload is exactly where that
 * distinction is attacked.
 */
export async function confirmUpload(
  input: ConfirmUploadInput,
  actor: AuditActor & { userId?: string },
): Promise<VendorDocumentDoc> {
  await connectToDatabase();

  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("An upload must name who made it.");
  }

  assertVendorDocumentKey(input.storageKey, input.vendorId);

  const duplicate = await VendorDocument.findOne({ storageKey: input.storageKey })
    .select({ _id: 1 })
    .lean();
  if (duplicate) {
    throw new ConflictError("That upload has already been recorded.");
  }

  // HEAD for size and declared type, then a 4KB range read to sniff magic bytes.
  // A `.exe` renamed `passport.pdf` is refused here and the object is deleted —
  // or the delete is attempted; see `purge()` on why that is not a guarantee.
  await verifyUpload({
    key: input.storageKey,
    expectedSizeBytes: input.sizeBytes,
    expectedContentType: input.contentType,
  });

  const [doc] = await VendorDocument.create([
    {
      vendorId: toObjectId(input.vendorId),
      level: input.level,
      kind: input.kind,
      storageKey: input.storageKey,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      ...(input.checksumSha256 ? { sha256: input.checksumSha256 } : {}),
      uploadedByUserId: toObjectId(actor.userId),
      uploadedAt: new Date(),
    },
  ]);

  if (!doc) throw new Error("VendorDocument.create returned nothing.");

  // Mark the level as awaiting a decision, so the vendor's screen and the staff
  // queue agree about whose move it is.
  await Vendor.updateOne(
    { _id: toObjectId(input.vendorId), [`verification.${input.level}.status`]: "unstarted" },
    { $set: { [`verification.${input.level}.status`]: "pending" } },
  );

  await writeAuditLog({
    action: "vendor_document.uploaded",
    actor,
    subject: { type: "vendor", id: input.vendorId },
    // The kind and the level, never the key — an audit row must not carry a
    // handle to the bytes it is describing.
    after: { level: input.level, kind: input.kind, sizeBytes: input.sizeBytes },
    source: "vendor",
  });

  return doc.toObject() as VendorDocumentDoc;
}

/** Documents for one vendor. Staff-facing and vendor-facing alike. */
export async function listDocuments(
  vendorId: string,
  options: { includePurged?: boolean } = {},
): Promise<VendorDocumentDoc[]> {
  await connectToDatabase();
  return VendorDocument.find({
    vendorId: toObjectId(vendorId),
    ...(options.includePurged ? {} : { purgedAt: null }),
  })
    .sort({ uploadedAt: -1 })
    .limit(100)
    .lean<VendorDocumentDoc[]>();
}

/** One document, for the authorised read route. */
export async function findDocument(documentId: string): Promise<VendorDocumentDoc | null> {
  await connectToDatabase();
  return VendorDocument.findOne({ _id: toObjectId(documentId) }).lean<VendorDocumentDoc>();
}

/**
 * Purge the objects behind a decided level, keeping the records.
 *
 * Ticket 02: holding identity documents indefinitely is a liability with no
 * upside, so once a level is decided only the *outcome* is kept — and the SHA-256
 * of what was seen, which is why `decideVerification` takes the hashes before
 * this runs.
 *
 * ## This does not promise the objects have gone
 *
 * `s3:DeleteObject` is **denied** for the app's credential (ticket 05). So the
 * delete is attempted, its failure is logged rather than thrown — refusing the
 * verification decision because a bucket policy is wrong would be the wrong
 * failure — and `purgedAt` records that the object *should* be gone. Finding out
 * whether it is takes `npm run storage:media-probe`, not an assumption.
 *
 * Whoever fixes the IAM policy makes this honest without changing a line here.
 */
export async function purgeDecidedDocuments(
  vendorId: string,
  level: VendorVerificationLevel,
  actor: AuditActor,
): Promise<{ purged: number; failed: number }> {
  await connectToDatabase();

  const documents = await VendorDocument.find({
    vendorId: toObjectId(vendorId),
    level,
    purgedAt: null,
  }).lean<VendorDocumentDoc[]>();

  let purged = 0;
  let failed = 0;

  for (const document of documents) {
    try {
      await deleteObject(document.storageKey);
      purged += 1;
    } catch (error) {
      failed += 1;
      log.exception("Could not delete a vendor document object", error, {
        code: "vendor_document.delete_failed",
        documentId: String(document._id),
      });
    }
    // Stamped either way. The record says "this should not exist any more",
    // which stays true whether or not the bucket agreed.
    await VendorDocument.updateOne({ _id: document._id }, { $set: { purgedAt: new Date() } });
  }

  if (documents.length > 0) {
    await writeAuditLog({
      action: "vendor_document.purged",
      actor,
      subject: { type: "vendor", id: vendorId },
      after: { level, attempted: documents.length, deleted: purged, deleteFailed: failed },
      source: "staff",
    });
  }

  return { purged, failed };
}
