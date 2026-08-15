# 08 — Marketplace Browse & Search

**Bucket:** §5.1–5.6 · **Depends on:** 06 · **Blocks:** 09 · **Size:** L
**Spec:** §6 (marketplace capabilities), §7 (categories), §74 (search), §93 (SEO), §94 (performance)

## Why
This is the front door for the "I found software I want" customer (§107) and the primary SEO surface. §94 is
explicit: do not load thousands of products into the browser to filter them.

## Scope

### `/marketplace`
- Server-rendered product grid: card with primary screenshot, name, summary, price (viewer's currency),
  category, technology chips, customization-available badge.
- Sorting: relevance (when searching), latest, popular (order count), price asc/desc.
- Pagination — cursor or page-based, server-side, **always bounded**.
- All filter/sort/page state lives in `searchParams` so results are linkable and crawlable.

### Filters (§6)
Category · industry · technology · product type · price range (in the active currency) ·
customization available · installation available. Facet counts computed with a single aggregation pipeline
(`$facet`) rather than one query per filter.

### Search (§74)
- MVP: MongoDB text index over name, summary, description, features — or **Atlas Search** if available
  (better relevance, fuzzy matching, and it is the growth path to §74's semantic search).
- Debounced input, results server-rendered. Empty-state suggests popular categories.
- Log searches with zero results — that list is a product-roadmap input.
- **Do not build vector/semantic search in the MVP.** Leave the index definition so it can be added without a
  data migration.

### Discovery surfaces
- Category pages `/marketplace/category/[slug]`, industry pages `/marketplace/industry/[slug]` — real pages with
  their own metadata and copy, not filter shortcuts (SEO, §93).
- Home rails: Featured · Latest · Popular · Recommended (MVP heuristic: same category as recently viewed).
- **Recently viewed** — last 8 product ids in a cookie, rendered as a rail. No account required.
- **Favourites / Save for Later** — persisted per user; a `/dashboard/saved` list.

### Performance (§94)
- Cache the taxonomy and the facet skeleton aggressively; keep per-request work to the filtered query.
- Decide the caching strategy explicitly (ticket 27 finalises it): if Cache Components is enabled, wrap
  catalog reads in `use cache` with a `cacheLife` and a `cacheTag('products')` invalidated on publish; if not,
  use the previous-model revalidation APIs. **Pick one and apply it consistently.**
- `next/image` for all media with correct `sizes`.
- Query only the projection the card needs — never the full product document for a grid.

## Out of scope
Product comparison and ratings/reviews (§6) — post-MVP.

## Acceptance criteria
- [ ] Filtering by two categories and a technology returns correct results and correct facet counts in one round trip.
- [ ] `explain()` on the filtered query shows an index scan; response stays under 300ms on 1,000 seeded products.
- [ ] Copying the URL after filtering reproduces the exact result set for another user.
- [ ] Only `published` products appear anywhere public.
- [ ] Prices render in the viewer's selected currency; a product without a price in that currency is handled
      explicitly (hidden or marked "price on request"), never rendered as `£0.00` or `NaN`.
- [ ] Category and industry pages have unique titles, descriptions and canonical URLs.
- [ ] Recently-viewed survives a page refresh and does not require login.
- [ ] Search with no results shows guidance, not an empty grid.
