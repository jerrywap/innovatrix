# Cold handoff — the two-catalogue split, and COS-3

Written 2026-08-23, on branch `COS-3` (no upstream). For a session starting with
no memory of the conversation that produced commits `92c1ff6 … 3e722c9`.

Read `AGENTS.md` first — it is the standing contract and this document does not
repeat it. What follows is the *why* behind a feature area whose reasoning is
spread across four commits, plus the state of play and what is deliberately
unfinished.

---

## 1. The shape of the thing

The platform sells two kinds of artefact and they are **separate storefronts**,
not two views of one:

| | Application script | Website template |
|---|---|---|
| what it is | a complete working application | a front-end you style |
| browses at | `/marketplace` | `/templates` |
| card says | **Full Script** | **Website Template** |
| `products.catalogue` | `"script"` | `"template"` |

Templates are intended to move to their own domain (**cotheme.net**) later. They
coexist in one deployment today, which is why the split is expressed as a
*catalogue field plus a seam*, rather than by forking the codebase.

**The seam is `src/config/catalogue.ts`.** Every path that turns a catalogue into
a URL goes through `CATALOGUE_SURFACE`. When the move happens it is a table edit
and a compiler walk, not a search for `/marketplace` string literals. Note that
`productPath` is `/marketplace` for **both** today, on purpose: moving a
template's *detail* page means touching canonicals, `openGraph`, the
`slugHistory` redirect, breadcrumbs, JSON-LD `offers.url`, the proxy's
product-path matcher and the sitemap. That is its own change, and that line is
where it starts.

### Two index-shaped decisions you must not undo

Both are argued at length in `config/catalogue.ts`; the summary so you don't
"simplify" them:

- **`productCatalogueFilter`** returns `{ catalogue: { $in: ["script", null] } }`
  for scripts, **never** `{ $ne: "template" }`. The storefront index is
  `{ status, catalogue, facets }` and a non-equality predicate on a middle key
  strips the keys after it of their bounds. `facets` is what comes after, and it
  is the whole point of stage one in `pipeline.ts`. `$in` is equality-shaped, so
  the bounds survive — verified with `explain()`. A `$ne` would quietly slow the
  *main* marketplace query.
- **`CatalogueScope` is `ProductCatalogue | "all"`, required everywhere.** Not
  optional. Two callers legitimately want both (a vendor storefront, a saved
  list), and with an optional field "meant both" is indistinguishable from
  "forgot to pass it" — which on a public listing fails **open**.

### Taxonomies are scoped too

`Taxonomy.catalogue` is `"script" | "template" | "both"`, most terms being
`both`. `taxonomyScopeFilter` gives each surface its own scope plus `both`. This
exists because `filter-rail.tsx` renders *every* term for a dimension and only
*mutes* the zero-count ones — so without scoping the taxonomy itself, a
template's filter rail advertised script categories greyed out at zero.

---

## 2. One app, two listings — the multi-type feature

**The user's ask, verbatim:** a vendor may have two versions of one application —
frontend (website template) and full script (+ backend). On upload they tick a
box to also list the front-end, at its own price (often free or cheaper). The
template's product page then offers the complete application and links to it.
*"This does not replace the current plugin feature."*

### It is two documents, not one product in two catalogues

This is the decision everything else follows from. `productId` is **required and
scalar** on `ProductVersion` and `ProductFile`, the product id is baked into the
S3 key, and `assertProductFileKey` exists specifically to stop one product's file
being attached to another. A front-end zip and a full-stack zip are two
artefacts. Therefore two products.

### The pointer direction

`scriptListingId` lives on the **template** and points at the script.

- Creating the sibling becomes a **single-document insert** — no cross-document
  write, no half-linked state to recover from.
- The banner that needs it is on the template's page, so the read is local.

