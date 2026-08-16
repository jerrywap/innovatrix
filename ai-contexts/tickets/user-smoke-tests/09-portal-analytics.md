# S09 — Portal analytics

**Source:** ticket 30, lines 25–26 · **Severity:** minor
**Depends on:** — · **Blocks:** — · **Size:** M
**Spec:** §31 (customer service dashboard), §102 (action-oriented dashboards), §95 (observability)

## Why

> `/admin/dashboard` (expected — analytics dashboard)
> `/staff/dashboard` (expected — analytics dashboard)

Two findings hide in that. The smaller one first: **neither URL exists.** The portal landing
pages are `/staff` and `/admin`; there is no `src/app/staff/dashboard/` or
`src/app/admin/dashboard/`. Both URLs 404, so the tester never saw the pages they were
judging.

The larger one: the expectation is reasonable and unmet. Nobody running this business can
currently answer "how much did we sell this month?" from inside the product.

## Current state

**`/staff`** (`src/app/staff/page.tsx`) — a work-queue board. `Counters()` (`:34`) calls
`staffCounts(user.id)` and renders a `QueueCard` per `QUEUES` entry linking to
`/staff/queue/{key}` (`:64-71`, `:107`), an urgent subset for the three unowned queues
(`:38-62`), plus `quotesAwaiting` and `overdueFollowUps` (`:76-89`). Ticket 20 built it
deliberately queue-first per §32, and it is good at that job.

**`/admin`** (`src/app/admin/page.tsx`) — a link index, and explicitly so (`:16-25`:
"Deliberately an index rather than a dashboard of metrics"). It re-renders
`adminNavFor(permissions)` as icon cards. No data at all.

**There are no aggregations anywhere.** `grep -rn "aggregate(" src` returns zero non-test
hits. Every number in the product is a `countDocuments` on a point-in-time filter. There is
no revenue total, no GMV, no time bucketing, nothing summed over money.

## Scope

Deliberately modest. §102 is emphatic that dashboards prioritise actions over decorative
statistics, and the staff queue board is the action-oriented screen it asks for — this
ticket **adds a header of headline figures above it**, it does not replace it.

### Make the URLs resolve

Add `/staff/dashboard` and `/admin/dashboard` as redirects to `/staff` and `/admin`. Cheap,
and it removes a 404 that anyone would hit by guessing.

### `/staff` — a headline row

Reuse `staffCounts` (`src/features/staff/queues.ts:166-183`), which already runs parallel
`countDocuments` plus issued-quote and overdue-follow-up counts. Add, above the queues:

- Open requests, and how many are waiting on **us** versus on the customer — §31's central
  distinction and the one that tells a team where it is failing.
- Quotes issued and awaiting a response; value of quotes outstanding.
- Invoices outstanding and overdue, with the money. Note `overdue` is **derived from `dueAt`
  on read**, not stored (ticket 23) — derive it the same way here or the two screens will
  disagree.
- Requests converted and in progress, once smoke ticket 10 gives that a state.

### `/admin` — figures over the index

Keep the index; add a small strip above it:

- Revenue this month and last, from paid orders and invoices.
- Orders placed, split paid / awaiting transfer / failed.
- Published products, and drafts awaiting review.
- New customers and organizations this month.
- Job queue depth and failures — `/admin/jobs` has this; the headline is whether to look.

Every figure **permission-filtered**, reusing the same predicate as the section it
summarises. Finance should not learn the revenue figure by reading a dashboard that
`/admin/payments` would refuse them (AGENTS.md: navigation filtering is cosmetic, the DAL
decides).

### Money and correctness

- Totals through `src/lib/money.ts`. **Never sum across currencies** — `money.ts` refuses
  cross-currency arithmetic for good reason. Show per-currency figures side by side; do not
  invent an FX rate, which is a decision nobody has taken (see the vendor README's V-series
  for the same trap).
- Sum from **frozen order lines** (§61), never from live product prices.
- A `$group` aggregation is the right tool and will be the first in the codebase — put it in
  a service (`src/services/reporting/` or beside `queues.ts`), not in a page (§82).
- These are uncached I/O in a page shell: `<Suspense>` per group, guard first (AGENTS.md).
- Index the aggregation's filter fields; `npm run db:explain:queues` is the pattern for
  proving it at volume.

### Explicitly out of scope

A reporting layer: time-series charts, cohorts, funnels, per-product revenue breakdowns,
date-range pickers, CSV export. Named here so it is a later decision rather than scope creep
inside this one. If it is wanted, it is its own ticket with its own aggregation design —
and `src/services/reporting/` is where it would go.

## Acceptance criteria

- [ ] `/staff/dashboard` and `/admin/dashboard` resolve rather than 404.
- [ ] `/staff` leads with what needs attention; the queue board is still the main content
      and every counter still clicks into the queue it counts.
- [ ] `/admin` shows revenue, orders, catalogue and job health above the index.
- [ ] Counters and queues never disagree — one shared definition, as ticket 20 established.
- [ ] Overdue is derived from `dueAt`, matching ticket 23.
- [ ] No figure sums two currencies; each is shown per currency.
- [ ] A role sees no figure summarising a section it cannot open, verified for `finance`,
      `support_agent`, `content_manager` and `devops`.
- [ ] Totals come from frozen order lines and do not move when a product is repriced.
- [ ] The page renders its shell before the aggregations resolve.

## Root cause

Not a defect — a scope boundary. Ticket 20 built §32's queues, which is what customer
service needs hour to hour, and `/admin` was consciously left an index. §31's dashboard is
in the spec; §95's observability was scoped to logs, health and alerts (ticket 27), not to
business reporting. Nobody has needed a revenue figure until somebody looked for one.
