# 11 — Vendor Storefront

**Bucket:** §20.11 · **Depends on:** vendor 04, 10; tickets 08, 27 · **Blocks:** — · **Size:** M
**Spec:** §6 (marketplace experience), §8 (product detail), §74 (search & discovery), §93 (SEO — metadata, canonical, structured data), §94 (performance — caching), §100 (progressive complexity)

## Why
`json-ld.tsx` asserts `seller: { "@type": "Organization", name: "Innovatrix" }`
on every product page. The moment a vendor product is published that is a false
statement in machine-readable structured data, which is the one place a false
statement is read literally. Beyond correcting it, a customer choosing between
two third-party products needs somewhere to ask "who made this, and what else
have they made" — and a marketplace with no answer is a catalogue.

## Scope

### `/vendors/[slug]`

Public, indexable, and cached like the rest of the catalogue. It carries:

- display name, logo, summary, website, country
- the verification badge, worded as identity verification and nothing more
  (vendor ticket 02)
- the vendor's rating and review count (vendor ticket 10), or nothing at all
  where there are none — an empty five-star frame reads as zero
- their published products, using the existing marketplace card
- how long they have been selling, and how many products they have published

> **Implemented 2026-08-17 — the grid is `searchMarketplace({ vendor: [slug] })`.**
> The first version of `storefront.ts` built the grid with its own `find()` and a
> hand-copied projection, and it was wrong in a way nothing would have caught: a
> card's price is **computed** by the marketplace pipeline (`activePrice` and
> `hasPrice`, in an `$addFields`) and is not a stored field, so every product on
> the storefront would have rendered as "Price on request". Going through the
> existing pipeline — which already supports the `vend:` facet from ticket 04 —
> means one card shape by construction, and eligibility ("at least one published
> product") is that search's `total` rather than a second count query.
>
> So this module is the *vendor*, not the grid: `getVendorProfile` is cached and
> tagged, and the page composes the two.

**Not** their sales volume, revenue, or payout status. That is the vendor's
commercial information and the customer has no claim on it.

An unverified, suspended or offboarded vendor has no page. A vendor with no
published products has no page either — an empty storefront in the index is a
thin page that costs the whole site a little ranking.

### Attribution on the product page

> **Implemented 2026-08-17 — the card became an `<article>` with an overlay link.**
> The whole tile was a `<Link>`, and adding a second link inside it is invalid
> HTML that browsers resolve by dropping one of them. The product link is now
> absolutely positioned over the card at `z-0` with an `sr-only` name, and the
> vendor link sits above it — the standard accessible pattern, one tab stop per
> destination, and no `"use client"` needed for a `stopPropagation` that would
> otherwise have been the quick fix.

"By {vendor}" beside the product name, linking to the storefront, on the detail
page and on the card. First-party products say nothing, because "by Innovatrix"
on a platform called Innovatrix is noise.

### The JSON-LD correction

`seller` becomes the product's actual seller — the vendor's `Organization` for a
vendor product, the platform's for a first-party one. The site-wide
`Organization` and `WebSite` nodes in the public layout stay as they are: they
describe the site, not the seller of any given item.

The storefront page itself emits an `Organization` with the vendor's identity and
a `BreadcrumbList` matching its visible breadcrumb — derived from the same array,
because the two disagreeing is a policy violation rather than an untidiness.

### Discovery

> **Implemented 2026-08-17 — the chip appears only when a vendor filter is active.**
> There is no "all sellers" section in the rail, and that is a decision rather
> than an omission: a marketplace with three hundred vendors would have a rail
> nobody can scan and a query on every render. Discovery runs the other way —
> follow a vendor from a card or a storefront — and the chip is the way *back
> out* of a filtered view, which is what a filtered listing with no visible
> filter fails to give you. `vendorNames()` resolves the slugs actually in the URL,
> because a vendor is not a taxonomy and `TaxonomyIndex` has no name for one.

The `vend:` facet from vendor ticket 04 becomes a filter chip on `/marketplace`,
and a vendor name is searchable. Both come almost free from the existing
flattened-facet design; what does not is `CARD_PROJECTION`, which needs the
vendor's name and slug so a card can attribute itself without a query per row.

### Metadata and caching

`pageMetadata()` from ticket 27 gives the storefront its canonical, Open Graph
and Twitter card. The page is a `use cache` read tagged so that publishing,
unpublishing or renaming refreshes it rather than waiting out a window — the
same treatment the catalogue already gets.

`sitemap.ts` gains vendor storefronts. Only vendors with at least one published
product, for the same reason they have no page otherwise — and `sitemap.test.ts`
already asserts every static path resolves, so the dynamic half must not
reintroduce what that test was written to catch.

`robots.ts` is unchanged, and the nesting decision in vendor ticket 01 is why:
the storefront at `/vendors/[slug]` is public and indexable, while the vendor's
own workspace lives under `/dashboard/selling` and is therefore already inside
the existing authenticated-area disallow. A top-level `/vendor` would have needed
a new rule; this needs none.

The two paths differ by one character in the singular, which is a real hazard for
whoever writes the next link. The storefront is **plural** — `/vendors/[slug]`,
one page per vendor — and the workspace is not a sibling of it.

### Progressive complexity

§100 applies. A storefront describes the maker in the language a buyer uses —
what they build, for whom, since when. Not their stack, not their submission
history, not their internal verification level.

## Out of scope
Vendor-run promotions, follow/subscribe, and vendor-authored long-form content.
Each is a content surface with its own moderation problem and none is asked for.

## Acceptance criteria
- [x] A vendor product's JSON-LD names the vendor as `seller`; a first-party product names the platform.
- [x] The site-wide `Organization` and `WebSite` nodes are unchanged and still emitted once per page.
- [x] A storefront exists only for a verified vendor with at least one published product.
- [x] A suspended or offboarded vendor's storefront returns 404, and their published products are handled per vendor ticket 12.
- [x] The storefront shows no sales, revenue or payout information.
- [x] A rating appears only where reviews exist; a vendor with none shows no rating rather than zero stars.
- [x] Product cards and detail pages attribute their vendor and link to the storefront; first-party products show no attribution.
- [x] A card attributes its vendor without an additional query per card.
- [x] Filtering the marketplace by vendor works from a chip and from the URL, and the filtered view is linkable.
- [x] The storefront has a canonical URL, Open Graph and a Twitter card.
- [x] Publishing or unpublishing a product refreshes the storefront within the documented cache window.
- [x] `sitemap.xml` lists storefronts with published products only, and every URL in it resolves.
- [x] The storefront's `BreadcrumbList` matches the visible breadcrumb exactly.
- [x] A vendor can see their own storefront before it is public, and is told why it is not.

## Implementation notes — 2026-08-17

**The `seller` correction is the point of the ticket.** `json-ld.tsx` asserted
`name: "Innovatrix"` unconditionally, which became a false statement in machine-readable
structured data the moment a vendor product was published — and structured data is the one place
a false statement is read literally. A vendor product now names the vendor and links to their
storefront, whose own `Organization` node carries the same identity; a first-party product still
names the platform, because it still is the seller.

**A storefront's absence is indistinguishable from a vendor's non-existence.** Three states
return `null` — no such vendor, not `verified`, deleted — plus a fourth (nothing published) from
the listing total. There is no "this vendor is suspended" page, because that would publish a
decision the vendor never agreed to us publishing.

**Identity verification only, worded as such.** "Verified vendor" would imply we have checked
their software. Business verification is about whether we may send them money and appears
nowhere public — a storefront test asserts the serialised profile contains no `payout`, no
`commission` and not even the word "business".

**A vendor's own website is `rel="nofollow noopener noreferrer"`.** This page is indexable, and
passing ranking to a URL a vendor typed is how a storefront becomes an SEO product rather than a
description of a seller.

**The caching split is a testability decision as much as a performance one.** `getVendorProfile`
is `"use cache"` and cannot be called from vitest — `cacheTag()` throws without the
`cacheComponents` config, which is why nothing else in `services/marketplace` has an integration
test. `loadVendorProfile` is the same query without the wrapper, so the *rules* are testable and
the cached side has no logic the tests cannot reach.

**`"reviews"` came off `DEFERRED_MODULES`.** `navigation.test.ts` failed the moment
`/staff/reviews` appeared in the nav, which is the drift check working: the entry meant
"post-MVP module with no route", and reviews now have both. Removing it is the fix rather than an
exception — see vendor ticket 10 and the un-deferral note in `01-mvp-todo.md`.

### Follow-up — the 404 a vendor met on their own storefront

Reported on 2026-08-17: a verified vendor with one draft product followed **View your storefront**
on `/dashboard/selling` and landed on a 404. Both halves of the eligibility rule were working
exactly as this ticket specifies — the button was the defect, because it pointed at the public
route from inside the workspace, where the answer is unconditional.

The public rule did not move. The presentation was extracted to
`features/storefront/components/storefront-body.tsx` and a preview added at
`/dashboard/selling/storefront`, behind `requireVendorOrForbid`, which renders in **every** vendor
state with a notice naming what is missing — verification or a published product, whichever it is —
and links onward to the live page once there is one. It is in the vendor nav as *Storefront*, and
it is the only storefront link a vendor can always follow.

Three things the preview deliberately does not share with the public page:

- **No JSON-LD and no `BreadcrumbList`.** It sits behind the authenticated-area `robots.ts`
  disallow, so an `Organization` node here is noise at best, and a breadcrumb node would disagree
  with the visible workspace navigation.
- **`loadVendorProfile`, not `getVendorProfile`.** The cached reader is scoped to the public rule
  and returns `null` for an unverified vendor — the very vendor most likely to be looking. Reading
  the uncached loader also means a profile edit is visible immediately, which is what a preview is
  for, and leaves the public page's cache tag untouched.
- **The notice.** A preview indistinguishable from the live page teaches the wrong lesson about
  what customers can see.

`sitemap.xml` is unchanged: `storefrontSlugs` still lists only vendors with published products, so
the preview adds no URL to it.
