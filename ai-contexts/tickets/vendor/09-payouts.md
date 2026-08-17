# 09 — Payouts

**Bucket:** §20.9 · **Depends on:** vendor 02, 08; tickets 12, 25 · **Blocks:** vendor 12 · **Size:** L
**Spec:** §62 (payments — the provider abstraction this mirrors outward), §26 (references), §63 (invoices — the self-billed equivalent), §84 (money), §86 (background jobs), §90 (audit), §91 (state machines)

## Why
The ledger says what a vendor is owed. This is the part where money actually
leaves, and it is the first time in the platform's history that any has. §62's
provider abstraction is entirely inbound — four drivers, all of which collect —
so the outbound side is new and needs the same shape: an interface, drivers
behind it, and no domain state written by any of them.

## Scope

### A payout is a claim on cleared entries

```ts
interface PayoutDoc {
  _id: Types.ObjectId;
  reference: string;                 // a new prefix — PAY is taken by inbound payments
  vendorId: Types.ObjectId;
  amount: MoneyDocument;
  currency: string;
  status: PayoutStatus;
  method: "manual" | string;         // a PayoutProvider key
  periodStart: Date;
  periodEnd: Date;
  entryIds: Types.ObjectId[];        // exactly which entries this settles
  reference_external?: string;       // the bank reference, once sent
  evidenceKey?: string;              // remittance advice, like payment evidence
  failureReason?: string;
}
```

`entryIds` matters: a payout that records only a total cannot be reconciled
against the ledger, and reconciling is the entire reason the ledger is
append-only.

`REFERENCE_PREFIXES` currently holds REQ, CUS, PRJ, CHG, TKT, ORD, INV, QUO and
**PAY** — inbound payments already own PAY, so an outbound one needs its own
(`POU`). The pattern is `[A-Z]{3}` so a new prefix works, and the gapless
per-year counter comes free.

### The state machine

```
draft → approved → sending → paid
              ↘ cancelled  ↘ failed → approved
```

`draft → approved` is a human decision and stays one. Money leaving the platform
on a schedule with nobody looking is not a feature; a batch is prepared
automatically and released deliberately.

### `PayoutProvider`, with one driver

```ts
interface PayoutProvider {
  readonly key: string;
  send(payout: PayoutInstruction): Promise<PayoutResult>;
  verify(externalRef: string): Promise<PayoutStatusResult>;
}
```

Mirroring the payment registry exactly, including the rule that a **driver never
writes domain state** — it talks to the outside and returns a result, and the
service decides what that means.

The one driver at launch is `manual`: staff transfer by bank and record it
against the payout, with the remittance advice attached. This is the same shape
as the offline payment recording that already works end to end, and it means the
whole outbound path is testable without a provider account. Automated transfers
are a driver, not a rewrite.

### The payout account is the owner's, and only the owner's

The vendor's bank details live behind `requireVendorOwner()` (vendor ticket 03) —
read as well as write, so a member cannot copy them out either. This is the one
capability the two-role model exists to separate: a wrong price is reversible and
audited, and a wrong account number is money in a stranger's hands.

Changing the account holds payouts and returns the vendor to re-verification
(vendor ticket 02), without unpublishing anything.

### Building a batch

A scheduled job (one row in `SCHEDULE`) drafts a payout per vendor whose cleared
balance is at or above the threshold, on the configured cadence — decision
**V3**.

A vendor is skipped, with the reason recorded and visible to them, when:

- business verification is incomplete (vendor ticket 02 — money must not leave
  to an unverified account)
- the balance is below the threshold
- the balance is negative
- the vendor is suspended

"Skipped and told why" is the requirement. A vendor who has been silently
excluded from three runs has no way to discover it.

### Idempotency, which is the whole risk

A double payout is the most expensive bug this system can have. Three guards, in
the manner of `processPaymentSucceeded`:

1. Entries move to `paid` **inside** the same transaction that marks the payout
   `paid`, so an entry cannot appear in two payouts.
2. The batch job enqueues with an idempotency key derived from vendor and
   period, so a re-run of the sweep produces one draft.
3. `sending → paid` is a guarded transition on the current status, so a retried
   confirmation cannot re-apply.

### Statements and tax

Each payout produces a **self-billed statement** — the platform issues it on the
vendor's behalf, because the platform is merchant of record (decision **V4**) and
the vendor never invoiced the customer.

Line items reference the order lines that produced the earnings, show the gross,
the commission and the net, and are immutable once the payout is paid.

Tax treatment is decision **V5**. The default is no withholding and the vendor
being responsible for their own; whatever is decided, the statement states it
rather than leaving it implied.

Like quote and invoice documents, the statement is print-styled HTML rather than
a generated PDF — there is no PDF pipeline in the platform and ticket 25
declined to add headless Chrome for one.

### Failure

A failed transfer returns the payout to `approved` and the entries to `cleared`,
with the reason on both. Nothing is lost, nothing is stranded, and the next batch
picks it up. A payout stuck in `sending` past a threshold raises the same kind of
alert as a payment pending too long.

## Out of scope
Automated provider transfers, currency conversion at payout, and vendor-initiated
withdrawals. The last is deliberate: a pull model needs stronger authentication
on the vendor side than an invitation-based team account currently has.

## Acceptance criteria
- [ ] A payout references exactly the ledger entries it settles, and their sum equals its amount.
- [ ] An entry cannot appear in two payouts, enforced by the transaction rather than by a check.
- [ ] Re-running the batch job produces one draft per vendor per period, not two.
- [ ] A vendor without business verification is skipped, and can see that they were skipped and why.
- [ ] A vendor below the threshold or with a negative balance is skipped with a reason.
- [ ] A suspended vendor is skipped.
- [ ] The vendor's payout account is unreadable and unwritable by a `member`, in the action and not only in the UI.
- [ ] `draft → approved` requires a human with the payout permission; no code path approves automatically.
- [ ] A failed transfer returns the payout to `approved` and its entries to `cleared`, with the reason recorded.
- [ ] A retried confirmation of an already-paid payout changes nothing.
- [ ] The payout reference uses its own prefix and does not collide with inbound payments.
- [ ] A statement is immutable once the payout is paid.
- [ ] Statement line items reconcile against the ledger entries and against the original order lines.
- [ ] Remittance evidence is readable only by staff with the permission and by the vendor it belongs to, through a signed short-lived URL.
- [ ] A payout stuck in `sending` beyond the threshold raises an alert.
- [ ] Every state change is audited with the actor, and a `manual` payout records which staff member sent it.
