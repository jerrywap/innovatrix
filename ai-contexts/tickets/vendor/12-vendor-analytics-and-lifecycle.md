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

### `/vendor` — the dashboard

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

## Out of scope
Vendor-configurable analytics, data export, and a vendor-facing API. Cohort or
funnel analysis beyond view-to-purchase.

## Acceptance criteria
- [ ] The vendor dashboard leads with items needing action, not with figures.
- [ ] Every figure is derived from the ledger, orders or reviews, with no stored counter that can drift.
- [ ] Every analytics read is bounded and time-boxed; none scans an unbounded collection.
- [ ] Traffic figures are either real or absent — no placeholder number is displayed.
- [ ] Suspending a vendor unlists their products and stops new sales within the cache window.
- [ ] Suspending does not touch any existing entitlement, and an existing customer's download still works.
- [ ] Suspending holds payouts and leaves the ledger intact.
- [ ] Reinstating restores listings with their URLs and reviews intact.
- [ ] Offboarding leaves every entitlement active and every licence key valid.
- [ ] An offboarded vendor's customers can still download every version they were entitled to.
- [ ] Offboarding runs final settlement and closes the ledger without deleting a single entry.
- [ ] Customers holding an entitlement are notified when their vendor offboards, and told what it means.
- [ ] Emergency delisting removes a product from the marketplace in one action and suspends rather than revokes entitlements.
- [ ] Every lifecycle action is audited with actor and reason.
- [ ] A vendor sees only their own analytics, asserted in the tenant-isolation suite.
