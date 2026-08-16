# 15 — Customer Dashboard & My Software

**Bucket:** §9.1–9.4, 9.8 · **Depends on:** 14 · **Blocks:** — · **Size:** M
**Spec:** §27 (dashboard), §28 (navigation), §29 (My Software), §102 (action-oriented), §105 (lifecycle)

## Why
§27 says the dashboard must answer two questions immediately: *what is happening* and *what needs my attention*.
§102 adds: prioritise actions, not decorative statistics. §29 makes My Software the long-term relationship
between a customer and what they bought — the anchor for every future upsell in §105.

## Scope

### `/dashboard` (§27)
- **Needs Your Attention** first and visually dominant — only genuine actions, each a link straight to the thing:
  quotes awaiting approval, unpaid invoices, requests waiting on customer input, unread staff messages,
  product updates available. When there is nothing, say so plainly rather than showing empty cards.
- **At a glance** counts: Open Requests · My Software · Orders · Quotes · Invoices.
  (Active Projects, Support Tickets and Upcoming Renewals from §27 are post-MVP — omit, don't stub.)
- **Recent activity** — the last 10 `activityEvents` for the organization (ticket 19), plain language.
- New customers with no purchases get a genuine onboarding state: browse the marketplace, or start a custom
  build — the two §107 doors.

### `/dashboard/software` (§29)
Grid/list of entitlements:
- Product name, thumbnail, purchased version, current version, licence status, support-until, updates-until.
- **Update available** badge when a newer version is within the update window.
- Per-item actions (§29): Download · View Licence · View Changelog · Documentation · Open Demo ·
  Request Installation · **Request Customization** · Request Support.
  *Request Customization* starts the ticket-17 assistant pre-loaded with this product **and the version the
  customer actually owns** (§101 — context must flow). *Request Support* opens a request/conversation.
  *Request Installation* adds the installation add-on to the cart.

### `/dashboard/software/[entitlementId]`
Detail: all downloadable artefacts for the entitled versions with checksums, version history with changelog,
licence panel (ticket 14), support/update windows explained in plain language, and the history of customization
requests made against this product.

### Orders & organization
- `/dashboard/orders` and `/dashboard/orders/[reference]` (from ticket 11).
- `/dashboard/organization` — details, billing address, tax id, members with roles, invite/revoke (ticket 03).
- `/dashboard/account` — profile, email, password, notification preferences (ticket 24).

## Acceptance criteria
- [x] A customer with two pending quotes and one unpaid invoice sees exactly three attention items —
      each linking to the **list**, because per-record quote and invoice routes do not exist yet (see below).
- [x] A customer with nothing outstanding sees a calm, honest empty state — not fabricated urgency.
- [x] My Software shows only entitlements for the **active organization**; switching orgs changes the list.
- [x] "Update available" appears only when the newer version is genuinely within the update window.
- [ ] Request Customization from My Software arrives at the AI assistant with product **and owned version**
      already in context — **the link carries them; the assistant is ticket 17**, so there is no conversation
      record to verify against yet.
- [x] Dashboard first paint under 1.5s with 50 entitlements — counts come from indexed aggregations, not
      loading every document.
- [x] No post-MVP module appears as a dead link.
- [x] Every count on the dashboard reconciles with its underlying list page.

## Implementation notes

### Counts are counts, and each one matches its list page

`features/dashboard/overview.ts`. Five parallel `countDocuments` against indexed
filters — never "load the rows and take `.length`", which is the version that
gets slower exactly as a customer becomes more valuable.

The reconciliation criterion is easy to fail by accident: the dashboard says
"Orders 7" while `/dashboard/orders` shows 6 because one is a draft the customer
never submitted. Both apply `status: { $ne: "draft" }`. Verified live — the
figures on the dashboard and the rows on each list page agreed at 53 software /
1 order / 2 quotes / 1 invoice.

`requests` is a literal `0` rather than a query: requests are ticket 17. A
fabricated number would be worse than an honest zero, and the card links to a
route that exists.

### Attention items link to the list, not the record

§27 asks for a link "straight to the thing". Orders get that
(`/dashboard/orders/[reference]`). Quotes and invoices do not, because
`/dashboard/quotes/[reference]` and `/dashboard/invoices/[reference]` don't
exist — and with `typedRoutes` on, linking to them is a compile error rather
than a dead link discovered later. That is the mechanism doing its job; the
routes belong to the quote and invoice tickets.

### Urgency is ordered by what it costs to ignore

Overdue invoice, then money still owed, then a quote about to expire, then an
abandoned payment. A quote expiring within a week reads louder than one valid
for another month. Nothing outstanding renders "Nothing needs you right now"
rather than a row of zeroes — §102's no-fabricated-urgency, made concrete.

### `hasDemo` replaced a field that was computed and never used

`EntitlementView.product` carried `installationAvailable`, derived on every row
and rendered nowhere. It was there for §29's *Request Installation*, which turns
out not to be expressible: ticket 10's cart hangs add-ons off a `parentLineId`,
so there is no way to buy an installation for a licence you already own without
a standalone service line. That is a change to the cart model, not a button, and
it is recorded in the card's own comment rather than left as a mystery field.

What replaced it earns its place: `hasDemo` drives an **Open demo** action that
deep-links to the product page's demo section, which already resolves §9
exposure per viewer. An owner passes `owners_only` by definition — this is the
one screen where that rule pays off, and nothing here re-implements it.

Five of §29's eight actions ship. The three that don't — Documentation (no field
on `ProductDoc`), Request Installation (above), Request Support (ticket 17) —
are named in the component.

### `notFound()` under `/dashboard` renders a 404 body with a 200

Measured, then diagnosed: `app/dashboard/loading.tsx` wraps every route in the
segment in an implicit Suspense boundary, so the shell flushes before any page
resolves and the status is committed before `notFound()` runs. Removing that one
file makes the same request return a real 404 — which is how it was confirmed,
and why `/marketplace/[slug]` (no `loading.tsx` above it) gets its 404 today.

Left as-is. These routes read `headers()` through the DAL, so they are dynamic
and there *is* a real gap before first paint, which is why ticket 04 required a
`loading.tsx` per protected segment. The customer sees the right page either
way; the 200 costs uptime checks and anything branching on `res.ok`, and nothing
behind a login does that. Worth revisiting only if something starts consuming
these routes programmatically. Both software pages now resolve at page level
anyway — with the segment fallback already in place, a nested boundary around a
single query bought nothing.

### Verified live

Signed in as the seeded customer, against the dev database:

- **Two issued quotes and one overdue invoice produced exactly three items**, in
  that priority order, with a *draft* quote and a *paid* invoice correctly
  absent — the two things a naive filter would include.
- **Performance, against a production build with 53 entitlements**:
  `/dashboard` 43–295ms, `/dashboard/software` 67–98ms, full response including
  streamed boundaries. Well inside the 1.5s criterion. (Dev-mode timings for the
  same pages are 0.3–1.6s and are not the criterion.)
- Org scoping is now covered by `entitlements.integration.test.ts` as well —
  every read run twice, once as the owner and once as a stranger.

### The seed created users nobody could sign in as

Ticket 15 is the first ticket whose deliverable is a page behind a customer
login, and that is when this surfaced: `scripts/seed.ts` wrote `users` but never
an `accounts` row, and Better Auth authenticates against `accounts`. So the
seeded order, entitlement, licence and dashboard had all existed since ticket 02
and none of them could be opened.

Fixed with Better Auth's own `hashPassword` rather than a hand-rolled scrypt, so
the seed cannot drift from what the library verifies with, and the row shape
copied from `sign-up.mjs` (`providerId: "credential"`, `accountId` = the user's
id). Existing passwords are left alone rather than re-hashed on every run. All
seeded accounts share `innovatrix-demo-2026`, printed at the end of the seed and
deliberately **not** read from the environment — a seed that can be pointed at
production with a real-looking password is one that eventually is.
