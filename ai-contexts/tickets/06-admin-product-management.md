# 06 — Admin Product Management

**Bucket:** §4.1–4.6, 4.10 · **Depends on:** 02, 04, 05 · **Blocks:** 07, 08, 09 · **Size:** L
**Spec:** §41–43 (creation & configuration), §46 (lifecycle), §49 (add-ons), §50 (customization config), §7 (taxonomy)

## Why
§41 is explicit that marketplace management is "far more than basic product CRUD" — an administrator builds a
complete distributable software package. Everything the marketplace, the AI assistant and the entitlement engine
later rely on is entered here.

## Scope

### Taxonomy admin (`/admin/taxonomies`)
CRUD for categories, industries, technologies and product types (§7). Slug, name, description, icon, sort order,
active flag. Deleting a taxonomy in use is blocked (integrity rule from ticket 01).

### Product wizard (`/admin/products/new`, `/admin/products/[id]/edit`)
Follow the §42 sequence, each step saving to a **draft** so work is never lost:
1. **Basic information** — name, slug (auto, editable, uniqueness-checked), summary, full description (rich text).
2. **Category / industry / technology** — multi-select from taxonomies.
3. **Features** — ordered list, each with title + optional detail.
4. **Technology & requirements** — stack, PHP/Node/DB versions, optional services (§48).
5. **Media** — screenshots (ordered, alt text, primary flag), video URL. Uploads via ticket 05.
6. **Pricing** — see below.
7. **Licensing** — licence type (§65), activation limit, support duration, update duration.
8. **Product files & versions** — handed to ticket 07.
9. **Demo & test credentials** — handed to ticket 07.
10. **Installation options** — self-install / Innovatrix installation / managed hosting (§48).
11. **Customization options** (§50) — available yes/no, AI workflow enabled, technical review required,
    starting price, typical turnaround, and **suggested customization areas** (branding, roles, reports,
    payments, workflows, integrations, notifications, dashboard). These feed the ticket-17 AI assistant, so
    they are structured data, not free prose.
12. **SEO** — meta title, description, OG image, canonical.
13. **Review & publish**.

### Pricing model (multi-currency, no FX guessing)
- A product carries `prices: [{ currency, amount, compareAtAmount? }]` — **explicitly set per currency**.
  Never compute NGN from GBP with a live FX rate; the business sets each price deliberately.
- `licencePackages: [{ key, name, description, prices[], activationLimit, supportMonths, updateMonths }]`.
- `addons: [{ key, name, description, pricingType: fixed|starting_from|quote_required, prices[] }]` (§49).
- Validation: a product cannot be published without at least one price in each currency the storefront offers,
  or it must be explicitly marked unavailable in that currency.

### Publishing lifecycle (§46)
`draft → internal_review → testing → ready → published → deprecated → archived`, with `published → deprecated`
and `deprecated → archived` the only forward paths after launch. Transitions are permission-gated
(`product.publish`) and validated server-side against the ticket-02 map. Publishing requires: at least one
version with a package file, at least one price, at least one screenshot, and a completed testing checklist
(ticket 07). Every transition writes an audit entry (§90).

### Product list (`/admin/products`)
Filter by status, category, visibility, featured. Bulk publish/unpublish. Shows the completeness gaps blocking
publish for each draft.

## Acceptance criteria
- [x] A product can be created, saved as draft at any step, and resumed later without data loss.
- [x] Slug collisions are caught before save with a helpful suggestion.
- [x] Publishing is refused — with a specific reason — when a package file, price or screenshot is missing.
- [x] Money entered as `299.99` is stored as `29999` with the right currency; re-editing shows `299.99`.
- [x] A `content_manager` can edit copy but cannot publish; a `marketplace_manager` can.
- [x] Suggested customization areas are stored structured and are readable by the ticket-17 assistant.
- [x] Every lifecycle transition appears in the audit log with actor and timestamp.
- [~] An unpublished product is not reachable on any public route, by slug or by id — **vacuous today**:
  no public product route exists until ticket 09. The read path is written to make it true
  (`findBySlug` filters on `status: "published"`), and ticket 09 must assert it directly.

