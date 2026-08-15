# 02 — Domain Model & Collections

**Bucket:** §1 Domain Model · **Depends on:** 01 · **Blocks:** 03–28 · **Size:** L
**Spec:** §78 (entities — refine before implementing), §26 (references), §91 (states), §106.9–10

## Why
§78 lists ~45 conceptual entities across all five phases. This ticket refines that down to the ~28 the MVP
actually needs, models them for a document database rather than transcribing a relational ERD, and locks the
indexes. **Do this before any feature ticket.** Reshaping a 28-collection model after five features are built
is the most expensive mistake available on this project.

## Modelling principles for this domain
- **Embed what is read with the parent and owned by it**: product media, features, per-currency prices, AI
  messages, quote line items, order line items.
- **Reference what is queried independently or grows unbounded**: orders, entitlements, requests, invoices,
  payments, activity events.
- **Snapshot across service boundaries.** An order line embeds the product name, version, licence terms and
  price *as they were at purchase* (§61). Never re-derive an old total from a live product document.
- **Every business record carries `reference`** (unique, from ticket 00) alongside `_id`.

## Collections

### Identity & tenancy
| Collection | Notes |
|---|---|
| `users` | Better Auth owns core auth fields (ticket 03). App-level profile, `isStaff`, locale. |
| `organizations` | Name, slug, billing address, tax id, default currency, `customerSince`. |
| `organizationMembers` | `{organizationId, userId, role: owner\|admin\|billing\|technical\|member, invitedAt, acceptedAt}`. Unique on `(organizationId, userId)`. |
| `staffProfiles` | `{userId, roles: StaffRole[], teams, isActive}`. Roles per §77 — **permissions, never a single admin flag**. |

### Catalog
| Collection | Notes |
|---|---|
| `taxonomies` | One collection, `kind: category\|industry\|technology\|productType`, `slug` unique per kind. |
| `products` | The big document. Embeds: `summary`, `description`, `features[]`, `requirements`, `media[]`, `prices[]` (one per currency), `licencePackages[]`, `addons[]`, `demo` (config + **encrypted** credential refs), `customization` (§50), `seo`. References: taxonomy ids, `currentVersionId`. `status` per §46. `slug` unique. |
| `productVersions` | `{productId, version, releaseDate, releaseNotes, changelog, minimumRequirements, status, files[]}`. |
| `productFiles` | Storage key, original filename, size, checksum, `kind: package\|source\|docs\|database\|sample`. **Storage keys are never guessable and never public** (§44). |

### Commerce
| Collection | Notes |
|---|---|
| `carts` | `{ownerKey (userId or guest cookie id), organizationId?, currency, items[], discountCode, expiresAt}`. One currency per cart — enforce on add. |
| `orders` | `{reference, organizationId, userId, currency, items[] (snapshotted), subtotal, discount, tax, total, status, billingAddress, paymentId}`. |
| `entitlements` | `{organizationId, productId, orderId, orderItemId, licenceId, updatesUntil, supportUntil, status}`. |
| `licences` | `{key (unique), entitlementId, organizationId, productId, type, activationLimit, activations[], expiresAt, supportExpiresAt, status}`. |
| `downloads` | Append-only log: `{entitlementId, userId, productFileId, ip, userAgent, at}`. |
| `payments` | `{reference, provider, providerRef, subjectType: order\|invoice, subjectId, amount (Money), status, rawEvents[], verifiedAt}`. Unique on `(provider, providerRef)` — this is the idempotency key. |
| `paymentSettings` | Singleton-ish admin config: enabled providers, per-currency routing, mode. Keys live in env, **not here**. |

