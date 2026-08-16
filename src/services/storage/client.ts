import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { serverEnv } from "@/config/env";
import { storageRoot } from "./keys";

/**
 * S3 client — one per process.
 *
 * Two non-obvious settings, each from a verified SDK behaviour rather than a
 * preference:
 *
 * **`requestChecksumCalculation: "WHEN_REQUIRED"`.** Since client-s3 v3.729 the
 * default is `WHEN_SUPPORTED`, which runs the flexible-checksums middleware in
 * the `build` step — *including while presigning*. With no body to hash it
 * computes the CRC32 of the empty string and, because the header is `x-amz-*`,
 * `moveHeadersToQuery` hoists it into the signed query string. Every upload URL
 * then carries a checksum for content that isn't the content. It also breaks
 * outright on S3-compatible providers that don't implement the header. Opt in
 * per-request instead (see `ChecksumSHA256` in index.ts) rather than globally.
 *
 * **`forcePathStyle: false`.** Correct for AWS *and* Cloudflare R2 — both
 * support virtual-hosted addressing. Only MinIO/LocalStack need path style,
 * hence the explicit env flag rather than inferring it from `endpoint`.
 */

declare global {
  var __innovatrixS3: S3Client | undefined;
}

export function s3Client(): S3Client {
  if (globalThis.__innovatrixS3) return globalThis.__innovatrixS3;

  const env = serverEnv();

  const client = new S3Client({
    region: env.STORAGE_REGION,
    // undefined ⇒ AWS derives <bucket>.s3.<region>.amazonaws.com and handles
    // dualstack/FIPS. Set ⇒ R2 or MinIO.
    ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });

  globalThis.__innovatrixS3 = client;
  return client;
}

export function bucket(): string {
  return serverEnv().STORAGE_BUCKET;
}

/**
 * The prefix every key must live under.
 *
 * The dev/staging bucket is shared with unrelated applications, so this is a
 * containment boundary, not a naming scheme. The environment segment follows
 * the convention the bucket's existing tenants already use.
 */
export function keyRoot(): string {
  const env = serverEnv();
  return storageRoot(env.STORAGE_KEY_PREFIX, env.NODE_ENV);
}

export function storageContext() {
  return { root: keyRoot() };
}
