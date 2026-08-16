# 14 — Entitlements, Licensing & Protected Downloads

**Bucket:** §8 · **Depends on:** 07, 13 · **Blocks:** 15 · **Size:** L
**Spec:** §64 (entitlements), §65 (licensing), §66 (downloads), §29 (My Software), §90 (audit)

## Why
§64 defines the chain that turns money into ownership:
`Customer → Order → OrderItem → ProductEntitlement → Licence → Download Access`.
This is the value the customer actually bought, and §66 requires it be protected properly.

## Scope

### Entitlement creation (called from ticket 13, inside its transaction)
For each `product_licence` order line:
- Create an `entitlement`: organization, product, order, order item, licence package snapshot,
  `updatesUntil = paidAt + updateMonths`, `supportUntil = paidAt + supportMonths`, `status: active`.
- Create a `licence` (§65): unique key, type (single project / single installation / multi installation /
  commercial / developer / SaaS / lifetime), activation limit, `expiresAt` (null for perpetual),
  `supportExpiresAt`, `status: active`.
- Licence key format: readable, checksummed, unguessable — e.g. `INVX-XXXX-XXXX-XXXX-XXXX` from CSPRNG bytes with
  a check character. Unique index; regenerate on the astronomically unlikely collision.
- Idempotency: creating entitlements for an order that already has them is a no-op, not a duplicate.
  This is what makes the ticket-13 webhook/reconciliation race safe.

### Entitlement rules service
`canDownload(entitlement, productVersion)`:
- entitlement `active` (not revoked/refunded), and
- the version was released **on or before `updatesUntil`**, or it is the version originally purchased.
A customer whose update window lapsed keeps their purchased version forever and sees newer versions as
locked with an explicit "renew updates" message (renewals themselves are post-MVP — the message is honest
about that, e.g. "contact us to extend").

### Protected download — `app/api/downloads/[fileId]/route.ts`
1. `requireUser` + `requireOrg` (DAL).
2. Load the file → version → product; find the caller's entitlement for that product in that organization.
3. Run `canDownload`. Refuse with 403 and a specific reason if not entitled.
4. Rate-limit per user and per entitlement (ticket 26) — this is the obvious abuse surface.
5. Write a `downloads` audit row (user, ip, user agent, file, at).
6. Redirect to a **short-lived presigned URL** (ticket 05), 5 minutes, `Content-Disposition: attachment`.
Never stream the file through the Next.js server; never return a permanent URL (§66).

### Licence activation (lightweight, MVP)
`POST /api/licences/activate` accepting `{ key, instanceId, domain? }` → records an activation if under the
limit, returns `{ valid, expiresAt, supportExpiresAt }`. Deactivation endpoint for moving installations.
This is the seam products integrate with; keep it small and well-documented.

### Customer-facing licence view
`/dashboard/software/[entitlementId]/licence` — key (masked with reveal + copy), type, terms in plain language,
activations used/limit with the ability to release one, expiry dates, and what happens at expiry.

## Acceptance criteria
- [x] A paid order produces exactly one entitlement and one licence per licence line, with correct dates.
- [x] Re-running fulfilment for the same order creates nothing new.
- [x] A user from another organization requesting the download URL gets 403 and a logged attempt.
- [x] A presigned download URL stops working after its expiry.
- [x] A version released after `updatesUntil` is not downloadable and the UI explains why in plain language.
- [x] The originally purchased version stays downloadable indefinitely.
- [x] Activating past the limit is refused with the current count; releasing an activation frees a slot.
- [x] Every download is logged; **staff visibility is ticket 20's** — the rows and audit entries exist.
- [x] Licence keys are unguessable — no timestamp, no sequence, no order id embedded.
- [x] A refunded payment suspends the entitlement and blocks further downloads.

## Implementation notes

### The check character has to catch transpositions, so it is position-weighted

`lib/licence-key.ts`. 15 CSPRNG characters from a 32-character alphabet with
`I`, `O`, `0` and `1` removed, plus one check character — 75 bits, and nothing
derived from time, sequence or order id.

The check character is `Σ (value(charᵢ) × (i+1)) mod 32`. The position weight is
the whole point: an unweighted sum catches a mistyped character but not two
swapped ones, and transposition is the mistake people actually make reading a
key aloud. `licence-key.test.ts` asserts it, and that assertion fails if the
weight is removed.

An unknown character returns `""` rather than being skipped — otherwise
`INVX-????-????-????-????` would validate as whatever the remaining characters
summed to.

### Two generators had already drifted

`fulfilment.ts` grew its own `generateLicenceKey` in ticket 13, before
`lib/licence-key.ts` existed. By the time ticket 14 added a validator, fulfilment
was still producing keys with **no check character** — so every licence a real
purchase created would have been rejected by the activation endpoint as a typo.
Caught by the integration test, not by reading. The duplicate is deleted; there
is one implementation.

