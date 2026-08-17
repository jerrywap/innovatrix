# 12 — Vendor Analytics & Lifecycle

**Bucket:** §20.12 · **Depends on:** vendor 08, 09, 10 · **Blocks:** — · **Size:** M
**Spec:** §64 (my software — the entitlements that must survive), §66 (downloads), §90 (audit), §94 (performance — no unbounded reads), §95 (observability), §102 (action-oriented dashboards)

## Why
Two questions with one answer between them. A vendor needs to know how their
products are doing, and the platform needs to be able to remove a vendor without
harming the customers who already bought from them. The second is the one that
must be settled before the first vendor is onboarded, because getting it wrong
is discovered at the worst possible moment.

## Scope

### `/dashboard/selling` — the vendor's own dashboard

§102: a dashboard leads with what needs doing, not with a number. So the top of
the page is submissions awaiting changes, unanswered reviews, unanswered support
threads, and anything blocking a payout — then the figures.

| | |
|---|---|
| Money | Cleared balance, pending balance, next payout date, last payout |
| Sales | Units and net earnings by product and period |
| Traffic | Storefront and product views, and view-to-purchase conversion |
| Delivery | Downloads by version — which is how a vendor learns an update is not being taken up |
| Quality | Rating, review count, refund rate |

Every figure is derived from the ledger, the orders, or the reviews. None is a
second source of truth (§103), and none is a stored counter that can drift from
what it counts.

Reads are bounded and time-boxed (§94). A vendor analytics page that scans every
order for a busy product is the query that takes the marketplace down at the
worst time, and the platform has already had to bound the notification
recipient reads for the same reason.

### Traffic needs something that does not exist

There is no product-view counter. `SearchLog` records searches, and
`Product.orderCount` counts orders, but nothing counts a page view. A view
metric therefore needs a lightweight, sampled, privacy-respecting counter —
aggregated per product per day, no per-visitor record — or the ticket says
plainly that traffic figures are not available yet. **It does not stub a number
that looks real.**

### Suspension

Staff-initiated, reversible, with a reason the vendor sees.

| | Suspended |
|---|---|
| New sales | stopped — products unlisted from the marketplace |
| Existing entitlements | **untouched** |
| Downloads for existing customers | **keep working** |
| Payouts | held |
| Vendor workspace | read-only, plus support threads |

Unlisting is not unpublishing: the products keep their URLs and their reviews so
that reinstating is one action, not a rebuild.

> **Implemented 2026-08-17 as `Product.listingSuppressed`.**
> The product keeps `status: "published"`, its slug, its `publishedAt` and its
> reviews; the marketplace pipeline excludes it with `$ne: true` and
> `cart-service` refuses the line. Two details worth keeping:
>
> - **`$ne: true`, not `false`.** The flag is absent on every first-party product
>   and on every product of a vendor in good standing, so a `false` match would
>   exclude the entire catalogue — a filter bug that looks like an empty database.
> - **The cart check is what makes "new sales stopped" true.** The listing filter
>   only hides it; a customer with the URL could still have bought it, because the
>   status is deliberately still `published`.

### Offboarding, and the promise it must keep

Decision **V8**, and the answer is that **a customer who bought never loses what
they bought**. Their entitlement stays active, their licence key stays valid,
and their downloads keep working — which is possible only because vendor
ticket 06 mirrors every artefact into the platform's own bucket. A delivery
model that redirected to the vendor's server could not make this promise, and
that is the strongest argument for the one it chose.

What ends: new sales, the storefront, and the vendor's access. What continues:
entitlements, downloads, licence validity, and the support obligation, which
transfers to platform staff (vendor ticket 13).

Final settlement runs first: cleared balance paid, pending balance paid or
reversed as it clears, and the ledger closed rather than deleted. §90's
append-only discipline covers the ledger for the same reason it covers the audit
log — a vendor relationship that ended in a dispute is one whose records are
read later.

Customers holding an entitlement are told the product is no longer supported by
its vendor and what that means for them. Silence here is how a customer
discovers it by needing help.

### Emergency delisting

Immediate removal from the marketplace, on one staff action, for a product found
to be malicious or infringing — ahead of any process, with the process
following. Entitlements are **suspended rather than revoked**, because a
customer who paid for something later found to be stolen is owed a refund
conversation, not a silent lockout. Vendor ticket 13 covers what happens next.