Under a **partial** unique index — `{ scriptListingId: 1 }` with
`partialFilterExpression: { scriptListingId: { $type: "objectId" }, deletedAt: null }`.
`sparse` cannot express the `deletedAt` half and would collide with its own
tombstone forever. It is **its own index**, deliberately not folded into
`{ status, catalogue, facets }` — see the bounds argument above.

### Where the control lives, and why not classification

`TemplateSiblingPanel` is on the **review** step (both the admin and the vendor
wizard), beside `SubmitPanel`/`PublishPanel` but not inside it:

- By review there is a price, media and licence packages worth copying. At step
  two of eleven there is nothing, and the sibling would arrive empty.
- `saveClassification` is deliberately single-catalogue: it writes `catalogue`,
  four taxonomy fields and `facets` in one `$set` so a product cannot sit in one
  catalogue carrying the other's terms. A *product insert* inside that write
  would be the wrong thing in the one place that has to stay atomic about
  placement.
- Creating a product inside a status transition would put an insert inside
  `transition`'s transaction.

Classification carries a **signpost only** — "Selling the front-end on its own
too? That's on the Review step" — added because a vendor looked for the checkbox
there first and reported it missing.

### The copy map is compiler-enforced

`src/services/catalog/template-sibling.ts` partitions `keyof ProductDoc` into
three:

- `COPIED` — still true of a front-end: `name`, `summary`, `industryIds`,
  `prices`, `licencePackages`, `addons`, `installation`, `customization`,
  `deliveryMethod`, the three vendor fields.
- `SEEDED_BY_CREATE_DRAFT` — copying them would fight `createDraft`.
- `EXCLUDED: Record<Exclude<keyof ProductDoc, Copied | Seeded>, string>` — each
  with the reason it would be **false or broken** on a front-end listing.

The test a field must pass is *not* "can it be copied", it is **"is it still true
on a listing that has no backend"**. The sharpest exclusion is `features`:
"Role-based access", "Email notifications" render under *What's included*, are
actively false on a front-end, and there is **no readiness gap for features** —
so a copied capability list would reach a customer having never been read.
`media` and `demo` are excluded for hard reasons (a media key and a credential
ciphertext are both bound to the product they were created under),
`categoryIds` because `assertTermsInCatalogue` would refuse them, `slugHistory`
because a copied one hijacks another product's redirects.

Because `EXCLUDED` is a `Record` over a computed `Exclude<…>`, **`tsc` fails
here, naming the field, the day anyone adds one to `ProductDoc`** — until a human
buckets it. That is the `EVENT_NAME_SET` technique from `AGENTS.md`'s fan-out
table, and it is the reason there is deliberately **no fifteenth enforcement
test** for this. Do not add one.

The sibling lands as a **draft** and cannot be otherwise: `releaseVersion`
refuses a version with no `application_package`, so auto-publishing would ship a
listing with a dead download. The panel says so *before* the click — it needs its
own front-end download, its own screenshots, a description and at least one
template category.

`unlinkTemplateSibling` is the escape hatch, and it is what lets
`saveClassification` afford to *refuse* a catalogue change on a linked template
rather than silently clearing the pointer. It writes `scriptListingId:
undefined`, because `setAndUnset` turns that into `$unset` — which is what the
partial index's `$type: "objectId"` condition needs in order to stop matching. A
`null` would keep the field present and keep the slot taken.

### The cross-sell banner

`src/features/product/complete-application-banner.tsx`, fed by
`getLinkedScriptListing` — its own cached loader, deliberately not a variation of
`getRelatedProducts`, which filters to one catalogue on purpose. It tags both
slugs, so repricing the script dumps the banner too.

Two things about that file are load-bearing:

1. **It is a component, not a line in the page**, because it needs the viewer's
   currency and the currency is a cookie. Nothing in the product page's body
   reads cookies; only its suspended children do, because an unsuspended cookie
   read makes the **whole route** dynamic.
