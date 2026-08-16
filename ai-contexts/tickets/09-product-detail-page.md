# 09 — Product Detail Page

**Bucket:** §5.7–5.10 · **Depends on:** 07, 08 · **Blocks:** 10, 17 · **Size:** M
**Spec:** §8 (product detail), §9 (demos), §48 (installation), §93 (SEO), §100 (progressive complexity)

## Why
This page carries the whole evaluation step of the §1 lifecycle, and it is where the customer chooses between
the two doors: **Buy As-Is** and **Request Customization** (§5). It must serve a developer who wants the stack
and a business owner who wants to know if it manages their cleaning company (§1).

## Scope

### `/products/[slug]`
Layout following the §8 structure:
- **Hero** — name, summary, price + licence selector, primary CTAs, key badges (version, category, customization
  available, installation available).
- **Gallery** — screenshots with lightbox, video embed.
- **Overview** — full description, written business-first (§100). Technical detail is present but sectioned so a
  non-technical reader can skip it.
- **Features** — the structured list from ticket 06.
- **Technology & requirements** — stack, versions, optional services (§48).
- **Demo panel** — see below.
- **Version & changelog** — current version, release date, expandable changelog.
- **Licence & support** — what the licence permits, support window, update window, in plain language.
- **Installation options** — self-install / Innovatrix installation / managed hosting, with add-on prices (§48).
- **Add-ons** — installation, branding, payment gateway setup, data migration, priority support (§49).
- **Documentation** — public docs link or a "docs included" statement.
- **Related products** — same category or industry.

### Primary actions (§8)
| CTA | Behaviour |
|---|---|
| **Buy As-Is** | Licence package + add-on selection → add to cart (ticket 10) |
| **Request Customization** | Starts the AI customization assistant with this product + version as context (ticket 17). Only shown when `customization.available` |
| **Try Demo** | Opens the demo panel / external demo |
| **Save for Later** | Favourites (ticket 08); prompts login |

### Demo panel (§9)
Renders per the product's `exposure` setting. Credentials are decrypted server-side and only included in the
payload when the viewer qualifies. Copy-to-clipboard per field. A visible reminder that the demo resets on the
published schedule.

