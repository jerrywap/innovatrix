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