2. **Its name is chosen against a test.** `product-page.test.ts` checks Suspense
   proximity with `code.indexOf("<DemoPanel")` and friends — a **prefix** match.
   `RelatedProductsBanner` would be found before the real `RelatedProducts` and
   measure the wrong thing. `CompleteApplicationBanner` collides with none.

**A function cannot cross the RSC boundary.** `TemplateSiblingView` carries a
resolved `href: Route`, not an `hrefFor: (id) => Route` callback. The callback
version 500'd the review page. `stepHref` needs the surface (`admin` vs
`vendor`), which the page knows and the client component does not, so the page
resolves it and the href travels with the listing it points at.

---

## 3. Free and paid, in combination

Also from the same ask: free scripts, free + free plugins, free + pro plugins,
and pro script + plugins. The price can sit on the script, on the plugins, or
both. A free e-commerce script might still need a paid Stripe-integration plugin
— use it as-is for nothing, or pay for the plugin.

- Plugins are the **existing add-on** mechanism (`ADDON_PRICING_TYPES` =
  `fixed | starting_from | quote_required`). Nothing new was invented.
- `"free"` is a payment **provider** (`enums.ts:422`) and one of the two
  `DRIVERLESS_PROVIDERS` alongside `manual`.
- `settleFreeOrder` (`payment-service.ts:162`) settles a £0 order through the
  normal checkout with two independent locks: `free` is **absent from `DRIVERS`**
  so currency routing can never select it for a real order, and the function
  refuses `total.amount !== 0` outright — a `ValidationError`, not a
  `ConflictError`, because reaching it is a programming mistake rather than a
  state race. It tolerates a double submit (`already_settled`).
- The bug this fixed: the free wall was *after* `createOrder` had committed,
  leaving an orphan `awaiting_payment` order that nothing swept.
- The marketplace has a **Free** filter, and it is derived from `activePrice`
  rather than a stored flag — so it is per-currency correct. A product at zero in
  USD and 5,000 in NGN is free to one viewer and not the other, which a boolean
  on the document could not express. Branding-wise the ask was explicitly
  **"FREE", not "$0"**, hence `FreeBadge`.
- A revenue leak was fixed in `cart-service.ts`: `addonPrice ?? 0` became an
  explicit three-way with a `ConflictError`.
- `ADDON_PROVISIONING_STATUSES` (`pending | provided | cancelled`) plus
  `/dashboard/selling/plugins` is where a bought-but-not-yet-handed-over plugin
  lives. A plugin is delivered *off* platform — a key, a licence code, a
  third-party account — so there is no artefact to attach and "delivered" is not
  something the platform can infer. Two domain events, `AddonProvisioningRequested`
  and `AddonProvisioned`, both fanned out through all nine registry places.

---

## 4. Navigation

`PUBLIC_NAV` is exactly three items now: **Software & Scripts** →
`/marketplace`, **Website Templates** → `/templates`, **Request Custom Build** →
`/custom-software`. Services was removed (it keeps its footer link) and the
**pricing page was deleted**.

`CATALOGUE_SURFACE.plural` deliberately does **not** feed the nav. The header
sells a destination ("Software & Scripts"); a card states a fact about one item
("Full Script"). Different jobs; one string doing both makes the nav read like a
database column.

`typedRoutes` is on, so a link to a route that doesn't exist is a compile error.
That is what keeps post-MVP modules out of the navigation — don't add a route
just to satisfy a link.

---

## 5. COS-3 — the most recent commit (`3e722c9`)

Ten items from using the upload wizard and the storefront in anger. The full
reasoning is in the commit message; the parts that change how you should work:

**The wizard no longer uses `<form action={fn}>`, and must not go back to it.**
React 19 routes a function action through `startHostTransition`, which requests a
real DOM `form.reset()` **before the action runs**. Native inputs survive it
(React writes their fresh `defaultValue` in the same commit — which is why only
the dropdowns misbehaved and nobody suspected the form shell); Radix's Checkbox,
Select and Switch each answer a `reset` by restoring a ref captured on **first
render**. An unchecked box submits nothing, `idListSchema` turns absent into
`[]`, and the *next* save wrote empty arrays over the categories just stored,
reporting success. Making the control controlled does not help — Radix calls the
controlled `onChange` with the stale value instead.

