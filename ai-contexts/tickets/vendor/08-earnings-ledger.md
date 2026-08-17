# 08 — Earnings Ledger

**Bucket:** §20.8 · **Depends on:** vendor 07; tickets 11, 13 · **Blocks:** vendor 09, 12 · **Size:** L
**Spec:** §61 (orders), §62 (payments — inbound only today), §84 (money), §90 (audit — append-only), §91 (state machines), §103 (the database is the source of truth)

## Why
There is no ledger, balance, payee or payout anywhere in the platform. Money is
strictly inbound: `PaymentProvider` is `["stripe","paystack","paypal","manual"]`
and every one of them collects. Once a vendor is owed money, the platform needs
to be able to answer *how much, for what, and when it became payable* — and to
answer it the same way twice, six months apart, after a refund.

## Read first
`processPaymentSucceeded()` in `src/services/payments/fulfilment.ts`. Everything
this ticket writes goes inside its existing transaction, and the three
idempotency guards already in it — the payment status claim, the order status
claim, and the unique index on `(orderId, orderLineId)` — are what stop a
retried webhook paying a vendor twice.

## Scope

### Append-only entries, never a mutable balance

```ts
interface LedgerEntryDoc {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  kind: "earning" | "refund" | "adjustment" | "payout";
  amount: MoneyDocument;            // signed: earnings positive, refunds negative
  currency: string;
  status: "pending" | "cleared" | "paid" | "reversed";
  clearsAt?: Date;
  orderId?: Types.ObjectId;
  orderLineId?: string;
  payoutId?: Types.ObjectId;
  note?: string;                    // required on an adjustment
  createdAt: Date;
}
```

A balance is **derived by summing entries**, never stored. A stored balance is a
number that can disagree with its own history, and the first time it does the
disagreement is unresolvable. The audit log already takes this position —
append-only, enforced on the model — and money deserves at least that.

Unique on `(orderId, orderLineId, kind)`: the same index shape that already
stops duplicate entitlements, doing the same job for duplicate earnings.

### Written inside fulfilment's transaction

When `processPaymentSucceeded` writes entitlements and licences, it also writes
one `earning` per vendor order line, using the rate **snapshotted on the line**
(vendor ticket 07) rather than resolving one.

Inside the transaction, because a payment that committed without its earning is
a vendor silently not paid, and no sweep can reliably find it later. This is the
same argument the audit log makes for throwing when given a session.

An offline bank transfer recorded by staff runs the identical path — it already
goes through `processPaymentSucceeded` with `skipVerification`, which is why the
platform-as-merchant-of-record decision works with a payment method that has no
provider behind it at all.

### Clearance

