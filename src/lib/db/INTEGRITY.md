# Referential integrity rules

MongoDB has no foreign keys and no `ON DELETE` behaviour. Every guarantee that
would be a database constraint in Postgres is produced by application code
instead. **This file is the contract**: if a reference field exists, it appears
here with an owner, or it is unowned and will eventually rot.

Ticket 02 extends this table as it adds collections. A new reference field
without a row here should fail review.

## How to read this

| Column | Meaning |
|---|---|
| **On target delete** | `restrict` — refuse the delete · `null` — clear the pointer · `cascade` — delete dependents · `retain` — deliberately keep a dangling snapshot |
| **Enforced by** | The service that owns the rule. Not "the UI" — server actions are reachable by direct POST. |

## Rules

| Field | Points at | Required | On target delete | Enforced by |
|---|---|---|---|---|
| `*.organizationId` | `organizations` | yes | `restrict` | `OrgScopedRepository` + `requireOrg` (DAL) |
| `organizationMembers.userId` | `users` | yes | `cascade` | `OrganizationService.removeMember` |
| `products.categoryIds[]` / `industryIds[]` / `technologyIds[]` / `productTypeId` | `taxonomies` | no | `restrict` — refuse while any product references it | `TaxonomyService.remove` |
| `products.facets[]` | *derived from* `taxonomies.slug` | — | re-derive on rename | `TaxonomyService.update` / `ProductService.saveClassification` |
| `products.currentVersionId` | `productVersions` | no | `null` | `ProductService.releaseVersion` |
| `productFiles.productId` | `products` | yes | `cascade` (+ delete the objects) | `ProductFileService` |
| `productVersions.productId` | `products` | yes | `restrict` while published | `ProductService.archive` |
| `productFiles.versionId` | `productVersions` | yes | `cascade` (+ delete the object) | `ProductFileService` |
| `carts.items[].productId` | `products` | yes | `retain` (re-validated on read) | `CartService.recalculate` |
| `orders.items[]` | *snapshot* | — | `retain` — **never** re-derive (§61) | `CheckoutService` |
| `entitlements.orderId` | `orders` | yes | `restrict` | `EntitlementService` |
| `entitlements.productId` | `products` | yes | `restrict` — ownership outlives delisting | `ProductService.archive` |
| `licences.entitlementId` | `entitlements` | yes | `cascade` (revoke, don't delete) | `LicenceService.revoke` |
| `downloads.entitlementId` | `entitlements` | yes | `retain` — append-only audit | — (immutable) |
| `payments.subjectId` | `orders` \| `invoices` | yes | `restrict` | `PaymentService` |
| `aiConversations.productId` | `products` | no | `retain` — transcript is evidence (§19) | — |
| `customerRequests.aiConversationId` | `aiConversations` | yes | `restrict` | `RequestService` |
| `customerRequests.baseProductId` | `products` | no | `retain` + version snapshot (§20) | `RequestService` |
| `quotes.requestId` | `customerRequests` | yes | `restrict` | `QuoteService` |
| `invoices.sourceId` | `quotes` \| `orders` | yes | `restrict` | `InvoiceService` |
| `messages.conversationId` | `conversations` | yes | `cascade` | `ConversationService` |
| `followUps.subjectId` | polymorphic | yes | `cascade` | `FollowUpService` |
| `activityEvents.subjectId` | polymorphic | yes | `retain` — timeline is history | — (immutable) |
| `auditLogs.*` | polymorphic | yes | `retain` — append-only (§90) | — (immutable) |

## Invariants that are not reference rules

1. **Money is an integer.** Enforced by `MoneySchema`'s validator (`base.ts`),
   not by convention.
2. **A paid order has exactly one entitlement per licence line.** Fulfilment is
   idempotent (ticket 14), so webhook + reconciliation racing produces one set.
3. **`payments` is unique on `(provider, providerRef)`.** This index *is* the
   webhook idempotency key (§87) — dropping it reintroduces double fulfilment.
4. **Order line prices are frozen.** No code path recomputes an order total from
   a live product document (§61).
5. **Business references are gapless per prefix+year.** Generate inside the
   caller's transaction (`counterStore(session)`), or a rollback leaves a hole.
6. **Internal messages never reach a customer payload.** Filtered in the
   repository query, not in the component (§37, ticket 21).

---

## Taxonomy references and the derived `facets` array

Two rows above deserve more than a table cell, because both fail *silently*.

**`taxonomies` has no `deletedAt`.** Unlike products, `BaseRepository.deleteById`
therefore **hard-deletes** a taxonomy. Deleting one still referenced leaves every
product carrying a dangling id and a stale facet string, and nothing anywhere
errors — the marketplace simply stops matching a filter that used to work. Hence
`restrict`: `TaxonomyService.remove` counts referencing products first and
refuses with the count. Setting `isActive: false` is the normal path; delete is
for typos.

**`products.facets` stores slugs, not ids.** That is what lets
`?category=crm&industry=property` filter without resolving ids first — the whole
reason the array exists (see `ERD.md` on `CannotIndexParallelArrays`). The cost
is that renaming a taxonomy's slug invalidates the derived value on every
referencing product, so `TaxonomyService.update` re-derives them in bulk.

Do **not** take the shortcut of `updateMany({ facets: "cat:old" }, { $set: {
"facets.$": "cat:new" } })`. It is one query, and it makes a second writer of a
derived field — breaking the sorted/deduped invariant `buildProductFacets()`
establishes, which is exactly the drift `ERD.md` warns about. `deriveFacets()`
stays the only writer.

A rename also breaks bookmarked filter URLs. Accepted for MVP: ticket 08 treats
an unknown facet slug as "no results" rather than an error. If that becomes a
problem, `Taxonomy` gains a `slugHistory` mirroring `Product`'s.
