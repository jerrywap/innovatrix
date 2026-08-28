import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/config/env";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { bucket, keyRoot, s3Client, storageContext } from "./client";
import {
  assertKeyBelongsTo,
  assertKeyInPrefix,
  contentDisposition,
  healthcheckKey,
  paymentProofKey,
  vendorBrandingKey,
  vendorDocumentKey,
  payoutEvidenceKey,
  productFileKey,
  productMediaKey,
  productVideoKey,
  StorageKeyError,
  type StorageScope,
  type VendorBrandingKind,
} from "./keys";
import { assertBytesMatchDeclared, assertUploadAllowed, STORAGE_POLICY } from "./policy";

/**
 * Object storage service — §44 (uploads), §66 (protected downloads), §85.
 *
 * ## Upload model
 *
 * The browser uploads **directly** to S3 with a presigned URL; bytes never pass
 * through the Next.js server. Two consequences the code has to answer for:
 *
 * 1. **The size cap must be in the signature, not the client.** A presigned PUT
 *    can't express a size *range*, but signing `ContentLength` pins an exact
 *    byte count — the upload fails the signature check if the body differs. The
 *    server validates the client's declared size against the scope policy
 *    before signing, so the cap is enforced by S3, not by the uploader's
 *    goodwill.
 *
 * 2. **`ContentType` must be explicitly signed.** The presigner adds
 *    `content-type` to `unsignableHeaders` by default, so putting `ContentType`
 *    on the command alone restricts nothing — a client could hand back any
 *    type. `signableHeaders: new Set(["content-type"])` is what makes the
 *    declared type binding.
 *
 * Presigned POST would allow a size *range*, but Cloudflare R2 does not
 * implement `POST Object`, so PUT is the only single code path across
 * providers.
 */

/**
 * How long a presigned upload URL stays valid, per scope.
 *
 * Five minutes suits a screenshot and is **wrong for a product package**.
 * Ticket 07's acceptance criterion is a 500MB upload, and at 8 Mbps that takes
 * 500 seconds — the URL would expire mid-upload, and the customer-facing
 * symptom is a progress bar that reaches 60% and fails. An hour leaves room for
 * a slow connection and a retry.
 *
 * Longer is not free: a leaked URL is usable for the whole window. Which is why
 * this is per scope rather than one generous number — the media path keeps the
 * short window it does not need to exceed.
 */
const UPLOAD_TTL_SECONDS: Record<StorageScope, number> = {
  "product-media": 300,
  // Twenty times the size of a screenshot, so twenty times the window: 300s is
  // enough for a 10MB image and would fail a 200MB video on a slow connection at
  // exactly the point the vendor has waited longest.
  "product-video": 1800,
  "product-file": 3600,
  attachment: 600,
  // A receipt is a small file and a high-trust one. Short window.
  "payment-proof": 300,
  "quote-document": 300,
  "invoice-document": 300,
  // Same reasoning as a receipt, more so: a KYC document is small, and the
  // shorter the window the less time a leaked ticket is worth anything.
  "vendor-document": 300,
  // Half the size of a screenshot and the same shape of upload.
  "vendor-branding": 300,
  // A bank document, like a receipt.
  "payout-evidence": 300,
  healthcheck: 60,
};
const DOWNLOAD_URL_TTL_SECONDS = 120;
/** SigV4 hard limit — `SignatureV4.presign` rejects anything larger. */
const MAX_PRESIGN_TTL_SECONDS = 60 * 60 * 24 * 7;

export class StorageError extends DomainError {
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super("INTERNAL", message, { context, cause });
  }
}

/* ────────────────────────────────────────────── upload */

export interface CreateUploadUrlInput {
  scope: StorageScope;
  key: string;
  filename: string;
  contentType: string;
  /** Client-declared byte count. Signed, so the upload must match it exactly. */
  sizeBytes: number;
  /** base64(sha256(bytes)). AWS verifies server-side; see the R2 note below. */
  checksumSha256?: string;
}

