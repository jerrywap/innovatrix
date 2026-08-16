# 05 — Object Storage & File Service

**Bucket:** §0.11 · **Depends on:** 03 · **Blocks:** 07, 14, 21, 22 · **Size:** M
**Spec:** §44 (uploads), §66 (protected downloads), §85 (storage), §88 (secure file handling)

## Why
Paid product packages, customer attachments and generated PDFs all live in object storage. §66 is explicit:
**no permanent public URLs for paid artefacts.** Building this once, correctly, keeps every later feature honest.

## Scope
- S3-compatible client (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). Cloudflare R2 or AWS S3;
  bucket is **private**, no public read policy, no static website hosting.
- `src/services/storage.ts`:
  - `createUploadUrl({ scope, ownerId, filename, contentType, maxBytes })` → presigned PUT + the final key.
  - `createDownloadUrl({ key, expiresIn, filename })` → presigned GET with `Content-Disposition`.
  - `deleteObject(key)`, `headObject(key)`, `copyObject`.
- **Key namespacing** — random, unguessable, and scoped so a leaked key reveals nothing:
  ```
  products/{productId}/versions/{versionId}/{nanoid}-{safeFilename}
  attachments/{organizationId}/{requestId}/{nanoid}-{safeFilename}
  documents/quotes/{quoteId}/{nanoid}.pdf
  media/products/{productId}/{nanoid}.{ext}
  ```
  Never use the customer-supplied filename as the key. Sanitise it for the download `Content-Disposition` only.
- **Direct-to-storage uploads**: the browser PUTs to the presigned URL, then calls a server action to record the
  file document. The server verifies with `headObject` that the object exists and matches the declared size and
  content type before persisting — an unverified upload record is a lie.
- Validation: allowlist content types per scope (images for media; zip/tar/pdf/docx/sql for product files;
  images/pdf/docx for attachments). Enforce per-scope size caps. Reject executables.
- Public product media may be served through a CDN — media only, never product packages.
- Virus-scan seam: an `onFileRecorded` hook that a scanner can be attached to later; mark files
  `scanStatus: pending|clean|infected` and block download of anything not `clean` once scanning is enabled.
- Cleanup job (registered in ticket 25): delete orphaned objects with no database record after 24h.

## Out of scope
Entitlement checks on download (ticket 14) — this ticket only provides the signing mechanism.

## Acceptance criteria
- [ ] Fetching a product-package object URL without a signature returns 403.
- [ ] A presigned download URL expires; a request after expiry fails.
- [ ] Uploading a `.exe` renamed to `.zip` is rejected on content-type verification.
- [ ] A file record is never created when the object is missing from storage.
- [ ] Storage keys contain no sequential ids that let a customer guess another customer's file.
- [ ] Bucket policy audit: no anonymous read on the private bucket.
- [ ] Oversized uploads are rejected by the presigned policy, not just by client-side validation.

---

## Implementation notes (built 2026-08-15)

Delivered: `src/services/storage/{client,keys,policy,index}.ts`, 36 unit tests, and
`npm run storage:probe` — a live round-trip against the configured bucket.

### Corrections to this ticket's original assumptions

1. **Presigned PUT *can* enforce a size cap.** The ticket assumed it couldn't and that presigned
   POST would be needed. Signing `ContentLength` pins an *exact* byte count — verified: replaying
   the same URL with five extra bytes is rejected 403 by S3. Presigned POST was dropped entirely
   because Cloudflare R2 does not implement `POST Object`, so PUT is the only single code path
   across providers.
2. **`ContentType` is not signed by default.** `S3RequestPresigner.prepareRequest` adds
   `content-type` to `unsignableHeaders`, so putting `ContentType` on the command restricts
   nothing on its own. `signableHeaders: new Set(["content-type"])` is required, and the probe
   asserts `X-Amz-SignedHeaders` contains it.
3. **SDK checksums must be `WHEN_REQUIRED`.** Since client-s3 v3.729 the default runs the
   flexible-checksums middleware during presigning, computing the CRC32 of an *empty* body and
   hoisting it into the signed query string. The probe asserts no `x-amz-checksum-*` query param.
4. `forcePathStyle` is `false` for AWS **and** R2; only MinIO/LocalStack need it, so it is a
   separate env flag rather than inferred from `STORAGE_ENDPOINT`.
5. `HeadObject` throws `NotFound`, not `NoSuchKey`.

### 🔴 Two environment blockers — not fixable in code

**1. Uploaded objects are publicly readable.** An unauthenticated `GET` of an object we just wrote
returns **200**; a nonexistent key returns 403. That signature (200 for real keys, 403 for missing
ones, no public `ListBucket`) means the bucket carries a **public-read bucket policy on objects**.

This fails this ticket's own criterion — *"Fetching a product-package object URL without a
signature returns 403"* — and §66. Presigned URLs provide no protection when the underlying object
is public; the only thing standing between a paid package and the world is the unguessability of
the nanoid in the key. **Paid artefacts must not be stored in this bucket until the public-read
policy is removed**, or Innovatrix needs its own bucket. Product *media* would be fine; product
*packages* are not.

**2. `s3:DeleteObject` is denied** for `arn:aws:iam::241212941344:user/sharepro-uploader`.
Verified permissions: PutObject ✓, GetObject ✓, HeadObject ✓, ListObjectsV2 ✓, DeleteObject ✗.
Consequences:
- `verifyUpload()` cannot remove an object that fails verification — it catches the failure so the
  rejection still propagates correctly, but the bad object is left behind.
- Ticket 25's orphan-cleanup job cannot run with this credential.
- Ticket 07's "delete a product file" cannot work.
The probe left orphans under `innovatrix/development/healthcheck/` that cannot be removed from
here.

### Prerequisite we cannot satisfy from code

**Bucket CORS.** Direct browser uploads require `PUT` allowed from the app origin with
`Content-Type` and `Content-Length` in `AllowedHeaders`. The credential is denied
`GetBucketCors`, so this can neither be set nor verified from here. Until it is configured, the
signing works but a browser upload will fail preflight. Server-side `PUT` (`storage:probe`) is
unaffected.

Minimum policy:

```json
[{ "AllowedOrigins": ["http://localhost:3000", "https://<app-domain>"],
   "AllowedMethods": ["PUT", "GET", "HEAD"],
   "AllowedHeaders": ["content-type", "content-length", "x-amz-checksum-sha256"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]
```

### Acceptance criteria — actual status

- [x] A presigned download URL expires; a request after expiry fails (403, verified)
- [x] Uploading a `.exe` renamed to `.zip` is rejected — magic-byte sniffing in `assertBytesMatchDeclared`
- [x] A file record is never created when the object is missing — `verifyUpload` throws `NotFoundError`
- [x] Storage keys contain no sequential ids; 21-char nanoid, no ordering information
- [x] Oversized uploads are rejected by the signature, not just client-side (verified against S3)
- [x] `Content-Disposition` honoured, RFC 5987, injection-safe
- [ ] **Fetching an object URL without a signature returns 403** — currently returns 200 (blocker 1)
- [ ] Bucket policy audit: no anonymous read — **fails** (blocker 1)
