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

> **Implemented 2026-08-17 — the claim happens at *draft*, not at payment.**
> The ticket's idempotency section says entries move to `paid` inside the paying
> transaction, and they do. But that alone leaves a hole the ticket does not
> name: two payouts in different periods can both *list* the same cleared entry,
> and only the second one discovers it at confirmation time — as a failure,
> after somebody approved it. So a draft also stamps `payoutId` on the entries it
> claims, guarded on them being unclaimed, and `unclaimedCleared` is what a batch
> reads. The status still changes only when the transfer settles, which is what
> keeps a failed transfer from stranding anything.
>
> `reference_external` in the sketch above is `externalReference` in the code —
> the surrounding codebase has no snake_case field anywhere, and a lone one would
> be a trap for the next person writing a query.

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

> **Implemented 2026-08-17 — `manual` is a real driver here, unlike inbound.**
> `payments/registry.ts` **throws** for `driverFor("manual")`, because a bank
> transfer *in* has no provider and asking for one is a bug in the caller.
> Outbound is the other way round: inbound, the customer acts and we react;
> outbound, *we* act, and there is a genuine sequence — instruct, wait, confirm —
> whoever performs it. Making `manual` a driver puts that sequence in the service
> for every method, and its `send()` reports `sent` rather than pretending
> anything moved.
>
> `verify()` answers "still sending", truthfully. So the stuck-payout sweep
> surfaces a manual payout for a person instead of resolving it — for a manual
> payout, the person *is* the provider.

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

> **Implemented 2026-08-17 — daily job, monthly cadence, rolling period.**
> The job runs daily and asks "has this period been drafted"; the unique
> `(vendorId, periodStart, periodEnd)` index answers it. A monthly schedule would
> mean one missed run delays every vendor by a month.
>
> The period is a **rolling window normalised to whole UTC days**, not a calendar
> month: "the 1st" needs a timezone argument nobody has settled and produces a
> period whose length changes in February, and the boundaries are what the index
> dedupes on — so a batch run twice in a day must produce the *same* period
> rather than two that differ by minutes.
>
> The threshold is **per currency and never converted** (`payoutThresholds` on
> `PaymentSettings`, defaulting to `DEFAULT_PAYOUT_THRESHOLD_MINOR = 5000`). One
> number cannot serve GBP and NGN, and choosing a rate to make it would be
> decision **V5** taken by accident. A vendor earning in two currencies gets two
> payouts.

A vendor is skipped, with the reason recorded and visible to them, when:

- business verification is incomplete (vendor ticket 02 — money must not leave
  to an unverified account)
- the balance is below the threshold
- the balance is negative
- the vendor is suspended

"Skipped and told why" is the requirement. A vendor who has been silently
excluded from three runs has no way to discover it.

> **Implemented 2026-08-17 as a `PayoutSkip` collection**, one row per vendor per
> period, upserted so a re-run overwrites the reason rather than appending. Not a
> log line, because a vendor cannot read our logs; not a cancelled `Payout`,
> because a cancellation is a payout somebody *decided* not to send, while a skip
> is one that was never eligible — and reusing the row would occupy the unique
> period index and make "we could not pay you" look like "we cancelled your
> payment". `PAYOUT_SKIP_REASONS` is a closed set with copy per reason that says
> what would change it; `/dashboard/selling/payouts` shows the latest one.

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

> **Implemented 2026-08-17 — derived, with no statement collection.**
> "Immutable once paid" is true *because* nothing is stored: a paid payout's
> `entryIds` never change, ledger entries are append-only, and the order lines
> behind them were frozen at checkout (§61), so re-rendering next year produces
> the same document. Storing a rendered copy would add a second source of truth
> whose only advantage is already guaranteed by the data.
>
> The gross and the commission on each line are **recomputed** from the frozen
> order line with the rate snapshotted at checkout; the entry holds the vendor's
> net. That is what makes a line reconcile against the ledger *and* against the
> order — storing all three would let them drift. `statementReconciles()` asks
> the question in one call, and the staff screen shows the answer rather than
> only asserting it in a test.
>
> Tax: `NO_WITHHOLDING_NOTE` is on the document's face. Decision **V5** is still
> open, and a statement silent about withholding invites a vendor to assume
> whichever answer suits them.