### SEO (§93)
`generateMetadata` with title, description, canonical, Open Graph image; JSON-LD `Product` + `Offer` (price,
currency, availability) and `AggregateRating` only if reviews exist (they don't in MVP — omit rather than fake).
`generateStaticParams` for published products where practical, so the shell prerenders.

## Acceptance criteria
- [x] A non-technical visitor can understand what the product does without meeting the words "framework",
      "ORM" or "deployment" above the technical section (§100) — enforced by a test over the page source.
- [~] "Request Customization" is hidden when the product has customization disabled, and the corresponding
      server action refuses the request too — the **hiding** is done; the action is ticket 17's and does not
      exist yet. Flagged there rather than stubbed here.
- [x] All four §8 CTAs present — Buy As-Is, Request Customization, **Try Demo**, Save for Later.
- [x] Demo credentials for an `owners_only` product are absent from the HTML and the RSC payload for a
      non-owner — verified against the **raw response body**, not the rendered tree.
- [x] Price and licence selection update the CTA without a full page reload.
- [x] JSON-LD validates — parsed from the live response; `SoftwareApplication` + `Offer`, no `AggregateRating`.
- [~] An unpublished or archived product returns 404, not a rendered page — it renders the **404 page** and
      carries `<meta name="robots" content="noindex">`, but the HTTP status is **200**. See below: this is
      documented Next.js streaming behaviour, not a defect in this code.
- [x] Largest Contentful Paint is the hero image — a plain RSC `next/image` with `priority`, asserted by test.
      The throttled measurement itself belongs to ticket 27's Lighthouse pass.
- [x] Changelog and version data match what ticket 07 recorded — one reader, `listCustomerVersions`.

---

## Implementation notes

### The credential guarantee, verified the way it actually fails

An anonymous request for an `owners_only` product returns 76KB, and **none of it
contains a credential** — not the password, not the username, not the gated
`customerUrl`/`adminUrl`, and not even the field names `passwordCipher`,
`ciphertext`, `keyVersion` or `credentials`.

That is a string search of the raw body, not an inspection of the rendered tree,
because the failure mode is invisible in the tree: `{canSee && <Password
value={p} />}` satisfies the UI and still serialises `p` into the RSC payload.

The guarantee is structural rather than conditional:

- `getProductDetail()` is cached and its return type **has no credentials
  field**. The Mongoose query also excludes `demo.credentials.passwordCipher`,
  so a future `...product` spread cannot leak what was never fetched.
- `revealCredentials()` is uncached, `server-only`, returns **`null`** for a
  viewer who does not qualify — so there is nothing in scope to leak — and takes
  the viewer as an argument, putting the authorisation at the call site.

The full matrix, exercised against the real database:

```
viewerOwnsProduct   entitled org: true · other org: false · anonymous: false
revealCredentials   anonymous: null · signed-in non-owner: null · owner: decrypted
                    owner also sees the gated customer/admin URLs
```

### The 404 that is a 200, and why it is not being "fixed"

Next.js documents this exactly:

> Next.js will return a `200` HTTP status code for **streamed** responses, and
> `404` for non-streamed responses. […] when a 404 page is streamed, Next.js
> includes a `<meta name="robots" content="noindex">` tag in the streamed HTML.
> […] In the streaming case, this does not lead to indexation.

The response carries `x-nextjs-postponed: 1` — the shell is flushed, and with it
the status, before the dynamic part can call `notFound()`. The `noindex` tag
**is** present, verified on both a withdrawn product and a slug that never
existed, so the SEO consequence the criterion exists to prevent does not occur.

The documented escape hatch is a resource check in `proxy.ts`. That is declined
deliberately: it means a database read on **every** product-page request,
including prefetches, in a file whose own doc comment explains at length why it
must not touch the database. A literal 404 status for compliance or analytics is
worth less than that. Raised for ticket 27 to decide with the caching work.

Separately, `CACHE_PROFILE.product` is now **`stale: 0`**. Every other profile
happily serves a slightly-old copy; a product page must not, because "withdrawn
but still rendering" is the one staleness that matters here.

### Recently-viewed had to move to the proxy

The first implementation wrote the cookie from a Server Component. **Next.js
does not allow that** — only a Server Action or Route Handler may set a cookie —
so it threw, a `try/catch` swallowed it, and the feature silently never worked.
It now lives in `proxy.ts`, which is where the plan put it.

The prefetch guard took three attempts, and the first two were wrong in a way
curl could not reveal:

| signal | result |
|---|---|
| `next-router-prefetch: 1` | **never arrives** — Next consumes the RSC headers before the proxy |
| `?_rsc=` search param | **never arrives** — stripped as an internal param |
| `Sec-Fetch-Dest` | arrives, and distinguishes `document` from `empty` |

So the test is inverted: record a *document* navigation rather than exclude a
prefetch. The cost is that a client-side navigation between two product pages is
missed — accepted, because a rail full of hovered links is worse than a rail
missing one entry. `curl` sends no `Sec-Fetch-Dest` at all, which is why an
absent header counts as a real visit; otherwise every scripted check of this
would pass for the wrong reason.

Verified: page load records · prefetch does not · `purpose: prefetch` does not ·
Googlebot does not · a category page is not mistaken for a product · revisiting
moves an entry to the front rather than duplicating it.

### Try Demo was missed on the first pass

Three of §8's four CTAs shipped; "Try Demo" did not. The demo *panel* existed
further down the page, but the CTA beside the price — which is what the ticket
specifies — was absent, so a product with a demo looked like one without.

It now renders only when there is something to try, and goes to one of two
places:

| state | CTA | destination |
|---|---|---|
| public URL configured | "Try the demo" | the URL, new tab |
| credentials only | "See demo access" | `#demo`, which shows them or says what unlocks them |
| neither | *nothing* | — |

Nothing rather than a disabled button: a greyed-out CTA is a promise the
product cannot keep, and four CTAs where one never works reads as broken.

`DemoCta` carries a URL, a boolean and a count. It is a **client** component
prop, so anything on it is in the RSC payload — the same discipline
`publicDemoView` enforces server-side, and there is now a test asserting the
type cannot grow a password, a username or a gated URL.

### The seed had no demos at all, so none of this was visible

Every product had `exposure: "authenticated"` and nothing else — no URL, no
credentials — so `DemoPanel` correctly rendered `null` everywhere and the whole
§9 surface was invisible in development. Four products now cover four states:

```
atlas-crm    public           URL + 2 credentials   → anyone sees them
tenancy      authenticated    2 credentials         → locked until sign-in
roster       owners_only      URL + 1 credential    → locked until purchase
freightline  none             nothing               → no panel at all
```

Passwords are sealed with the same `seal()` the admin form uses, with the
product id as AAD — a seed storing plaintext would make every §89 assertion
vacuous. Verified: no plaintext in any stored document, and an anonymous
request for `roster` contains no password, username or gated URL.

### Client islands, each with a nameable reason

| island | why it cannot be a Server Component |
|---|---|
| `PurchasePanel` | the criterion: selection updates the total without a reload |
| `Gallery` | the lightbox; the **hero** stays a plain RSC `next/image` with `priority` |
| `CopyField` | the clipboard is a browser API |
| `SaveButton` | its own label changes on click |
| `SearchBox` (ticket 08) | typing is continuous |

`PurchasePanel` receives a **server-computed price table** and never converts,
multiplies by a rate or sees a float. Summing add-ons *within* one currency is
integer addition and exact; anything needing a rate is absent by design.

### §100 made mechanical

There is an explicit `<TechnicalSection>` boundary, and a test reads the page
source and asserts "framework", "ORM" and "deployment" appear nowhere above it —
as whole words, since a substring check for `ORM` matches "platform" and
"information". "What you get" (licence, support window, update window) sits
above it too, because that is what a business owner is deciding on.