`useManualSubmit` (`features/products/components/section-form.tsx`) is the fix
and the shared version. `preventDefault()` puts React on the `action === null`
path, which requests no reset. Two consequences that bite: `useFormStatus`
reports nothing for a manual dispatch (so `pending` travels as a prop), and
`new FormData(form)` omits the submitter (so use `new FormData(form, submitter)`
or the `intent` field disappears and "Save and continue" stops navigating).

**The bug class is repo-wide and only the wizard is fixed.** 68 files use
`useActionState`. What actually matters is the narrower set that combines
`<form action={fn}>` with a Radix form primitive — a form of native inputs is
immune, because React writes their fresh `defaultValue` in the same commit.
Enumerated on 2026-08-23, five files remain:

| File | Control |
|---|---|
| `features/vendors/components/submit-panel.tsx` | Checkbox |
| `features/taxonomies/components/taxonomy-manager.tsx` | Checkbox |
| `features/staff/components/queue-table.tsx` | Checkbox, Select |
| `features/ai-settings/components/settings-form.tsx` | Checkbox |
| `features/payments/components/provider-toggle.tsx` | Switch |

`submit-panel.tsx` is the one to fix first: it is the vendor **attestation**
checkbox, on the same review step as the panel that was fixed, so a failed submit
unticks the box the vendor just agreed to. The exported hook makes each of these
a two-line change.

Regenerate the list with — note the `components/ui` guard, which is what
distinguishes a Radix primitive from a native `<select>`:

```sh
for f in $(grep -rl "<form action=" src/); do
  grep -qE 'from "@/components/ui/(checkbox|switch|select|radio)' "$f" && echo "$f"
done
```

**"Optional" means `""`, not `undefined`.** `validators/common.ts` now has
`optionalUrl`, `optionalId` and `countFromForm` beside the `optionalText` that
always had it right. Use them. `z.coerce.number()` on `""` is **0**, which turned
blank support/update periods into a silent zero.

Other COS-3 changes worth knowing about before touching the relevant file:

- `resolveStorefrontCurrency` (`services/marketplace/currency.ts`) is the **only**
  place that resolves the viewer's currency. `proxy.ts` is the only writer of
  `CURRENCY_COOKIE`, gated on `isRealVisit` + value-changed. The currency chips in
  `filter-rail.tsx` are plain `<a>`, **not** `<Link>` — load-bearing, because a
  `<Link>` click and Next's in-viewport prefetch of the same href are both
  `sec-fetch-dest: empty` and cannot be told apart.
- `queryKey` in `pipeline.ts` normalises the cache key. `searchMarketplace` calls
  it internally so no call site can forget. `NORMALISE` is a mapped type over
  every key of `MarketplaceQueryInput`, so adding a filter without deciding its
  effect on the key is a compile error.
- `buildMarketplacePipeline(input, { counts: false })` flattens the rows branch
  for the append-on-scroll path. **The default shape is byte-identical on
  purpose** — `getCardsBySlug` slices stage one off with `.slice(1)` and reuses
  the rest.
- `screenshots(media)` in `detail.ts` is shared by the hero, the OG image and the
  gallery. `ProductDetail.media` is now typed `ProductMediaKind`. Before this, a
  video-first product rendered `<Image src="…mp4">` as its LCP element and handed
  that URL to every crawler.
- `product-page.test.ts` locates the hero with
  `slice(indexOf("{hero &&"), indexOf("<Gallery"))`. **Do not rename `Gallery` or
  the page's `hero` variable** — `indexOf` returns `-1`, the slice becomes most of
  the file, and the assertion **passes vacuously**. A green tick there is not
  proof; break the hero once if you need to be sure.