The same bug had already been shipped into the seed: `INVX-SEED-0001-DEMO-0001`
contains `0` and `1`, which are not in the alphabet. The seeded demo licence
could not be activated. It is now built from a fixed body plus a *computed*
check character, so it follows the checksum if the checksum ever changes.

### The purchased-version escape is checked before the window, not after

`services/entitlements/rules.ts`, and the ordering is load-bearing. §45 says a
lapsed update window stops *new* releases; it does not repossess the software.
Check the window first and an expired entitlement rejects the customer's own
purchased version on the way past — taking away something they own. There is a
test named for exactly that ordering.

`availableUpdate` runs `canDownload` rather than comparing version numbers, so
the "Update available" badge cannot appear for something the customer would then
be refused.

### Refusals from the activation endpoint are 200, not 4xx

An installer asking "is this licence good?" and being told "no, and here is why"
got a successful answer. A 403 makes every HTTP client in the world treat a
legitimate `limit_reached` as a transport failure worth retrying. The endpoint
returns `200 { valid: false, refusal, message }`.

The activation limit is enforced by an `$expr` guard **inside** the
`findOneAndUpdate` filter that counts live activations, so the database decides.
Two concurrent activations against a one-seat licence were forced live and
produced exactly one.

Releasing stamps `releasedAt` and never deletes — the history is the record of
where software has been installed.

### `checkLicence` was removed rather than shipped

A read-only verify that claimed no slot. Written, correct, and never wired to a
route or called by anything. The ticket specifies two operations; an exported
third with no caller reads as API surface products can integrate against, which
it was not.

### The service was an existence oracle; only the route hid it

`authoriseDownload` threw `NotFoundError` for a missing file and
`ForbiddenError` for one you don't own — two branches apart from a comment
claiming they were indistinguishable. Probe ids, watch which error comes back,
and you have enumerated the catalogue's private files without owning any.

The download route flattened both to 403, so the deployed behaviour was safe.
That made the safety a property of one caller rather than of the rule, and the
next caller would not have known. All three refusals — missing file, missing
version, no entitlement — now throw the same error with the same sentence, and
the route's `NotFoundError` branch is gone.

Found by an integration test asserting the two answers matched, not by reading
the code. The cost accepted: an owner whose file row points at a deleted version
reads "you don't have a licence" instead of "that file is missing".
`INTEGRITY.md` makes those deletes a `restrict`, so a confusing message in a case
that shouldn't happen is cheaper than an enumerable one that can.

### `findOneAndUpdate` skips validators, and the seed found out

The seeded release file was written with `kind: "release"`, which is not in
`PRODUCT_FILE_KINDS`. Mongoose's `findOneAndUpdate` does not run validators
unless asked, so the write succeeded and the seed printed success. The enum
caught it only once an integration test used `create()`. `runValidators: true`
now, and worth remembering wherever else the seed upserts.

### Authentication is checked before the id is validated

Initially the route parsed `fileId` first, so an anonymous caller got 400 for a
malformed id and 401 for a well-formed one — which turns the endpoint into an
id-format oracle for someone with no session at all. Anonymous is now 401
whatever the id. Beyond that, "no such file" and "not yours" are both a flat 403
with the same message: whether a given file id exists is not something a stranger
gets to probe.

### Known limits

- **Rate limiting is ticket 26's.** The scope names it and it is not here. This
  is the obvious abuse surface: an entitled customer can pull presigned URLs in
  a loop.
- **The download log is not yet visible to staff** — Customer 360 is ticket 20.
  The `downloads` rows and `download.served` audit entries are written and were
  confirmed present with user, org, ip and user agent.

### Verified live

Against the dev database and the shared `sharepro-ng` bucket, signed in as the
seeded customer:

- The presigned redirect targets `innovatrix/development/…` — inside the
  prefix, which is the containment boundary that keeps this out of
  `gracia-production/` and `kyc/`.
- `X-Amz-Expires=300`; the URL returns the bytes immediately and **403 Request
  has expired** after 310 seconds.
- Anonymous → 401 for both a well-formed and a malformed id. Owner → 307.
  Owner asking for an unknown file → 403.
- Activation: idempotent per `instanceId`; a second instance on a one-seat
  licence refused with `limit_reached (1/1)`; releasing frees the slot and the
  second instance then succeeds.
- Download authorisation allows the owning organisation, refuses another,
  refuses a suspended entitlement, and **allows the purchased version after the
  update window has closed**.

### The seed produced files that could not be downloaded

Worth recording because the endpoint looked correct while being unusable: the
seed created no `productFiles` at all, and the one row in the dev database was
`probe.zip` — an orphan left by ticket 07's storage probe after its object was
cleaned up. So every Download button rendered, authorised, signed a valid URL,
and landed on a 404 from S3.

The seed now uploads a small deterministic placeholder per released version and
records its real size and sha256, skipping with a printed reason when
`STORAGE_*` is unset so a first-time setup still seeds. Keys are reused from the
existing row rather than re-minted, because `productFileKey()` embeds a
`nanoid()` and regenerating would orphan an object on every run.