### Failure

A failed transfer returns the payout to `approved` and the entries to `cleared`,
with the reason on both. Nothing is lost, nothing is stranded, and the next batch
picks it up. A payout stuck in `sending` past a threshold raises the same kind of
alert as a payment pending too long.

> **Implemented 2026-08-17 — `sending → failed → approved` in one call.**
> The state machine keeps both edges, because "failed" is a fact about an attempt
> and "approved" is where the payout now sits; both are audited. The entries need
> no putting back: they never left `cleared`, and the claim stays, so a retry pays
> exactly the same entries rather than a recomputed set that may have drifted. A
> payout that should not be retried is cancelled by a person, which releases the
> claim.
>
> The "alert" is a `log.warn` per stuck payout from `reconcile-sending-payouts`
> plus the count on `/admin`. There is no alerting transport in the platform —
> the log and `/admin/jobs` are the channel every other sweep uses — so this is
> named rather than claimed to be more than it is.

## Out of scope
Automated provider transfers, currency conversion at payout, and vendor-initiated
withdrawals. The last is deliberate: a pull model needs stronger authentication
on the vendor side than an invitation-based team account currently has.

## Acceptance criteria
- [x] A payout references exactly the ledger entries it settles, and their sum equals its amount.
- [x] An entry cannot appear in two payouts, enforced by the transaction rather than by a check.
- [x] Re-running the batch job produces one draft per vendor per period, not two.
- [x] A vendor without business verification is skipped, and can see that they were skipped and why.
- [x] A vendor below the threshold or with a negative balance is skipped with a reason.
- [x] A suspended vendor is skipped.
- [x] The vendor's payout account is unreadable and unwritable by a `member`, in the action and not only in the UI.
- [x] `draft → approved` requires a human with the payout permission; no code path approves automatically.
- [x] A failed transfer returns the payout to `approved` and its entries to `cleared`, with the reason recorded.
- [x] A retried confirmation of an already-paid payout changes nothing.
- [x] The payout reference uses its own prefix and does not collide with inbound payments.
- [x] A statement is immutable once the payout is paid.
- [x] Statement line items reconcile against the ledger entries and against the original order lines.
- [x] Remittance evidence is readable only by staff with the permission and by the vendor it belongs to, through a signed short-lived URL.
- [x] A payout stuck in `sending` beyond the threshold raises an alert.
- [x] Every state change is audited with the actor, and a `manual` payout records which staff member sent it.

## Implementation notes — 2026-08-17

**Three permissions, not one.** `payout.view_all`, `payout.approve`, `payout.send`. The split
is the control: an organisation that wants two pairs of eyes on money leaving grants approve
and send to different people, and one that does not grants both to finance. `marketplace_manager`
gets `payout.view_all` only — fielding "when do I get paid" needs the answer, not a part in
releasing it. Verified over HTTP.

**The evidence route has two audiences.** Unlike `/api/payment-evidence`, the remittance advice
has a legitimate non-staff reader: the vendor being paid. So `/api/payout-evidence/[payoutId]`
admits staff with `payout.view_all` **or** an active member of the owning vendor, and answers
**404** for a vendor asking about somebody else's payout — a 403 would confirm it exists.

**The payout account is owner-only on both sides, and masked everywhere else.** The stored
identifier is never pre-filled into the form and never crosses the RSC boundary: the settings
page masks it server-side to the last four characters. Changing it holds payouts by returning
business verification to `pending`, and unpublishes nothing — the softest gate that still
means something, same shape as ticket 07's agreement gate. An attacker with a vendor session
gets a held payout and a re-verification queue item, not a transfer.

**A skip row is only written when *nothing* drafted for that vendor.** A vendor paid in GBP and
short of the threshold in NGN has been paid; telling them they were skipped would be false.

**`/admin/payouts` orders drafts first.** A draft is money we owe and have not released;
everything else is already in motion. Putting the work at the top is what stops a batch sitting
unapproved for a fortnight because nobody scrolled.