An earning is `pending` until `clearsAt`, then `cleared`. The period is decision
**V2** and must exceed the refund window (main decision #5), because paying out
money that is still refundable turns a refund into a debt.

> **Implemented 2026-08-17 — this ticket had to introduce the refund window itself.**
> The 14-day window existed **only as prose**: no constant, no setting, nothing anywhere in
> `src/`, and `/terms` deliberately states no number of days. Two numbers cannot be kept in
> a relationship when one of them is a sentence in a markdown file, so `REFUND_WINDOW_DAYS
> = 14` now sits beside `CLEARANCE_DAYS = 30` in `ledger-service.ts` with a module-load
> assertion that the second exceeds the first — getting it wrong is a boot failure rather
> than a vendor paid out of money we then have to claw back. If the policy window ever
> becomes configurable, that constant is where it plugs in.

A scheduled job moves entries whose time has come — one row in `SCHEDULE`, the
same shape as `mark-invoices-overdue`. Idempotent by construction: the filter is
`status: "pending", clearsAt: { $lte: now }`, so running it twice changes
nothing the second time.

### Refunds claw back

A refund writes a **negative** entry rather than deleting or amending the
original. If the earning is still `pending`, the two net to zero and nothing was
ever payable. If it has already been paid out, the balance goes negative and the
next payout is reduced — recovered from future earnings, not invoiced.

A vendor whose balance is persistently negative is a commercial conversation,
not a code path. The ledger surfaces it; vendor ticket 12 covers what staff do
about it.

`processPaymentRefunded` already exists and suspends rather than revokes
entitlements. This attaches to it.

### Adjustments

Staff-created entries for the cases the automatic path cannot express: a
goodwill credit, a chargeback fee, a correction. Permission-gated, always with a
note, always audited. A ledger without an adjustment path grows a spreadsheet
beside it.

### What a vendor sees (`/dashboard/selling/earnings`)

Balance split three ways — pending, cleared, paid — then entries, filterable,
each linking to the order line that produced it. Every figure through
`<MoneyDisplay>`; never `toFixed`, which is wrong for JPY and is a float
besides.

Statements are per period and immutable once closed, because a statement that
changes after a vendor has read it is worse than no statement.

> **Deferred to vendor ticket 09.** A *statement* is the document that accompanies a
> payment, and vendor ticket 09 already owns "self-billed statement". Building a second,
> earlier statement here would mean two documents describing the same money with different
> period boundaries. What this ticket ships instead is the balance, the entry history and
> the filter — everything a statement would be *derived from*.

Readable by **any** active member, owner or not (vendor ticket 03). A member who
cannot see the balance cannot answer "why did it drop", and the thing worth
restricting is the payout *account*, not the history of what was earned.

### What staff see

`/admin/vendors/[id]/ledger`, the same entries with the adjustment control and
the vendor's payout eligibility.

> **Implemented 2026-08-17 at `/staff/vendor-applications/[id]`, as a "Money" section.**
> There is no `/admin/vendors` module — vendor ticket 01 put the staff vendor screen under
> `/staff/vendor-applications` because `QUEUES` could not take a vendor key, and that screen
> is already where a vendor is administered. A second route showing the same vendor would be
> two places to look. Three permissions gate the section independently, because the roles
> that reach it hold different subsets: `vendor.manage_commission` and `vendor.view_ledger`
> for `marketplace_manager`, `vendor.view_ledger` and `vendor.adjust_ledger` for `finance`.
> Neither is a superset of the other, and nobody should hold all three by accident.
>
> Payout **eligibility** lands with vendor ticket 09, since it is a fact about a payout
> account and a verification level rather than about the ledger. Ledger totals are reconcilable against payment
totals for a period — the check that catches a split arithmetic bug before a
vendor does.

## Out of scope
Payout execution (vendor ticket 09). Multi-currency consolidation — entries
accrue in the order's currency because `money.ts` refuses cross-currency
arithmetic, and converting is decision **V5**.

## Acceptance criteria
- [x] A paid order writes exactly one earning per vendor line, inside the same transaction as the entitlement.
- [x] A rolled-back payment leaves no ledger entry.
- [x] A retried webhook produces one earning, not two — proven against the existing idempotency guards.
- [x] An offline bank transfer recorded by staff produces the same entries as a card payment.
- [x] The split uses the rate snapshotted on the order line, and changing the vendor's current rate does not alter it.
- [x] Platform fee plus vendor earning equals the line total exactly, in every supported currency.
- [x] A balance is derived by summing entries; no balance field is stored anywhere.
- [x] An earning is not payable before `clearsAt`, enforced in the service.
- [x] The clearance sweep is idempotent — running it twice in a day changes nothing extra.
- [x] A refund writes a negative entry; the original is neither deleted nor amended.
- [x] A refund of an already-paid earning produces a negative balance that reduces the next payout.
- [x] An adjustment requires a note and a permission, and is audited.
- [x] Ledger totals reconcile against payment totals for any period.
- [x] A vendor sees only their own entries, asserted in the tenant-isolation suite.

## Implementation notes — 2026-08-17

**Reconciliation recomputes rather than aggregates.** Two `$group` stages comparing a ledger
total against an order total would answer a weaker question — whether two numbers happen to
match. What actually goes wrong is *per line*: a rounding rule that drifts a penny, a line
whose earning was never written, a discount apportioned twice — and a total hides all three
by cancelling them out. So `reconcile()` walks the vendor lines and applies the **same**
`netOfDiscount` and `splitLineTotal` fulfilment used, reporting drift and naming every paid
line with no entry by order reference. It is bounded at 5,000 orders and returns `truncated`
rather than a quietly short answer, because a reconciliation that stopped early and reported
zero drift is worse than none.

**Append-only is enforced on the model, not in a repository.** `LedgerEntry.deleteMany(...)`
never passes through a repository, so the hooks refuse `deleteOne`, `deleteMany` and
`findOneAndDelete`, and `save` refuses amendment of `amount`, `kind`, `vendorId`, `orderId`
and `orderLineId`. `status` deliberately stays mutable — `pending → cleared → paid` is the
whole point. The test suite deletes through the driver rather than relaxing the model.

**A refunded earning that was already paid stays `paid`.** Marking it `reversed` would tidy
the balance and make the payout that sent the money unreconcilable. The balance goes negative
instead, which is the honest answer and what reduces the next payout.

**`reversed` is in none of the three balance buckets.** It and its negative counterpart
cancel; counting both would show a vendor a pending figure including money nobody owes them.

**The unique index is `(orderId, orderLineId, kind)`, partial on `orderId` existing.** `kind`
is in the key because a refund is a *second* row about the same line and must be allowed
while a second earning must not. Partial, because adjustments and payouts have no order line
and would otherwise all collide on `(null, null)`.
