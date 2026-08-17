# S08 — Cross-portal navigation & stub screens

**Source:** ticket 30, lines 18, 21, 22 · **Severity:** minor
**Depends on:** — · **Blocks:** — · **Size:** M
**Spec:** §28 (dashboard navigation), §38 (unified communication), §76 (organizations)
**Status:** **done, 2026-08-17.**

## What shipped

**Cross-portal links.** `staffNavFor()` appends an *Elsewhere → Admin* section when the
reader holds any `ADMIN_PERMISSIONS` — the same predicate `app/admin/layout.tsx` uses as
its gate, so the link appears exactly when the destination would admit them. `adminShellNavFor()`
adds the way back.

They are appended by those functions rather than declared in the tables, and that is not
tidiness: `ADMIN_PERMISSIONS` is *derived* from `ADMIN_NAV`, so a link gated on that set and
declared inside the set's own source is a circular definition. The first attempt did exactly
that and also made `adminNavFor()` non-empty for everybody — which the layout reads as "may
enter admin". `navigation.test.ts` caught it.

Also fixed: `/staff`'s account dropdown offered "Staff console", a link to the page you were
already on.

**A real messages inbox.** `listConversations` (customer, org-scoped) and
`listConversationsForStaff` (across organisations, behind `message.view_all`) — two named
exports rather than an optional `organizationId`, for the same reason as the order loader.
Both pages were hardcoded empty states running no query at all.

The §37 boundary gets the same treatment as the thread view: excerpt and unread count both
come from the audience-filtered query, so an internal note can neither become a customer's
"last message" nor bump their unread badge. A conversation whose only messages are internal
does not appear at all — an empty row would itself disclose that one exists.

`loading-boundaries.test.ts` caught the staff guard sitting inside the `<Suspense>`, where
`forbidden()` would have rendered under a 200. Hoisted into the page body.

**`/dashboard/organization` removed from navigation**, route kept. It renders a hardcoded
"nothing to manage yet" with no query behind it. The test that asserted it was visible to
owners and admins now asserts the opposite, and says why.

## Why

Three reports about navigation, which turn out to be the same complaint from both ends:

> If I am logged in as admin I should see a link to `/admin` on my sidebar, and vice versa
>
> At what point is this page relevant? `/dashboard/messages`
>
> This screen `/dashboard/organization` does not seem to be relevant yet

The sidebar is **missing a link to somewhere real**, and it is **offering two links to
places with nothing behind them**. A nav item is a promise; two of these are unkept and one
is unmade.

## Part A — cross-portal links

### Current state

`src/lib/navigation.ts` holds three static tables: `CUSTOMER_NAV:69`, `STAFF_NAV:157`,
`ADMIN_NAV:231`. **`STAFF_NAV` has no `/admin` entry and `ADMIN_NAV` has no `/staff`
entry.** Neither has `/dashboard`.

The only cross-portal link anywhere is in the account dropdown —
`src/components/shell/account-menu.tsx:71-78` renders "Staff console" → `/staff` when
`isStaff`:

- `src/app/admin/layout.tsx:32` passes `isStaff` **hardcoded** — so admin → staff exists,
  buried in the avatar menu rather than the sidebar.
- `src/app/staff/layout.tsx:38` also hardcodes it — so at `/staff` the item is a **self-link
  to `/staff`**. Dead weight.
- `src/app/dashboard/layout.tsx:84` passes the real `user.isStaff`, which is correct.

Net: **there is no path at all from `/staff` to `/admin`**, and a super-admin moving between
the two consoles has to type the URL.

### Scope

- Add a cross-portal entry to `STAFF_NAV` → `/admin` and to `ADMIN_NAV` → `/staff`, in their
  own section at the foot of the sidebar so it reads as leaving rather than as another
  queue. Consider `/dashboard` alongside — staff are customers of their own product.
- **Gate the `/admin` entry on `ADMIN_PERMISSIONS`** (`navigation.ts:380`), which is derived
  from `ADMIN_NAV` and is already what `src/app/admin/layout.tsx:24` uses as the entry
  guard. `NavItem.permission` takes a list with OR semantics (`permitted():359`), so passing
  that set reproduces the layout guard exactly — one definition, no drift. A staff member
  without admin rights sees nothing, and `prune():340` removes the empty section.