---

## Implementation notes

**Done:** taxonomy admin, a ten-step product wizard, the admin list with readiness gaps and bulk
transitions, the §46 lifecycle, and Cache Components turned on across the app.

### Deviations from the scope above

1. **Thirteen steps became ten.** Licensing (7) is inseparable from pricing (6) — a licence
   package *is* a priced thing — and technology/requirements (4) and features (3) are one page of
   copy. Steps 8 and 9 are ticket 07's and are present as placeholders.
2. **Per-currency publish validation deferred to ticket 08.** The criterion at line 41 needs the
   currency switcher to be meaningful; ticket 06 requires ≥1 price in any currency.
3. **Media takes a URL, not an upload.** Ticket 05's bucket blockers (CORS unset, `DeleteObject`
   denied) mean a browser upload fails preflight and a screenshot could never be removed.
   `media[].storageKey` already exists beside `url`, so the dropzone drops in unchanged.
4. **`/admin/products/[id]/basics` etc., not `[id]/edit`.** Under `typedRoutes` a `[section]`
   param degrades `Route` to a template literal and every typo compiles; named folders keep the
   check *and* let each readiness gap link to the step that fixes it.

### Rules that are structural rather than remembered

- **`readiness.ts` is pure and has one caller-facing shape**, read by both the publish gate and
  the list column, so the two cannot disagree about what is missing.
- **`assertTransition` runs before readiness.** `draft → published` reports an illegal transition,
  not "add a screenshot" — otherwise an administrator fixes the screenshot and is refused again.
- **A guarded `findOneAndUpdate({ _id, status: from })`** means two simultaneous publishes produce
  one success, one clean conflict, and **one** audit row.
- **The audit log records changed field *names*, never values** — a pricing save would otherwise
  put every price in the log, and ticket 07's demo save would put ciphertext there.
- **`AuditLogRepository.updateById`/`deleteById` throw**, so §90's append-only rule is a
  compile-and-run guarantee rather than a convention.

### Three bugs found by writing the tests, not by review

1. **`description` was a `String` in the schema while ticket 06 wrote a ProseMirror tree into it.**
   Every rich-text save would have hit a Mongoose `CastError`. The live probe missed it because it
   only ever saved name and summary. Fixed by giving the tree its own `Mixed` path and adding
   `descriptionText` beside it — because the §74 text index cannot score an object, so rich text
   would otherwise have *silently* stopped body copy being searchable. `descriptionFields()` is the
   only writer of the pair. **`npm run db:indexes` is required** — `product_text` changed keys.
2. **`$set` drops `undefined`, so clearing any optional field did nothing.** Deleting a
   description or an SEO override saved successfully, showed an empty form, and left the old value
   on the live page. `setAndUnset()` turns `undefined` into `$unset`.
3. **`isEmptyDocument` threw on a non-document.** `description` is a `Mixed` path, so a legacy
   string reaches it — and it runs on the publish path, so the throw would have taken out
   publishing rather than degrading.

### Verified live, by invoking the actions rather than driving the UI

`299.99 → 29999` and `1,299.99 → 129999`, both integers, blank currencies omitted, re-edit
rendering `value="299.99"`; `draft → published` giving a transition error; `testing → ready`
blocked by the §47 checklist; `ready → published` naming all three gaps keyed by gap code; slug
collision suggesting `atlas-crm-cck3` and `slugHistory` retaining the old address; taxonomy delete
refused with the real count and a rename re-deriving facets with zero stale entries; and
`content_manager` editing copy but refused both `product.publish` and `product.manage_pricing`.

16 integration tests against a single-node replica set cover the same ground where it depends on
the database enforcing something — concurrency, uniqueness, `$unset`, and the text index.