export interface UploadTicket {
  url: string;
  key: string;
  method: "PUT";
  /** The browser must send these verbatim or the signature check fails. */
  headers: Record<string, string>;
  expiresAt: Date;
  maxBytes: number;
}

export async function createUploadUrl(input: CreateUploadUrlInput): Promise<UploadTicket> {
  const ctx = storageContext();
  const key = assertKeyInPrefix(input.key, ctx.root);

  // Throws StoragePolicyError with a customer-safe message.
  const policy = assertUploadAllowed({
    scope: input.scope,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  const ttl = UPLOAD_TTL_SECONDS[input.scope];
  const headers: Record<string, string> = { "Content-Type": input.contentType };

  const url = await getSignedUrl(
    s3Client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: input.contentType,
      // Signed ⇒ exact-size enforcement at S3.
      ContentLength: input.sizeBytes,
      ...(input.checksumSha256 ? { ChecksumSHA256: input.checksumSha256 } : {}),
    }),
    {
      expiresIn: ttl,
      // Without this the presigner silently drops content-type from the
      // signature and the declared type becomes unenforceable.
      signableHeaders: new Set(["content-type"]),
      // Keep the checksum a real header rather than a query param, so the
      // client is forced to send it.
      ...(input.checksumSha256
        ? { unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) }
        : {}),
    },
  );

  if (input.checksumSha256) {
    headers["x-amz-checksum-sha256"] = input.checksumSha256;
  }

  return {
    url,
    key,
    method: "PUT",
    headers,
    expiresAt: new Date(Date.now() + ttl * 1000),
    maxBytes: policy.maxBytes,
  };
}

/* ────────────────────────────────────────────── verify */

export interface ObjectHead {
  key: string;
  sizeBytes: number;
  contentType: string;
  etag?: string;
  lastModified?: Date;
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  const ctx = storageContext();
  assertKeyInPrefix(key, ctx.root);

  try {
    const res = await s3Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return {
      key,
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType ?? "application/octet-stream",
      ...(res.ETag ? { etag: res.ETag.replaceAll('"', "") } : {}),
      ...(res.LastModified ? { lastModified: res.LastModified } : {}),
    };
  } catch (error) {
    // HeadObject signals a missing key with NotFound (404), NOT NoSuchKey.
    if (error instanceof NotFound) return null;
    throw new StorageError("Could not read that file from storage.", { key }, error);
  }
}

/**
 * Confirm an upload actually landed and is what it claimed to be.
 *
 * **Call this before persisting any file document.** The browser uploaded
 * directly, so until the server has looked, a file record is an assertion
 * about something nobody verified.
 *
 * Reads the first bytes to sniff the real content type — `HeadObject` returns
 * the *declared* header, so it cannot catch a `.exe` renamed to `.zip`. On a
 * mismatch the object is deleted before the error propagates, so a rejected
 * upload doesn't linger as an orphan.
 */
export async function verifyUpload(input: {
  key: string;
  expectedSizeBytes: number;
  expectedContentType: string;
}): Promise<ObjectHead> {
  const head = await headObject(input.key);

  if (!head) {
    throw new NotFoundError("uploaded file", { key: input.key });
  }

  const fail = async (message: string, context: Record<string, unknown>) => {
    await deleteObject(input.key).catch(() => {});
    throw new ValidationError(message, { file: [message] });
    void context;
  };

  if (head.sizeBytes !== input.expectedSizeBytes) {
    await fail("That upload didn’t complete correctly. Please try again.", {
      expected: input.expectedSizeBytes,
      actual: head.sizeBytes,
    });
  }

  const declared = input.expectedContentType.split(";")[0]?.trim().toLowerCase();
  const stored = head.contentType.split(";")[0]?.trim().toLowerCase();
  if (declared !== stored) {
    await fail("That file’s type didn’t match what was declared.", { declared, stored });
  }

  // Magic-byte check — the part HeadObject cannot do.
  const head4k = await readHead(input.key, 4096);
  if (head4k) {
    try {
      assertBytesMatchDeclared(head4k, input.expectedContentType);
    } catch (error) {
      await deleteObject(input.key).catch(() => {});
      throw error;
    }
  }

  return head;
}

