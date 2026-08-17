# 04 — Product Ownership & Vendor Authoring

**Bucket:** §20.4 · **Depends on:** vendor 01, 03; ticket 06 · **Blocks:** vendor 05, 06, 10, 11 · **Size:** L
**Spec:** §41–43 (product creation & configuration — the vendor-authored equivalent), §46 (publishing lifecycle), §7 (taxonomy), §74 (search & discovery), §88 (tenant isolation), §94 (performance)

## Why
`Product` has no owner. Not a `vendorId`, not an `authorId`, not an
`organizationId` — it is platform data, and the only person-shaped fields on it
are two audit breadcrumbs, both optional and unindexed. Ownership is therefore a
**new axis** cutting through the catalogue, the marketplace query, storage
authorisation and the admin UI, and it is the single largest structural change
the vendor system asks for.

## Read first
`src/services/marketplace/pipeline.ts` and `buildProductFacets()` in the catalog
service. The flattened `facets: string[]` array is the only thing that makes
faceted filtering indexable — MongoDB cannot compound-index parallel arrays —
and a vendor filter has to live inside that constraint rather than beside it.

## Scope

### Ownership on `Product`

```ts
vendorId?: Types.ObjectId;   // absent ⇒ first-party, published by Innovatrix
```

Optional, because the four seeded products and everything the platform sells
itself have no vendor and must keep working untouched. Absent means first-party;
that is the only meaning it carries.

A new `{ vendorId: 1, status: 1, updatedAt: -1 }` index. The existing set is
`{status, facets}`, `{status, isFeatured, publishedAt}`, `{status, orderCount}`
and `{status, updatedAt}` — none has room for a vendor prefix, so this is a new
index rather than an extension.

`ProductVersion` and `ProductFile` derive ownership through `productId` and gain
no field of their own. That is already how storage authorisation works —
`assertKeyBelongsTo(key, root, { productId, versionId })` binds an object to its
product — so vendor isolation on storage falls out of product ownership rather
than needing a second axis.

### The vendor product workspace (`/dashboard/selling/products`)

Ticket 06's ten-step wizard, scoped to one vendor. The steps are the same
because the product model is the same; what differs is what a vendor may reach:

| Step | Vendor | Note |
|---|---|---|
| Basics, classification, content, media | yes | |
| Pricing | yes | Decision **V9** — the vendor sets it, the review gate covers it |
| Options (licence packages, add-ons) | partly | Licence *terms* are the platform's defaults (**V10**); the vendor chooses which packages to offer |
| Demo | yes | Credentials are sealed with the same AES-256-GCM path as any other product |
| Versions, testing | yes | |
| SEO | yes | |
| Review | read-only | Submission is vendor ticket 05 |

Publishing is **not** on this list. A vendor moves a product to `submitted`; a
staff reviewer publishes it. Vendor ticket 05 owns that edge.

### Isolation is the whole security story here

Every read and every write in the vendor workspace resolves the product **and**
checks its `vendorId` against the session's vendor, in the service and not in
the page. A product id is guessable and a vendor product id is a URL somebody
will try.

Uniformly: a product belonging to another vendor answers **404**, never 403.
Distinguishing the two turns the workspace into an oracle for which product ids
are real, and the platform already takes that position on downloads and on AI
conversations.

The tenant-isolation suite gains a vendor section beside the organization cases.
It is the same shape — create as A, ask as B, expect nothing — and the
`orgFilter()` lesson applies: an empty-string vendor scope must throw, not widen
to every vendor.

### The vendor facet, and the trap in it

A `vend:` prefix in `FACET_PREFIX`, pushed into `buildProductFacets()`, gives
filtering, facet counts, URL parsing and chip rendering for free. It fits the
flattened-array design rather than fighting it.

**The trap:** facets are *derived and rewritten* on every classification save.
A vendor term added anywhere except `deriveFacets()` is silently wiped the next
time somebody edits a product's categories — and nothing fails, the product just
quietly stops appearing under its vendor. It goes in the derivation, and every
existing product needs a backfill.

`CARD_PROJECTION` gains the vendor's name and slug so a card can say who made it
without a second query per row.

### Admin sees ownership everywhere

`/admin/products` gains a vendor column and a filter, and a product detail shows
its owner. Staff keep every permission they have; ownership constrains vendors,
not the platform.

### Attribution on the public page

A product card and a product page name their vendor and link to the storefront.
Vendor ticket 11 builds the storefront and makes the JSON-LD `seller` dynamic —
it currently hard-codes Innovatrix as the seller of every product, which becomes
a false statement the moment a vendor product is published.

## Out of scope
Submission and review (vendor ticket 05). Delivery methods beyond the existing
upload (vendor ticket 06). Per-product team access (vendor ticket 03).

## Acceptance criteria
- [ ] A product with no `vendorId` behaves exactly as before, everywhere, including the four seeded products.
- [ ] A vendor sees only their own products in the workspace, and a product id belonging to another vendor answers 404 rather than 403.
- [ ] Every vendor product write re-checks ownership in the service; removing the page-level check alone does not open anything.
- [ ] An empty-string vendor scope throws rather than matching every vendor.
- [ ] The tenant-isolation suite covers vendor A against vendor B for products, versions and files.
- [ ] A vendor cannot attach a storage key belonging to another vendor's product, refused by `assertKeyBelongsTo` rather than by prefix alone.
- [ ] A vendor cannot publish; the transition is absent from their surface and refused by the action.
- [ ] The `vend:` facet is produced by `deriveFacets()`, and editing a product's classification does not remove it.
- [ ] Existing products are backfilled, and the facet counts on `/marketplace` are unchanged by the migration.
- [ ] Filtering the marketplace by vendor returns that vendor's published products and nothing else.
- [ ] A product card names its vendor without an extra query per card.
- [ ] `/admin/products` can be filtered by vendor, and staff permissions are unchanged by ownership.
