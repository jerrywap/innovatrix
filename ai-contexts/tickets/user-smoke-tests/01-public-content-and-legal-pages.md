# S01 — Public content & legal pages

**Source:** ticket 30, lines 1–6 · **Severity:** minor (terms/privacy block launch)
**Depends on:** — · **Blocks:** launch · **Size:** M
**Spec:** §4.1 (public website), §93 (SEO)

## Why

Five public URLs were reported as "needs to be updated". Four of them are real routes
carrying no content, and the fifth is not what the tester thought it was.

That distinction matters. `/services` and `/pricing` are linked from the header on every
page (`PUBLIC_NAV`, `src/lib/navigation.ts:330-335`) and from the footer, and all four
stubs ship correct `pageMetadata()` — canonical URL, Open Graph, the lot. So ticket 27 did
its job and the result is four **well-optimised empty pages**, indexable and inviting a
crawler to rank a page that says "coming soon". An unpublished page is better than a
published blank one.

## Current state

| Route | File | What is there |
|---|---|---|
| `/services` | `src/app/(public)/services/page.tsx` (29 lines) | `PageHeader` + `<EmptyState title="Service details coming">` (:21-25) |
| `/pricing` | `src/app/(public)/pricing/page.tsx` (26 lines) | `<EmptyState title="Pricing detail coming">` (:18-22) |
| `/terms` | `src/app/(public)/terms/page.tsx` (26 lines) | "Terms not yet published … before launch" (:20-21) |
| `/privacy` | `src/app/(public)/privacy/page.tsx` (26 lines) | "Privacy notice not yet published" (:20-21) |
| `/concepts` | `src/app/concepts/page.tsx` (215 lines) | **Not a stub, and not `(public)`** — see below |

## Scope

### The four stubs

- **`/services`** — §58's standalone technical services (installation, deployment, DevOps,
  migration, maintenance, monitoring) and §59's Hire a Tech Assistant. Most of that is
  post-MVP *as software*, which does not stop it being sellable copy with a
  "request technical help" call to action pointing at the existing custom-build door.
  Do not advertise a purchase flow that does not exist — describe the service and route
  the customer to a conversation.
- **`/pricing`** — the honest shape here is not a pricing table. Marketplace products are
  individually priced (§43), customization and custom build are quoted (§51). The page's
  job is to explain *how* the three paths are priced and what a customer can expect to
  happen, not to invent tiers. Link to `/marketplace` for real prices.
- **`/terms`** and **`/privacy`** — README decision #12: "Legal: licence agreement and
  terms of service text — blocks launch, not development." This ticket does not write
  legal text. It defines where it goes, and adds the licence-agreement surface that §65
  and ticket 14 imply a customer should be able to read before buying.

Until real content lands, **remove the four from `sitemap.ts`** and mark them
`robots: { index: false }`, so ticket 27's SEO work is not spent promoting an empty page.
Re-index them in the same commit that fills them.

### `/concepts` — a different problem

Not a content gap. It is an internal design-exploration gallery of five concepts with
sub-pages, already `robots: { index: false, follow: false }`
(`src/app/concepts/layout.tsx:21`), and its own footnotes say so
(`src/app/concepts/page.tsx:192-209`):

> Nothing here is wired to data… Copy is written to be plausible, not final.
> Numbers (148 products, 99.1% SLA) are illustrative.

It is nonetheless linked from the **public footer on every page**, labelled "Design
concepts" (`src/components/shell/public-footer.tsx:73-75`). A customer following it lands
on five alternative versions of the product with invented statistics.

**Remove the footer link.** Keep the route — it is useful internally, and `noindex`
already keeps it out of search. That is the whole change; the page needs no updating
because it is not a customer-facing page and never was.

Note the hardcoded "148 products" the tester saw in the hero comes from this same
illustrative set. Smoke ticket 02 removes it there.

## Acceptance criteria

- [ ] `/services` and `/pricing` carry real copy that describes something the platform can
      actually do today, with working calls to action.
- [ ] `/terms` and `/privacy` either carry approved legal text or are not linked and not
      indexed — never a live, indexed page reading "not yet published".
- [ ] No stub page appears in `sitemap.ts` or is indexable.
- [ ] `/concepts` is no longer reachable from the public footer.
- [ ] No page states a figure it cannot derive from the database.

## Root cause

None — these were never built. Ticket 04 scaffolded the routes so the footer links would
resolve under `typedRoutes` (AGENTS.md: "a link to a route that doesn't exist is a compile
error"), and content was left for later. This is that later.

The `/concepts` footer link is the one genuine defect: an internal artefact exposed on
every public page.
