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
- [ ] Uploading a 500MB package succeeds via presigned PUT without passing through the Next.js server.
- [ ] A released version's artefacts cannot be swapped; only its notes are editable.
- [ ] Demo passwords are ciphertext in MongoDB — verified by reading the raw document.
- [ ] With `exposure: owners_only`, an anonymous visitor's product-page payload contains no credential fields
      at all (not merely hidden in the UI).
- [ ] Publish is blocked with a clear list of unchecked testing items.
- [ ] A customer entitled to v2.4.0 does not see a v2.5.0 download when their update window has expired
      (rule declared here, enforced in ticket 14).
- [ ] Checksums shown on the download page match the stored artefact.
