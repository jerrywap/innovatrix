# 02 — Vendor Verification & Trust

**Bucket:** §20.2 · **Depends on:** vendor 01; ticket 05 · **Blocks:** vendor 09, 11 · **Size:** M
**Spec:** §85 (file storage), §88 (security — secure file handling), §89 (credentials — nothing sensitive in ordinary fields), §66 (signed downloads), §90 (audit)

## Why
A verified vendor is the difference between a marketplace and a file-sharing
site. Verification is also what makes a payout defensible: money leaves the
platform to a legal entity, and §88's secure-file-handling and §89's
credential-handling rules both bite on the documents that prove who that entity
is.

## Scope

### What is verified, and in what order

Two levels, because they gate different things and one is much cheaper:

| Level | Evidence | Unlocks |
|---|---|---|
| **Identity** | Government ID, matching contact email, confirmed country | Listing products (vendor ticket 04) |
| **Business** | Company registration, trading name, tax reference, proof of a payout account in the same name | Receiving a payout (vendor ticket 09) |

A vendor can sell before business verification completes; earnings accrue in the
ledger and are simply not payable. That ordering is deliberate — it removes the
slowest step from the path to a first listing without ever letting money leave
to an unverified account.

### Documents (`/dashboard/selling/verification`)

A new **`vendor-document` storage scope** in `STORAGE_POLICY`: 10MB, PDF/JPEG/
PNG only, with the existing magic-byte sniff via `verifyUpload()`, which the
whole platform now uses on every upload path.

Key layout, following the existing shape:

```
innovatrix/{env}/vendors/{vendorId}/documents/{nanoid}-{safeName}
```

A key is bound to its vendor, so a client-supplied key pointing at another
vendor's documents is refused rather than attached — the same cross-tenant theft
attack the product-file guard already closes.

> **Corrected during implementation.** This said `assertKeyBelongsTo`, which
> cannot serve it: that helper hardcodes `${root}/products/${productId}/` and a
> vendor document is `vendors/{id}/documents/`. It gets a fourth hand-rolled
> sibling, `assertVendorDocumentKey`, alongside `assertPaymentProofKey` and
> `assertAttachmentKey` — the latter of which carries a comment recording that its
> first version *did* reuse `assertKeyBelongsTo` and would have rejected every
> legitimate upload.

**Bytes never pass through the server**, in either direction — presigned PUT up,
presigned GET down. This is not a preference: the bucket is shared with
unrelated live applications including regulated PII, so every key is built
server-side and checked against the environment prefix.

### Reading a document

Only through an authenticated route that checks the permission, writes an audit
row, and then 307s to a five-minute presigned GET — modelled exactly on
`/api/payment-evidence/[paymentId]`. **Never** `publicObjectUrl()`. The bucket
answers any known key over plain HTTPS with no signature, so an unguessable URL
is the only thing protecting a passport scan, and that is not protection.

Every read is audited with the staff member who read it. A KYC document is
exactly the thing somebody should have to explain looking at.

### Retention

Verification documents are deleted once verification is decided, and only the
*outcome* is kept: level, decision, decider, date, and a hash of what was seen.
Holding identity documents indefinitely is a liability with no upside, and
`s3:DeleteObject` is currently denied for the app's credential — so this ticket
either establishes a credential that can delete inside the vendor prefix, or
records the deletion as a manual operational step. It does not pretend the
objects have gone.

### Badges and what they claim

A verified badge on the storefront (vendor ticket 11) says the platform checked
a legal identity. It says nothing about software quality, and the wording on the
public page says so — a badge that implies more than was checked is worse than
no badge.

### Re-verification

Triggered by: a change of legal name, country, or payout account; a suspension
being lifted; or a document reaching its expiry. Re-verification suspends
**payouts**, not sales — the products already sold have customers depending on
them, and vendor ticket 12 covers why entitlements survive everything.

## Out of scope
Automated identity providers. A staff member reads the documents and decides;
the decision fields are shaped so a provider becomes a driver behind them later.

## Acceptance criteria
- [ ] A vendor uploads a document through a presigned PUT, and no document byte reaches the Next.js server except the 4KB range read that sniffs its type.
- [ ] A `.exe` renamed `passport.pdf` is refused on magic bytes, and the object is removed.
- [ ] A key belonging to another vendor is refused by `assertVendorDocumentKey`, not merely by being in the right prefix.
- [ ] A document is readable only through the authenticated route: anonymous gets 401, a customer 403, a staff member without the permission 403, and a staff member with it a 307 to a short-lived URL.
- [ ] Every document read writes an audit row naming the staff member.
- [ ] `publicObjectUrl()` is not reachable from any verification code path.
- [ ] Identity verification alone lets a vendor list; it does not let a payout run.
- [ ] Business verification is required before a payout can be marked payable, enforced in the service and not only in the UI.
- [ ] Verification outcomes survive document deletion — the record of what was decided outlives what was seen.
- [ ] Changing a payout account moves the vendor back to re-verification and holds payouts, without unpublishing anything.
- [ ] The public badge wording claims identity verification only, and does not imply a quality review.
