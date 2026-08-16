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

**Not** their sales volume, revenue, or payout status. That is the vendor's
commercial information and the customer has no claim on it.

An unverified, suspended or offboarded vendor has no page. A vendor with no
published products has no page either — an empty storefront in the index is a
thin page that costs the whole site a little ranking.

### Attribution on the product page

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

`robots.ts` is unchanged: the storefront is public and indexable, and `/vendor`
(the vendor's own workspace) is already covered by the authenticated-area
disallow rules.

### Progressive complexity

§100 applies. A storefront describes the maker in the language a buyer uses —
what they build, for whom, since when. Not their stack, not their submission
history, not their internal verification level.

## Out of scope
Vendor-run promotions, follow/subscribe, and vendor-authored long-form content.
Each is a content surface with its own moderation problem and none is asked for.

## Acceptance criteria
- [ ] A vendor product's JSON-LD names the vendor as `seller`; a first-party product names the platform.
- [ ] The site-wide `Organization` and `WebSite` nodes are unchanged and still emitted once per page.
- [ ] A storefront exists only for a verified vendor with at least one published product.
- [ ] A suspended or offboarded vendor's storefront returns 404, and their published products are handled per vendor ticket 12.
- [ ] The storefront shows no sales, revenue or payout information.
- [ ] A rating appears only where reviews exist; a vendor with none shows no rating rather than zero stars.
- [ ] Product cards and detail pages attribute their vendor and link to the storefront; first-party products show no attribution.
- [ ] A card attributes its vendor without an additional query per card.
- [ ] Filtering the marketplace by vendor works from a chip and from the URL, and the filtered view is linkable.
- [ ] The storefront has a canonical URL, Open Graph and a Twitter card.
- [ ] Publishing or unpublishing a product refreshes the storefront within the documented cache window.
- [ ] `sitemap.xml` lists storefronts with published products only, and every URL in it resolves.
- [ ] The storefront's `BreadcrumbList` matches the visible breadcrumb exactly.
