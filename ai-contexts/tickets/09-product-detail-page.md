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
- [ ] A non-technical visitor can understand what the product does without meeting the words "framework",
      "ORM" or "deployment" above the technical section (§100).
- [ ] "Request Customization" is hidden when the product has customization disabled, and the corresponding
      server action refuses the request too.
- [ ] Demo credentials for an `owners_only` product are absent from the HTML and the RSC payload for a
      non-owner — verify by viewing source, not by inspecting the UI.
- [ ] Price and licence selection update the CTA without a full page reload.
- [ ] JSON-LD validates in Google's Rich Results test.
- [ ] An unpublished or archived product returns 404, not a rendered page.
- [ ] Largest Contentful Paint is the hero image and stays under 2.5s on a throttled connection.
- [ ] Changelog and version data match what ticket 07 recorded.