- `action-guards.test.ts` now walks `.ts` **and `.tsx`**. It walked `.ts` only,
  so a `"use server"` `.tsx` file was invisible and its exported actions were
  never checked — fail-open. `append-actions.tsx` is the first such file.

### The one genuine unknown

`appendMarketplacePageAction` is a **Server Action that returns JSX**, calling a
`"use cache"` function (`searchMarketplaceRows`). It typechecks, lints and builds,
and nothing in the Next 16 docs forbids either half — but this repo uses the
pattern nowhere else, and **whether the second identical append actually serves
from the cache entry has not been observed**. Check the query log in `next dev`
before assuming it is cheap. The priced retreat is a route handler returning
JSON, at the client-bundle cost `product-card.tsx` argues against (it would make
`ProductCardTile` a client component and ship the money type and price formatter
to the browser).

---

## 6. State of play

Verified on `3e722c9`: `npm run typecheck` clean · **773 unit tests, 49 files**
· lint at the **61-warning baseline** · `npm run build` exit 0 · route rendering
modes (`○ ◐ ƒ`) diffed against a baseline worktree build and **identical**, so
nothing became dynamic that wasn't.

**Not verified, because it needs a browser.** All of COS-3's interaction work:
the save-no-longer-wipes behaviour on the four affected steps, currency end to
end (grid + rails + detail + cart + home rail), the lightbox, append-on-scroll,
and the custom scrollbar in both themes. `AGENTS.md` calls for a
`## Live verification` block on a ticket for exactly this reason.

### Deferred, each named on purpose

- **`robotsFor` is never called by any page.** So `?page=5` already ships no
  `noindex` and canonicalises to page 1 — the exact mistake its own comment warns
  against. **More urgent since COS-3**, because `replaceState` makes deep-page
  URLs far likelier to be shared. Wiring it means converting `export const
  metadata` to `generateMetadata({ searchParams })` on five high-traffic public
  routes, which is a rendering-mode change and wants its own diff. **Do this
  next.**
- `CARD_PROJECTION`'s `media: { $slice: ["$media", 1] }` takes the first array
  entry regardless of `kind`, so a video-first product still shows a broken card
  image. Same bug class as `screenshots()`, different file.
- A real video **player**. COS-3 stopped rendering a video in an `<Image>`; it did
  not start playing it.
- Vendor **logo upload**. The byline shows `logoUrl` with a monogram fallback, but
  there is no way to set one — it needs a `vendor-logo` storage scope, a public
  prefix and a generalised `assertKeyBelongsTo`. The vendor-document prefix
  cannot be reused: it is deliberately for sensitive files behind presigned GETs.
- The `useActionState` sweep (see above).
- `getCardsBySlug` could take `counts: false`, but it composes with `.slice(1)`.
- The wizard's remaining Radix selects (pricing has two).
- A **jsdom test project**. Both vitest projects are `environment: "node"`, so
  **nothing in this suite can render a component** — which is why COS-3's
  interaction work has no automated coverage and says so rather than pretending.
- Ticket 28's shared integration harness and `src/test/factories/`. Still the
  single biggest lever on test cost; see `AGENTS.md § Testing`.

---

## 7. Dev database — read this before trusting the catalogue

`npm run db:seed` and `npm run db:seed:bulk` were both run on 2026-08-23, and the
catalogue was cleaned up afterwards. **Current state, verified:**

```
total 1016 · published 1010 · script 881 · template 135
media 1600/900 1009 · media 800/500 0 · no media 3 · duplicate slugs none
linked script/template pairs 1   (atlas-crm-template -> atlas-crm)
```

That is the intended shape: 1,000 bulk products plus the nine hand-seeded ones and
a few custom-build rows. The three with no media are `brightpath-dispatch*`, which
come from the custom-build path rather than the catalogue loop. **Do not run the
cleanup below — it is already done, and on this catalogue it would delete nothing
useful or, after a future bulk run, the wrong thing.**

