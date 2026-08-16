# 07 — Product Versions, Files & Demo Configuration

**Bucket:** §4.7–4.9, 4.11 · **Depends on:** 05, 06 · **Blocks:** 09, 14 · **Size:** M
**Spec:** §44 (uploads), §45 (versioning), §9 (demo credentials), §47 (internal testing), §89 (credential handling)

## Why
Versions decide what a customer may download (§45 — "customers should see versions according to their
entitlement"), and demo credentials are the first place this platform stores something genuinely sensitive.

## Scope

### Versions (`/admin/products/[id]/versions`)
- Create a version: semantic `version`, release date, release notes (rich text), changelog entry, minimum
  requirements, status (`draft | released | deprecated`), and `updateEligibility` describing which prior
  entitlements get it free.
- One version is the product's `currentVersionId`. Releasing a new version updates the pointer and emits a
  `ProductVersionReleased` event (consumed by notifications in ticket 24 — "Updates Available" in §29).
- Version history is immutable once released: edit release notes, never the artefacts.

### Files (per version)
- Upload via ticket 05 presigned PUT: application package, source package, documentation, database file,
  setup guide, sample data, related assets (§44).
- Record filename, size, checksum (SHA-256, computed client-side and re-verified or computed on first download),
  and `kind`. Display the checksum to customers so they can verify integrity.
- Delete requires confirmation and is blocked if any entitlement's only downloadable artefact would disappear.

### Demo configuration (§9)
A product may declare:
- `publicDemoUrl`, `customerDemoUrl`, `adminDemoUrl`
- `credentials: [{ role, label, url, username, passwordEncrypted }]` — multiple role credentials
- `instructions`, `resetSchedule` (informational for MVP)
- `exposure: public | authenticated | owners_only` — controls who sees the credentials on the product page.

**Security requirements (§9, §89):**
- Passwords are **encrypted at rest** with an app key (AES-256-GCM via `node:crypto`), never stored plaintext,
  never returned to any client that isn't entitled to see them, never logged.
- Decryption happens server-side inside the product-detail service, gated by `exposure`.
- The admin form warns explicitly: **never enter production credentials as demo credentials.**
- Rate-limit the credential-reveal endpoint (ticket 26).

### Internal testing checklist (§47)
Before `ready`, staff tick off and note: installation, authentication, major workflows, demo credentials,
database setup, documentation, security review, download package integrity, environment requirements, payment
integrations. Stored as `{ item, status, checkedBy, checkedAt, notes }[]` on the product. Publish is blocked
until every item is `pass` or explicitly `n/a` with a note.

## Acceptance criteria
- [~] Uploading a 500MB package succeeds via presigned PUT without passing through the Next.js server —
  **the server half is proven**, the browser half is blocked by ticket 05's missing bucket CORS. See below.
- [x] A released version's artefacts cannot be swapped; only its notes are editable.
- [x] Demo passwords are ciphertext in MongoDB — verified by reading the raw document.
- [x] With `exposure: owners_only`, an anonymous visitor's product-page payload contains no credential fields
      at all (not merely hidden in the UI).
- [x] Publish is blocked with a clear list of unchecked testing items.
- [x] A customer entitled to v2.4.0 does not see a v2.5.0 download when their update window has expired
      (rule declared here, enforced in ticket 14) — `isFreeUpgrade()` in `src/lib/semver.ts`, with the
      *window* left to ticket 14 because it is a date comparison against the entitlement.
- [x] Checksums shown on the download page match the stored artefact.

---

## Implementation notes

### The 500MB criterion, split honestly

The **signature, TTL, ownership check and post-upload verification are all
server-side and all verified against the real bucket**: a 12MB PUT round-trips,
the URL carries a 3600s TTL (ticket 05 signed 300s, which expires mid-upload at
500MB), `content-length`, `content-type` and `x-amz-checksum-sha256` are all
inside the signature, and S3 returns **403** for a 12MB body sent against a 1KB
signature — the size cap is enforced by S3, not by the uploader's goodwill.

What cannot be verified is the *browser* half, because the bucket has no CORS
configuration and the credential is denied `GetBucketCors`. The preflight fails
before a byte moves. `FileUploader` is written and will work unchanged once CORS
is set; its error handler names CORS explicitly, because that is what the
failure will actually be.

The probe left two objects under `innovatrix/development/products/6a80…aa/` that
**cannot be removed** — `s3:DeleteObject` is denied for this credential.

### Why XMLHttpRequest

`fetch` has no upload progress event, and there is no workaround short of a
`ReadableStream` body (HTTP/2 only, unsupported in Safari, needs `duplex`). At
500MB a spinner with no number is indistinguishable from a hang, and people
cancel and retry — which makes it worse.

### Checksums are two-tier, and §44 says so

`crypto.subtle.digest` needs an `ArrayBuffer` — the whole file in memory. Fine
for a 40MB documentation bundle, fatal for a 2GB package: the tab dies having
already read the file once. So the split is at **100MB**; below it the digest
goes into the signature so S3 rejects a corrupted upload itself, above it §44's
"compute on first download" applies. An absent checksum means *not yet
computed*, not *unverified forever*.

### The demo credentials guarantee is structural

Two functions with two return types, and the public one **cannot** carry a
secret because its type has no field for it:

- `publicDemoView()` — roles and a `hasPassword` boolean. Safe for any payload
  or cache. Built key by key, because a spread would carry `credentials`.
- `revealCredentials()` — the only thing in the codebase that decrypts.
  Uncached, `server-only`, and it takes the viewer as an *argument* so the
  authorisation is visible at the call site.

That matters because conditional **rendering** is not conditional
**serialisation**: `{canSee && <Password value={p} />}` still ships `p` in the
RSC payload. The test asserts it by walking the serialised view for the strings,
not by checking named properties — a stray `credentials` array would pass the
narrow check and fail this one.

Also structural: **AAD is the product id**, so a ciphertext copied between
products does not decrypt; and `customerUrl`/`adminUrl` are withheld alongside
the passwords, because a back-office link is itself a hint.

### Blank password means "keep it"

The form never pre-fills a password — there is nothing to pre-fill it with that
would not mean decrypting and sending the plaintext on every page load. So blank
is ambiguous, and the alternative reading wipes every other credential the
moment somebody corrects a typo in one row's label, silently. Rows are matched
by `role`; clearing is an explicit act (delete the row).

### Two bugs the tests caught

1. **`saveDemo` had two `$set` keys in one object literal.** The second
   overwrote the first, so exposure and URLs would save and the credentials
   would silently not — the worst possible partial write for this section.
2. **The audit redactor stripped the demo row's own fields.**
   `redactAuditPayload` matches `/password|credential|.../` on key names, so
   `credentialRoles` and `passwordsChanged` both logged as `"[redacted]"` and
   the row said nothing. The redactor is right to be blunt; the fields are now
   `roles` and `rotated`, named for what they hold.

### The current-version pointer only moves forward

A backported 1.9.1 released after 2.0.0 is a real release and is **not** the
current version — `supersedes()` is the whole rule. Deprecating the current
version falls back to the next newest released one rather than leaving customers
pointed at something we have just withdrawn. Neither failure throws, which is
why both have tests.

19 integration tests against a single-node replica set, plus 22 unit tests for
`semver` and 13 for the exposure rule.
