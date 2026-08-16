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
- [x] Filtering by two categories and a technology returns correct results and correct facet counts in one round trip.
- [x] `explain()` on the filtered query shows an index scan; response stays under 300ms on 1,000 seeded products.
- [x] Copying the URL after filtering reproduces the exact result set for another user.
- [x] Only `published` products appear anywhere public.
- [x] Prices render in the viewer's selected currency; a product without a price in that currency is handled
      explicitly (hidden or marked "price on request"), never rendered as `£0.00` or `NaN`.
- [x] Category and industry pages have unique titles, descriptions and canonical URLs.
- [~] Recently-viewed survives a page refresh and does not require login — the **read** is built and the rail
      renders; the cookie is *written* by the product page, which is ticket 09. Verified there.
- [x] Search with no results shows guidance, not an empty grid.

---

## Implementation notes

### Verified live against 1,004 seeded products

```
crm                       314
property                  104
crm OR property           418   ← 314 + 104: OR within a dimension
  AND laravel             183   ← fewer: AND across dimensions
```

A `$all` filter — the obvious shape — returns **0** for two categories, with no
error, because it asks for products filed under both. That single line is why
`facetMatch()` exists next to `facetFilter()`.

`npm run db:explain` runs fourteen filter shapes and asserts each one on both
counts:

```
one category (the fat head)    14ms  [status_1_facets_1]
two categories + a technology  18ms  [status_1_facets_1]
free text                      15ms  [product_text]
✓ every case indexed and under 300ms
```

Currency renders per-currency hand-set prices, never FX: the same page is
£4,997.55 / $6,346.89 / ₦10,494,855.00. Sorting by price ascending puts zero
"Price on request" cards on page 1 and the whole tail on the last page —
`hasPrice: -1` leads **both** price sorts, because with `-1` on a missing field
they would otherwise lead the descending one too.

### The single most important structural decision

**One `$facet`**, not four queries:

```
$match      status + facets + $text + customisable   ← indexed
$addFields  the price in the active currency, hasPrice, textScore
$match      price range, only when one is set
$facet      rows │ facetCounts │ total
```

The price filter is a *second* `$match` on purpose: the price lives in a
per-currency array, so filtering on it in stage one would need `$elemMatch`
against a field no index covers and would destroy the bounds
`status_1_facets_1` provides.

And **no `$lookup`.** Category and technology names come from the cached
taxonomy mapped against the denormalised `facets` array. Joining them per
request is the obvious improvement that is a large regression — avoiding it was
the entire point of denormalising facets.

### Facet counts are honest or absent

Counts come from the already-filtered set, because true drill-down counts would
mean lifting each dimension's filter out of stage one. That makes them right for
a dimension with nothing selected and **wrong** for one already filtering —
within a dimension terms are OR'd, so ticking a second category *widens* the
set. So: counts where nothing is selected, none where something is, and every
term always rendered from the taxonomy so the rail never becomes a dead end.

### What is cached, and the one thing that is not

Filter/sort/page combinations are cached — they come from a **closed
vocabulary**. Free text is **not**: `q` is attacker-controlled, so caching on it
makes the key space unbounded and a few thousand random queries evict everything
that matters.

### Cache Components: the shell now actually prerenders

`/marketplace` was built with a suspended body and still came out `ƒ` in the
build output. The cause was one line in `(public)/layout.tsx` — `await
getSession()` in a **layout** makes every page beneath it dynamic, however
carefully the page is written.

Splitting `PublicHeader` so only `HeaderAccount` touches the session, and
suspending that, flipped `/`, `/marketplace`, `/custom-software` and every
category and industry page to `◐`. The account slot still renders server-side,
so the no-flash-of-wrong-header guarantee survives.

`sitemap.ts` hit the same wall from the other direction: `export const
revalidate` is **rejected** by Cache Components. `use cache` + `cacheTag` is the
replacement, and it is better — publishing a product refreshes the sitemap
instead of waiting out an hour.

### Bugs the tests and the lint caught

1. **`marketplaceHref` had dead branching** around the page reset — an
   unconditional `delete` after a conditional one. Rewritten so page is derived,
   never carried.
2. **`SearchBox` synced the URL into state with a `useEffect` + `setState`** — a
   cascading render that React's `set-state-in-effect` rule flags. Replaced with a
   `key` on an uncontrolled field, which removes the effect entirely.
3. **`explain-marketplace.ts` was reading the wrong node of the plan tree** —
   walking `queryPlanner` rather than `winningPlan`, so it reported every index
   MongoDB *considered* (and would have flagged a rejected COLLSCAN), while the
   two `$text` cases silently reported nothing at all and passed. It now fails
   loudly when a plan cannot be read, which is the whole point of the script.

### Deviations, stated

1. **Technology and product-type have no landing pages.** Eight thin pages with
   no unique copy is negative SEO, not more of it. They remain filters.
2. **`robotsFor()` refuses to index three-dimension filter combinations, search
   results and price slices.** Page 2+ self-canonicalises rather than pointing
   at page 1 — canonicalising page 5 to page 1 tells the crawler page 5's
   products do not exist.
3. **Zero-result searches are logged without a user id.** A search term is a
   statement of circumstance; counting them is a roadmap input, attributing them
   is a profile.
4. **`SavedProduct` is keyed on the user, not the organisation** — a bookmark is
   personal, and org-scoping would make saved lists vanish on an org switch.
