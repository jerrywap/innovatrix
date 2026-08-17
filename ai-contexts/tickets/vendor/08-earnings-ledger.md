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

Readable by **any** active member, owner or not (vendor ticket 03). A member who
cannot see the balance cannot answer "why did it drop", and the thing worth
restricting is the payout *account*, not the history of what was earned.

### What staff see

`/admin/vendors/[id]/ledger`, the same entries with the adjustment control and
the vendor's payout eligibility. Ledger totals are reconcilable against payment
totals for a period — the check that catches a split arithmetic bug before a
vendor does.

## Out of scope
Payout execution (vendor ticket 09). Multi-currency consolidation — entries
accrue in the order's currency because `money.ts` refuses cross-currency
arithmetic, and converting is decision **V5**.

## Acceptance criteria
- [ ] A paid order writes exactly one earning per vendor line, inside the same transaction as the entitlement.
- [ ] A rolled-back payment leaves no ledger entry.
- [ ] A retried webhook produces one earning, not two — proven against the existing idempotency guards.
- [ ] An offline bank transfer recorded by staff produces the same entries as a card payment.
- [ ] The split uses the rate snapshotted on the order line, and changing the vendor's current rate does not alter it.
- [ ] Platform fee plus vendor earning equals the line total exactly, in every supported currency.
- [ ] A balance is derived by summing entries; no balance field is stored anywhere.
- [ ] An earning is not payable before `clearsAt`, enforced in the service.
- [ ] The clearance sweep is idempotent — running it twice in a day changes nothing extra.
- [ ] A refund writes a negative entry; the original is neither deleted nor amended.
- [ ] A refund of an already-paid earning produces a negative balance that reduces the next payout.
- [ ] An adjustment requires a note and a permission, and is audited.
- [ ] Ledger totals reconcile against payment totals for any period.
- [ ] A vendor sees only their own entries, asserted in the tenant-isolation suite.