/** Range-read the first N bytes for sniffing, without pulling a 2GB package. */
async function readHead(key: string, bytes: number): Promise<Uint8Array | null> {
  try {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    const array = await res.Body?.transformToByteArray();
    return array ?? null;
  } catch {
    // Sniffing is defence in depth; the allowlist already ran. Don't fail the
    // upload because a range read was refused.
    return null;
  }
}

/* ────────────────────────────────────────────── download */

export async function createDownloadUrl(input: {
  key: string;
  /** Original filename, shown to the customer. Sanitised into the header. */
  filename: string;
  contentType?: string;
  expiresInSeconds?: number;
}): Promise<{ url: string; expiresAt: Date }> {
  const ctx = storageContext();
  const key = assertKeyInPrefix(input.key, ctx.root);

  const expiresIn = Math.min(
    input.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS,
    MAX_PRESIGN_TTL_SECONDS,
  );

  const url = await getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      // Query-string overrides, so they're inside the signature — a customer
      // cannot rewrite the filename or turn the download into an inline render.
      ResponseContentDisposition: contentDisposition(input.filename),
      ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
      ResponseCacheControl: "private, max-age=0, no-store",
    }),
    { expiresIn },
  );

  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

/* ────────────────────────────────────────────── delete */

export async function deleteObject(key: string): Promise<void> {
  const ctx = storageContext();
  assertKeyInPrefix(key, ctx.root);

  try {
    await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (error) {
    throw new StorageError("Could not delete that file.", { key }, error);
  }
}

/**
 * Deliberately a loop, not `DeleteObjects`.
 *
 * The batch command carries `requestChecksumRequired: true`, so the SDK sends a
 * CRC32 header even under `WHEN_REQUIRED` — which S3-compatible providers that
 * don't implement it reject. One-at-a-time is slower and always works. The
 * ticket-25 orphan sweep runs in the background, so the latency is irrelevant.
 */
export async function deleteObjects(keys: readonly string[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    await deleteObject(key);
    deleted += 1;
  }
  return deleted;
}

/* ────────────────────────────────────────────── keys, bound to the caller */

/**
 * The two key helpers callers outside this module should use.
 *
 * The raw builders in `keys.ts` all take a `root`, which is the environment
 * prefix everything is confined to — `innovatrix/{env}/`. That parameter is
 * exactly the sort of thing a caller gets wrong once, quietly, and the
 * consequence is not a bug in CoSetup: this bucket is **shared with other
 * live applications**, including regulated PII under `kyc/`. A wrong root is a
 * write outside our prefix.
 *
 * So the root is resolved here, from validated env, and never crosses the
 * module boundary. Feature code cannot pass the wrong one because it cannot
 * pass one at all.
 */
export function productFilePath(
  productId: string,
  versionId: string,
  filename: string,
): string {
  return productFileKey(storageContext(), productId, versionId, filename);
}

export function productMediaPath(productId: string, filename: string): string {
  return productMediaKey(storageContext(), productId, filename);
}

export function productVideoPath(productId: string, filename: string): string {
  return productVideoKey(storageContext(), productId, filename);
}

/**
 * The unsigned address an uploaded object is read back from.
 *
 * Only correct for objects that are meant to be world-readable — product
 * screenshots, which are marketing material. **Never** build one of these for a
 * release artefact: §66 requires those go through `createDownloadUrl` after an
 * entitlement check, and a permanent URL defeats every part of that.
 *
 * Derived exactly the way `next.config.ts` derives its image allowlist host, so
 * a URL from here is always one `next/image` will accept: an S3-compatible
 * `STORAGE_ENDPOINT` (R2, MinIO) is used verbatim, and plain AWS gets the
 * virtual-hosted form built from bucket and region.
 */
export function publicObjectUrl(key: string, options: { version?: number } = {}): string {
  const ctx = storageContext();
  assertKeyInPrefix(key, ctx.root);

  const env = serverEnv();
  const base = env.STORAGE_ENDPOINT?.trim()
    ? `${env.STORAGE_ENDPOINT.replace(/\/+$/, "")}/${env.STORAGE_BUCKET}`
    : `https://${env.STORAGE_BUCKET}.s3.${env.STORAGE_REGION}.amazonaws.com`;

  // Each segment encoded separately — the slashes are structure, not content.
  const url = `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  /*
   * `version` busts caches after an overwrite.
   *
   * Replacing an image reuses its key, so the URL does not change — and a
   * browser, proxy or CDN holding the previous bytes keeps serving them. S3
   * ignores query parameters it does not recognise on a GET, so a changed `v`
   * is a new cache entry pointing at the same object.
   */
  return options.version ? `${url}?v=${options.version}` : url;
}

/**
 * Where an offline payment's proof lives.
 *
 * There is deliberately **no `publicObjectUrl` counterpart** for this scope.
 * The bucket serves any known key unsigned, and this one holds somebody's
 * banking — account numbers, a remittance advice. It is read only through
 * `/api/payment-evidence/[paymentId]`, which checks a permission and redirects
 * to a short presigned GET. Nothing here may build an addressable URL.
 */
/**
 * A key inside our own prefix that is not expected to exist.
 *
 * For `/api/health`: a HEAD against it distinguishes "the bucket is reachable
 * and the credentials work" (null) from "it is not" (throws). Exported so the
 * route does not have to reach for `storageContext`, which is deliberately
 * internal — every key in this app is built by a named function, and a route
 * assembling one by hand is how a path escapes the prefix.
 */
export function healthcheckProbeKey(): string {
  return healthcheckKey(storageContext());
}

export function paymentProofPath(paymentId: string, filename: string): string {
  return paymentProofKey(storageContext(), paymentId, filename);
}

/**
 * Prove a client-supplied proof key belongs to *this* payment.
 *
 * The second half of the two-step upload, and the reason it exists: without
 * this, a caller could hand back a key pointing at another payment's receipt
 * and have it attached to a record they can read.
 */
export function assertPaymentProofKey(key: string, paymentId: string): string {
  const root = storageContext().root;
  assertKeyInPrefix(key, root);

  if (!key.startsWith(`${root}/payments/${paymentId}/`)) {
    throw new StorageKeyError("That file does not belong to this payment.");
  }
  return key;
}

export function payoutEvidencePath(payoutId: string, filename: string): string {
  return payoutEvidenceKey(storageContext(), payoutId, filename);
}

/**
 * Prove a client-supplied evidence key belongs to *this* payout.
 *
 * The fifth hand-rolled sibling of `assertKeyBelongsTo`, which hardcodes the product
 * prefix. In-prefix alone proves only that a key is one of ours — not that it is this
 * payout's, which is what matters when the key comes back from a browser.
 */
export function assertPayoutEvidenceKey(key: string, payoutId: string): string {
  const root = storageContext().root;
  assertKeyInPrefix(key, root);

  if (!key.startsWith(`${root}/payouts/${payoutId}/`)) {
    throw new StorageKeyError("That file does not belong to this payout.");
  }
  return key;
}

export function vendorDocumentPath(vendorId: string, filename: string): string {
  return vendorDocumentKey(storageContext(), vendorId, filename);
}

/**
 * Prove a client-supplied vendor-document key belongs to *this* vendor.
 *
 * Not `assertKeyBelongsTo`, for the same reason `assertAttachmentKey` isn't: that
 * one checks the `products/{id}/versions/{id}/` layout and a vendor document is
 * `vendors/{id}/documents/`. Being in the environment prefix only proves the key
 * is one of ours, not that it is this caller's — and the attack this closes is a
 * vendor attaching another vendor's passport scan to their own record and then
 * reading it through the authorised route.
 */
export function assertVendorDocumentKey(key: string, vendorId: string): string {
  const root = storageContext().root;
  assertKeyInPrefix(key, root);

  if (!key.startsWith(`${root}/vendors/${vendorId}/documents/`)) {
    throw new StorageKeyError("That file does not belong to this vendor.");
  }
  return key;
}

/**
 * A vendor's cover image or logo. The key is derived, never supplied.
 *
 * There is no `filename` parameter, and that is the signature saying what
 * `vendorBrandingKey`'s docblock explains: the key is `{vendorId}/{kind}` and
 * nothing else, so uploading a second cover replaces the first rather than
 * leaving it behind in a bucket we may not delete from.
 */
export function vendorBrandingPath(vendorId: string, kind: VendorBrandingKind): string {
  return vendorBrandingKey(storageContext(), vendorId, kind);
}

/**
 * Prove a client-supplied vendor-branding key belongs to *this* vendor.
 *
 * Provided for symmetry with `assertVendorDocumentKey`, and currently unused by
 * design: because the key is fully derived from the vendor and the kind, the
 * upload action never accepts one from a client and so has nothing to check.
 * The moment any caller *does* take a key from a request, this is the function
 * it owes — in-prefix alone would only prove the key is one of ours, not that it
 * is this vendor's.
 */
export function assertVendorBrandingKey(key: string, vendorId: string): string {
  const root = storageContext().root;
  assertKeyInPrefix(key, root);

  if (!key.startsWith(`${root}/vendors/${vendorId}/branding/`)) {
    throw new StorageKeyError("That file does not belong to this vendor.");
  }
  return key;
}

/**
 * Prove a client-supplied attachment key belongs to this organisation *and*
 * this subject.
 *
 * Not `assertKeyBelongsTo` — that one checks the `products/{id}/versions/{id}/`
 * layout, and an attachment key is `attachments/{org}/{subject}/`. Passing an
 * attachment key to it fails every time, which at least fails safe, but the
 * first version of this did exactly that and would have rejected every legitimate
 * upload.
 */
export function assertAttachmentKey(
  key: string,
  organizationId: string,
  subjectId: string,
): string {
  const root = storageContext().root;
  assertKeyInPrefix(key, root);

  if (!key.startsWith(`${root}/attachments/${organizationId}/${subjectId}/`)) {
    throw new StorageKeyError("That file does not belong to this request.");
  }
  return key;
}

/**
 * Prove a client-supplied *media* key belongs to this product.
 *
 * Separate from `assertProductFileKey` only for the name: "product file" is the
 * release-artefact model, and calling it to validate a screenshot reads like a
 * mistake even though the check is the same one.
 */
export function assertProductMediaKey(key: string, productId: string): string {
  return assertKeyBelongsTo(key, storageContext().root, { productId });
}

/** Prove a client-supplied key belongs to this product (and version). */
export function assertProductFileKey(
  key: string,
  owner: { productId: string; versionId?: string },
): string {
  return assertKeyBelongsTo(key, storageContext().root, owner);
}

/**
 * Write bytes from **this process** into the bucket — vendor ticket 06.
 *
 * The one legitimate exception to "bytes never pass through the Next.js server", and it
 * is narrow: the mirror and repository delivery methods fetch an artefact from a URL a
 * vendor gave us and have to put it somewhere. There is no browser in that path to hand
 * a presigned PUT to.
 *
 * It runs in a **job**, never a request — a 2GB artefact does not belong in a request
 * lifecycle — and the caller has already size-capped the read. Do not reach for this
 * from a Server Action: the presigned PUT exists precisely so a phone photo does not
 * have to clear a body limit.
 *
 * Overwrites in place when the key already exists, which is how a retried mirror avoids
 * orphaning — `s3:DeleteObject` is denied, so nothing else would clean up after it.
 */
export async function putObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  assertKeyInPrefix(input.key, keyRoot());

  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    }),
  );
}

export { STORAGE_POLICY, assertUploadAllowed };
export type { StorageScope };
export * from "./keys";
export { StoragePolicyError, formatBytes } from "./policy";