### Staff view

`/admin/vendors` — the list with status, verification, product count, balance
and refund rate; the detail with the ledger, the products, the review history and
the lifecycle controls. Every lifecycle action is audited with its reason.

> **Implemented 2026-08-17 on `/staff/vendor-applications/[id]`**, as a Lifecycle
> section beside the Money section vendor ticket 08 added. There is still no
> `/admin/vendors` module, for the reason recorded in ticket 08: that screen is
> already where a vendor is administered, and a second route showing the same
> vendor would be two places to look and two to keep in step.
>
> Three permissions, and the split is the safeguard: `vendor.suspend` sits with
> `marketplace_manager` (a vendor shipping something harmful cannot wait for a
> finance sign-off), `vendor.offboard` is `super_admin` only (irreversible, and it
> happens with money still owed), and an emergency delisting reuses
> `product.publish` — pulling one product from sale is the publish capability used
> in the other direction.
>
> Offboarding is behind a **typed confirmation** rather than a second click, since
> `VENDOR_TRANSITIONS` has no edge out of `offboarded` and a second click is not a
> meaningful confirmation for something that cannot be undone.

## Out of scope
Vendor-configurable analytics, data export, and a vendor-facing API. Cohort or
funnel analysis beyond view-to-purchase.

## Acceptance criteria
- [x] The vendor dashboard leads with items needing action, not with figures.
- [x] Every figure is derived from the ledger, orders or reviews, with no stored counter that can drift.
- [x] Every analytics read is bounded and time-boxed; none scans an unbounded collection.
- [x] Traffic figures are either real or absent — no placeholder number is displayed.
- [x] Suspending a vendor unlists their products and stops new sales within the cache window.
- [x] Suspending does not touch any existing entitlement, and an existing customer's download still works.
- [x] Suspending holds payouts and leaves the ledger intact.
- [x] Reinstating restores listings with their URLs and reviews intact.
- [x] Offboarding leaves every entitlement active and every licence key valid.
- [x] An offboarded vendor's customers can still download every version they were entitled to.
- [x] Offboarding runs final settlement and closes the ledger without deleting a single entry.
- [x] Customers holding an entitlement are notified when their vendor offboards, and told what it means.
- [x] Emergency delisting removes a product from the marketplace in one action and suspends rather than revokes entitlements.
- [x] Every lifecycle action is audited with actor and reason.
- [x] A vendor sees only their own analytics, asserted in the tenant-isolation suite.

## Implementation notes — 2026-08-17

**"Offboarding runs final settlement" became "offboarding reports what is owed".** The service
does **not** run a payout, and it does not refuse when money is outstanding — a vendor we cannot
offboard over £4 is a vendor still selling. It returns the outstanding balance per currency, the
screen shows it as work still to do, and the ledger is closed with `closedAt` rather than having a
single entry touched. Final settlement is a payout somebody runs through vendor ticket 09's
machinery, which is the only place that can actually move money.

**Suspending holds payouts through the batch, not through a flag.** `draftBatch` already skips a
suspended vendor with `reason: "suspended"` and records it where the vendor can read it, so
suspension needed no new payout logic at all — which is what the skip-reason design bought.

**Cache invalidation moved out of the service.** The first version called `catalogChanged()` from
`lifecycle-service`, and `revalidateTag` throws outside a Next request context — so the service
could not be called from a job, a script or a test. Each function now returns the slugs it
touched and the action invalidates, which is what every other write path in the codebase does.

**An emergency delist suspends the entitlement and leaves the licence alone.** Suspending the
licence too would pre-empt the refund decision, and `processPaymentRefunded` is the path that
suspends both — this one stops the sale and starts a conversation.

**`VendorOffboarded` resolves its audience from product ids.** One event, many products,
deduplicated by organisation: a customer who bought three of that vendor's products is told once,
and the notification leads with what *survives* rather than with what ended.

**Unanswered reviews are counted only at three stars or below.** A dashboard that said "you have
240 unanswered reviews" would teach a vendor to ignore the whole action panel, and a five-star
review with no reply is not a task.
