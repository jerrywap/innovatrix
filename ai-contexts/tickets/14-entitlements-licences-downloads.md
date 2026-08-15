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
- [ ] A paid order produces exactly one entitlement and one licence per licence line, with correct dates.
- [ ] Re-running fulfilment for the same order creates nothing new.
- [ ] A user from another organization requesting the download URL gets 403 and a logged attempt.
- [ ] A presigned download URL stops working after its expiry.
- [ ] A version released after `updatesUntil` is not downloadable and the UI explains why in plain language.
- [ ] The originally purchased version stays downloadable indefinitely.
- [ ] Activating past the limit is refused with the current count; releasing an activation frees a slot.
- [ ] Every download is logged; the log is visible to staff on Customer 360.
- [ ] Licence keys are unguessable — no timestamp, no sequence, no order id embedded.
- [ ] A refunded payment suspends the entitlement and blocks further downloads.
