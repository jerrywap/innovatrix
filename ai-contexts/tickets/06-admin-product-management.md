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
- [ ] A product can be created, saved as draft at any step, and resumed later without data loss.
- [ ] Slug collisions are caught before save with a helpful suggestion.
- [ ] Publishing is refused — with a specific reason — when a package file, price or screenshot is missing.
- [ ] Money entered as `299.99` is stored as `29999` with the right currency; re-editing shows `299.99`.
- [ ] A `content_manager` can edit copy but cannot publish; a `marketplace_manager` can.
- [ ] Suggested customization areas are stored structured and are readable by the ticket-17 assistant.
- [ ] Every lifecycle transition appears in the audit log with actor and timestamp.
- [ ] An unpublished product is not reachable on any public route, by slug or by id.