- Fix `staff/layout.tsx:38` so the account menu stops offering a link to the page you are on.
- All three routes are real (`src/app/staff/page.tsx`, `admin/page.tsx`, `dashboard/page.tsx`),
  so `typedRoutes` is satisfied without a cast — do **not** add `as Route` (smoke ticket 06).
- `navigation.test.ts` and `allNavItems():429` pick new entries up automatically; extend the
  test so a cross-link the user cannot follow is a failure.

## Part B — `/dashboard/messages` is an inbox with no query

`src/app/dashboard/messages/page.tsx` is 23 lines: `PageHeader` plus a literal
`<EmptyState title="No messages">`. **It imports no model and no service.** It will say "no
messages" forever, however many conversations exist. Its staff twin
`src/app/staff/messages/page.tsx` is the same shape, with only the permission check real.

Meanwhile ticket 21's machinery works and is reachable **only when embedded in a request
page** (`dashboard/requests/[reference]/page.tsx:148-159`,
`staff/requests/[reference]/page.tsx:169-183`). So the answer to "at what point is this page
relevant?" is: it is relevant now, and it is the only screen that cannot see the messages.

### Scope — build the inbox

- Add `listConversations` to `src/services/messaging/messaging-service.ts`. It has
  `customerThread():56`, `staffThread():65`, `postMessage():174`, `markThreadRead():250` and
  `unreadForOrganization():274` — everything except an aggregation across subjects. That
  last one is the natural seed and already powers the unread badge.
- Customer view: org-scoped, newest activity first, showing subject reference and title,
  last message excerpt, unread marker, deep-linking into the subject page — the thread stays
  where its context is (§101). This is an index, not a second chat UI.
- Staff view: the same behind `message.view_all`, filterable by assignment and unread.
- **The §37 boundary is the thing to be strict about.** An inbox is a new query over
  `messages`, and ticket 21 defends visibility in four layers — query filter, separate
  services, a DTO with no `visibility` field, and a payload-level test. A list view must
  reuse `customerThread`'s filtering, not re-implement it: an internal note must not surface
  as a customer's "last message" excerpt, nor bump their unread count. Extend ticket 21's
  payload-level test to cover the list.
- `Conversation` is unique on `{subjectType, subjectId}`
  (`src/lib/db/models/communication.ts:68`) and `subjectType` allows
  `["request", "order", "quote"]` (`src/lib/db/enums.ts:271`), though only `request` is ever
  written today. The list should not assume that stays true.

## Part C — `/dashboard/organization` stays hidden

`src/app/dashboard/organization/page.tsx` is the same 23-line stub: `PageHeader` plus a
hardcoded `<EmptyState title="Nothing to manage yet">`. No DAL call, no query, no members
list, no billing fields. It matches `01-mvp-todo.md:241` (row 9.8), which assigns org
settings to tickets 03 and 24 and notes "the routes exist as stubs".

**Remove it from navigation** (`navigation.ts:140-145`, gated to `owner`/`admin`) until it
has a data source. Keep the route so nothing 404s and the eventual ticket has somewhere to
land.

This is the general rule the other two items are instances of: **a nav entry that leads to a
permanent empty state is worse than an absent one** — it costs a click and teaches the
customer the product is unfinished. §102 says dashboards prioritise actions.

Its sibling `/dashboard/account` is *partially* real — notification preferences work
(`:26-28`), name/email/password are absent and the page says so (`:11-17`). That is honest
and can stay.

## Acceptance criteria

- [ ] A super-admin at `/staff` sees a link to `/admin` in the sidebar, and the reverse.
- [ ] A staff member without admin permissions sees no `/admin` link, and the section does
      not render empty.
- [ ] The account menu no longer links to the page currently being viewed.
- [ ] No cross-portal link uses an `as Route` cast.
- [ ] `/dashboard/messages` lists real threads with unread state and deep-links to subjects.
- [ ] An internal note never appears in a customer's inbox — not as an excerpt, not in the
      unread count, not in the page source. Asserted by a test on the payload.
- [ ] `/dashboard/organization` is absent from navigation; the route still resolves.
- [ ] Every remaining nav item leads to a screen with something on it.

## Root cause

The nav tables were written per portal, and nobody owned the seam between them — a
super-admin was assumed to know the URLs. The two stubs are ticket 04 scaffolding: routes
created so the sidebar could be built and `typedRoutes` satisfied, with the intention of
filling them later. Messages is now fillable; organization is not yet.
