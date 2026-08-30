# Taxonomy depth and SEO routing — plan

> Filename kept as requested (`new-taxonom-plan.md`); rename to
> `new-taxonomy-plan.md` if you would rather.

Companion to `improved-taxonomy-suggestions.md`, which defines *what* the terms
are. This defines *how the site is shaped around them*.

**Not implemented. This is the plan for review.**

---

## Context

Today the catalogue is flat in every sense. `/marketplace` and `/templates` are
one page each, browsing happens through a filter rail that writes query strings,
and the only crawlable landing pages are `/marketplace/category/{slug}` and
`/marketplace/industry/{slug}` — with no template equivalent for industry.

The query people actually type is *"Logistics website template"*, and there is
no page on this site that answers it. Meanwhile `/marketplace?category=crm` and
`/marketplace/category/crm` are **both indexable and return the same rows**,
competing with each other, and the rail mints the query form on every click.

The aim is a URL for each way somebody shops, without making the vendor's job
harder or rebuilding the filters that already work.

---

## The URL scheme

| | Now | After |
|---|---|---|
| Product detail | `/marketplace/gracia-daily` | **`/details/gracia-daily`** |
| Catalogue | `/marketplace` | `/marketplace` *(+ category navbar)* |
| Parent category | `/marketplace/category/crm` | **`/marketplace/business-operations`** |
| Child category | — | **`/marketplace/business-operations/crm`** |
| Industry (scripts) | `/marketplace/industry/logistics` | unchanged |
| Industry (templates) | — | **`/templates/industry/logistics`** |
| Template categories | `/templates/category/{slug}` | **`/templates/{parent}[/{child}]`** |

Moving the product to `/details/` is what makes the rest possible: a product and
a category cannot both live at `/marketplace/[slug]`, because Next allows only
one dynamic segment per level. It also **removes an existing wart** — `proxy.ts`
currently carries

```
/^\/marketplace\/(?!category\/|industry\/)([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/
```

a negative lookahead that would have to grow a clause for every new static
segment. Under `/details/{slug}` the pattern has no exclusions at all.

### Reserved segments

`category` and `industry` are static segments under `/marketplace`, and Next
resolves a static segment before a dynamic one — so `/marketplace/industry/…`
keeps working alongside `/marketplace/[parent]`. The cost is that **no category
may ever be slugged `category`, `industry`, or `page`**. Worth a guard in
`TaxonomyService` rather than a comment.

---

## Model changes

Two, both small, both currently missing.

**1. `parentId` on `Taxonomy`.** Nullable, self-referencing, category-kind only.
A parent has `parentId: null`; a child points at its parent. `schema-paths.test.ts`
should gain a line for it if any query filters on it.

**2. `primaryCategoryId` on `Product`.** `categoryIds[]` has no ordering
semantics, so nothing can answer "which category does this product *belong* to" —
which the breadcrumb, the canonical and the JSON-LD all need. Today **1,009 of
1,010 products carry exactly one category**, so the migration is: copy
`categoryIds[0]` into `primaryCategoryId` and move on.

Everything else — `catalogue` scoping, `deriveFacets`, the `cat:` facet strings,
the taxonomy cache tag — already works and is untouched.

---

## Routes

**New**
- `src/app/details/[slug]/page.tsx` — the product page, moved verbatim
- `src/app/(public)/marketplace/[parent]/page.tsx`
- `src/app/(public)/marketplace/[parent]/[child]/page.tsx`
- `src/app/(public)/templates/[parent]/page.tsx`
- `src/app/(public)/templates/[parent]/[child]/page.tsx`
- `src/app/(public)/templates/industry/[slug]/page.tsx` — mirrors the marketplace one

**Redirects, permanent (308)**
- `/marketplace/{product-slug}` → `/details/{product-slug}`
- `/marketplace/category/{slug}` → `/marketplace/{parent}[/{child}]`
- `/templates/category/{slug}` → `/templates/{parent}[/{child}]`

These are not optional. Every existing inbound link, every indexed URL and the
`slugHistory` chain runs through them, and a 404 there throws away whatever
ranking the catalogue has.

### Where the product redirect lives

It cannot be `next.config.ts` — that would need the product slugs at build time.
It goes in **`/marketplace/[parent]/page.tsx`**, which already has to disambiguate:

```
look up the segment
  ├─ a category?          render the listing
  ├─ a product slug?      308 → /details/{slug}
  ├─ in slugHistory?      308 → /details/{current-slug}
  └─ otherwise            notFound()
```

That is the same shape the product page uses today for renamed products, and the
guard must sit **in the page component's own body** — `loading-boundaries.test.ts`
asserts it, and no `loading.tsx` may be added at or above the segment.

---

## The 21 hardcoded product URLs

`CATALOGUE_SURFACE.productPath` exists to centralise this and **most callers
bypass it**. A product URL is built by hand in 21 places, including
`sitemap.ts`, `json-ld.tsx`, `notifications/catalog.ts`, the cart, the preview
page and four dashboard screens.

