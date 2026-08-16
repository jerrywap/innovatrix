import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { bucket, s3Client, storageContext } from "./client";
import {
  assertKeyBelongsTo,
  assertKeyInPrefix,
  contentDisposition,
  productFileKey,
  productMediaKey,
  type StorageScope,
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
  "product-file": 3600,
  attachment: 600,
  "quote-document": 300,
  "invoice-document": 300,
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
 * consequence is not a bug in Innovatrix: this bucket is **shared with other
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

/** Prove a client-supplied key belongs to this product (and version). */
export function assertProductFileKey(
  key: string,
  owner: { productId: string; versionId?: string },
): string {
  return assertKeyBelongsTo(key, storageContext().root, owner);
}

export { STORAGE_POLICY };
export type { StorageScope };
export * from "./keys";
export { StoragePolicyError, formatBytes } from "./policy";