### Requirements & requests
| Collection | Notes |
|---|---|
| `aiConversations` | `{organizationId, userId, contextType: customization\|custom_build, productId?, productVersion?, messages[], structuredAnswers, suggestedFeatures[], confirmedRequirements[], summary, status, submittedRequestId}` (§72). Resumable. Cap embedded `messages` — if a transcript can exceed ~1MB, split into `aiMessages`. |
| `customerRequests` | `{reference, kind: customization\|custom_build, organizationId, userId, baseProductId?, baseProductVersion?, aiConversationId, customerRequirements[] (immutable to staff), internalInterpretation, attachments[], status, assignments[], quoteIds[]}` (§19, §34). |
| `followUps` | `{ownerStaffId, dueAt, subjectType, subjectId, organizationId, status, notes}` (§39). |

### Quotes & billing
| Collection | Notes |
|---|---|
| `quotes` | `{reference, requestId, organizationId, scope, deliverables[], exclusions[], items[], currency, subtotal, tax, discount, total, paymentTerms, timeline, expiresAt, status, issuedBy, acceptedBy, acceptedAt, pdfKey}`. |
| `invoices` | `{reference, organizationId, sourceType: order\|quote, sourceId, items[], currency, total, amountPaid, dueAt, status}` (§63). |

### Communication & cross-cutting
| Collection | Notes |
|---|---|
| `conversations` | `{subjectType: request\|order\|quote, subjectId, organizationId, participants[]}` (§38). |
| `messages` | `{conversationId, senderType: customer\|staff\|system, senderId, body, attachments[], visibility: customer\|internal, at}`. **`visibility: internal` must never be serialized to a customer response** (§37). |
| `notifications` | `{recipientUserId, organizationId?, type, subjectType, subjectId, title, body, readAt, channels}` (§69). |
| `activityEvents` | `{subjectType, subjectId, organizationId, type, actorType, actorId, payload, at}` — feeds every timeline (§70). |
| `auditLogs` | Append-only, the §90 action list. Separate from `activityEvents`: activity is customer-facing narrative, audit is compliance. |
| `counters` | Reference sequences (ticket 00). |
| `jobs` | Background queue (ticket 25) if self-hosting the queue. |

## Indexes (declare with the schema, not ad hoc)
- Unique: `products.slug`, `licences.key`, `taxonomies.(kind,slug)`, `organizationMembers.(organizationId,userId)`,
  `payments.(provider,providerRef)`, and `reference` on every referenced collection.
- Tenancy: compound `(organizationId, createdAt desc)` on orders, requests, quotes, invoices, notifications.
- Marketplace: `(status, categoryIds, industryIds, technologyIds)` + a text index (or Atlas Search) over
  `name`, `summary`, `features` — sized for the §5 filter set.
- Staff queues: `(status, assignedStaffId, updatedAt)` on `customerRequests`; `(ownerStaffId, dueAt, status)` on
  `followUps`. These back the §31/§32 counters — they must not collection-scan.
- TTL: `carts.expiresAt`.

## State machines (declare here, enforce in ticket 19)
Write `src/lib/db/STATES.md` with the allowed-transition map for: product publishing (§46), order, payment,
`customerRequest` (§91), quote, invoice (§63). Each entry lists `from → to[]` and who may trigger it.

## Seed script
`npm run db:seed` — taxonomies, 6–8 realistic products across categories with versions/media/prices, one staff
user per §77 role, one customer org with a member, and one paid order so the dashboard isn't empty. Idempotent.

## Acceptance criteria
- [ ] An ERD (Mermaid in `src/lib/db/ERD.md`) covers every collection above and marks embed vs reference.
- [ ] Every collection has a Mongoose schema, a matching Zod validator, and a repository.
- [ ] `STATES.md` and `INTEGRITY.md` (ticket 01) are complete for all MVP collections.
- [ ] `db:seed` runs twice with no duplicates and no errors.
- [ ] `explain()` on the marketplace filter query and the staff-queue query shows an index scan, not `COLLSCAN`.
- [ ] Money is `Int32`/`Int64` in every document — verify with a `$type` aggregation over seeded data.
- [ ] No collection embeds an array that can grow without bound in normal use (audit: messages, activity, downloads).