**Do this first, as its own change with no behaviour attached:** one
`productHref(slug)` helper, all 21 call sites routed through it, everything still
pointing at `/marketplace`. Then moving the product is a one-line edit and a
grep that comes back empty. Doing it in the other order means finding the misses
in production, one broken email link at a time.

---

## SEO

**Canonicals.** Each landing page canonicalises to itself. `?category=` and
`?industry=` on the listing canonicalise to the corresponding landing page — that
is the live duplicate-content bug, and it is fixed by the scheme rather than
alongside it. Filter combinations that have no landing page keep the listing's
own canonical.

**`robots.ts`.** Add the faceted forms to the disallow list beside the existing
`?q=` entries. The bare paths stay crawlable — a blanket disallow would stop the
crawler reading the canonical, which is the mistake the `/search` entry already
documents.

**`sitemap.ts`.** Parents and children replace the flat category list; add
template industries. `sitemap.test.ts` asserts every static path resolves, and
its `ROUTE_GROUPS` is `["", "(public)", "(auth)"]` — `/details` sits at the top
level, which the `""` entry already covers.

**Internal linking.** The category navbar on `/marketplace` and `/templates` is
what makes the landing pages discoverable rather than orphaned in a sitemap. It
carries **parents only** — 18 and 12 — which is exactly why the revised taxonomy
promotes groups to parents. Each parent page then links its children, and each
child page links back. That is the backlink graph, and it costs one component.

**Thin pages are the risk, not the reward.** A landing page that is the listing
grid with a different `<h1>` is treated as a duplicate of the listing. Each needs
something of its own:

- an intro paragraph per parent (editorial, one-off, ~30 of them)
- the child terms as links, with counts
- the top products named in the copy

**And an inventory floor.** A category with two products should be a filter, not
a URL. Generate the page — and the sitemap entry, and the navbar link — only
above a threshold, exactly as `CatalogueSummary` and the `/search` landing
already refuse to print a number below 25. Empty categories are the failure mode
that took down the demo-URL idea earlier, and it applies here at 30× the scale.

**Pair pages come later, or not at all.** `/templates/industry/logistics` plus
the filter rail already serves "logistics website template". A
`{industry}×{category}` matrix is 43 × 18 = 774 URLs, almost all empty. If it is
ever worth doing, it is worth doing only for combinations with real inventory,
and after the single-axis pages have earned their traffic.

---

## What does not change

**The filter rail.** It keeps working exactly as now, on every page. On a
category page the parent is *locked* — `results-section.tsx` already supports
`forced` and `locked` for precisely this, and the industry landing pages already
use it.

**The vendor's job.** They pick categories the same way, from the same searchable
`MultiSelect`. They choose a **child**, and the parent is inferred — no vendor
ever picks a parent explicitly, and no vendor sees the URL scheme. The one
addition is marking which category is primary, and with one category selected
that can be automatic.

**Everything the rail scopes.** `getTaxonomyIndex(scope)`, the `catalogue`
filter, the `cat:` facets and the cache tags all carry over untouched.

---

## Phasing

Each phase is shippable and leaves the site working.

**1 — Centralise the product URL.** One helper, 21 call sites, no behaviour
change. Prerequisite for everything else.

**2 — Move the product to `/details/{slug}`.** Route moves, helper flips,
`PRODUCT_PATH` in `proxy.ts` simplifies. `/marketplace/[slug]` becomes the
disambiguating route that 308s. Ship and watch the redirects.

**3 — Model.** `parentId`, `primaryCategoryId`, backfill from `categoryIds[0]`.
No UI yet.

**4 — Data.** Load the revised taxonomy. Existing categories map onto the new
tree as children; nothing is deleted, because a deleted category is a dead URL.

**5 — Category routes and navbar.** `/marketplace/[parent]`, `[parent]/[child]`,
the template equivalents, `/templates/industry/{slug}`, the navbar, the sitemap.

**6 — Canonicals and robots.** Point the faceted forms at the landing pages.

**7 — Editorial.** Intro copy per parent. This is the phase that decides whether
any of it ranks, and it is the one with no code in it.

---

## Risks

**Redirect coverage is the whole game.** Every currently indexed
`/marketplace/{slug}` must 308. Enumerate them from the sitemap before and after
and diff — this is checkable, so check it rather than trusting it.

**Ambiguity between a product slug and a category slug.** They live in separate
collections with separate unique indexes; there are **zero collisions today, by
luck rather than design**. After the move the two namespaces no longer share a
path, so the risk disappears — but only once phase 2 lands. Until then, a vendor
slugging a product `crm` would shadow a category.

**`generateStaticParams` spans more routes.** The product page prerenders 100
slugs today; parents and children add their own. Keep the counts bounded and
watch the build time.

**Technologies are blocked on a UI change.** 68 terms cannot go into the
wizard's unsearchable checkbox grid. That swap is a prerequisite for section 4
of the taxonomy, and it is independent of everything above — it could ship any
time.