### The trap that got us there, because it will recur

**`db:seed:bulk` is not idempotent across a change in PRNG draw order.** Slugs are
`${noun}-${kind}-${index+1}`, where noun and kind are drawn from
`mulberry32(20260816)` — a fixed seed, so the sequence is stable *as long as the
number and order of `random()` calls in the loop is*. Commit `92c1ff6` inserted

```ts
const isTemplate = random() < TEMPLATE_SHARE;
```

**inside** the loop, which shifted every subsequent draw, which changed every noun
and kind pick, which changed every slug. Slugs are the upsert key. So the
2026-08-23 run matched nothing and inserted a fresh ~996 products beside the ~996
from the pre-template run: 2,006 published where the script intends 1,000, half of
them carrying the old 800×500 placeholder art.

They were dropped after confirming zero inbound references — no order line,
entitlement, licence, review, saved product, cart line, `ProductVersion`,
`ProductFile` or `scriptListingId` pointed at any of them — and `db:seed:bulk` was
re-run, which upserted in place (1,016 → 1,016), confirming the script is
idempotent again now that nothing about the loop has changed.

```js
// what was run, for the record. Only correct against a catalogue polluted this way.
db.products.deleteMany({ "media.url": /800\/500/ })
```

**Any future edit that adds or removes a `random()` call in that loop does the same
thing again**, silently, and the symptom is a doubled catalogue rather than an
error. Two options if you touch it: re-derive the slug from `index` alone so it is
independent of the draw order, or budget for a wipe-and-reseed. Preflight either
way — count `Product` before and after, and check for duplicate slugs.

Also worth knowing: `seed.ts` wrote **no media at all** until COS-3, so the
product page's hero and gallery block never rendered on a freshly seeded
database, and every change to either had been checked against `seed-bulk` or
against nothing. It now seeds screenshots at 1600×900 (the lightbox renders at up
to 1280px) and one **video** on `roster` — placed **last in the array** on
purpose, with `sortOrder: 0`, so `ProductDetail.media` sorts it first (making the
`screenshots()` filter observable) while `CARD_PROJECTION`'s `$slice` still picks
a screenshot and the deferred card bug above stays dormant.

Verified after seeding:

```
ProductDetail.media order: video, screenshot, screenshot, screenshot
  media[0]  (what the old code used):  video       …roster-walkthrough.mp4
  screenshots()[0] (what it uses now): screenshot  …/seed/roster-1/1600/900
  card projection ($slice first):      screenshot
```

`seed-bulk.ts` moved from `/800/500` to `/1600/900` in the same commit and for the
same reason, so after the cleanup and re-run the whole catalogue is at 1600×900 —
which matters because an 800px source was a 1.6× upscale in the lightbox, and every
judgement about image quality here was a judgement about a scaled placeholder.

---

## 8. Two process notes

**On testing.** `AGENTS.md § Testing` was written in this same stretch of work,
after investigating a complaint that every small change bundled a lot of
over-engineered tests. The diagnosis was **not volume** — test code is 18% of
`src/`, i.e. 4.58 source lines per test line, which is not an over-tested
codebase. It was that **there is no `vi.mock()` anywhere in the repo**, forcing anything
touching a service into the integration project — 26 files each carrying its own
129-line preamble, 3,363 lines in total. The fix shipped was prose; the structural
fix (a shared harness) is ticket 28 and is still undone. The **enforcement set is
closed at fourteen** — satisfy the ones that exist, don't leave a fifteenth
behind, and if a change genuinely wants one, say so and let it be decided.

**On this feature's history.** `92c1ff6` (catalogue split, free infra, plugin
provisioning) → `4277341` (the sibling listing) → `8973dd8` (classification
signpost + the RSC-boundary crash fix) → `3e722c9` (COS-3). Read those four
commit messages if you need more than this document: they are long on purpose and
carry the reasoning for individual decisions.
