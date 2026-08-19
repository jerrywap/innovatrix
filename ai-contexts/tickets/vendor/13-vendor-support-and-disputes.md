# 13 — Vendor Support & Disputes

**Bucket:** §20.13 · **Depends on:** vendor 04, 12; tickets 13, 21 · **Blocks:** — · **Size:** M
**Spec:** §37 (ticket communication — internal notes never reach a customer), §38 (unified communication architecture), §67 (maintenance & support), §62 (refunds), §90 (audit), §39 (follow-ups)

## Why
When the platform sold everything, support was one conversation between a
customer and Innovatrix. With vendors there are three parties, and the question
"who answers this" has to have an answer before the first customer asks. §37's
rule — an internal note must never reach a customer — now has a second edge:
what staff say about a vendor must not reach the vendor either.

## Scope

### Threads on the existing model

Ticket 21 already has one `Conversation` + `Message` model across requests,
orders and quotes, with `visibility` on the message and an audience-shaped
loader. A vendor support thread is a fourth subject type, not a second system.

The discipline it inherits is the important part: **the loader takes an audience
and the payload for that audience contains nothing the audience may not see**.
Filtering in the component is what leaks; a customer's payload simply has no
internal message in it. Vendors get the same treatment as a third audience.

| Message visibility | Customer | Vendor | Staff |
|---|---|---|---|
| `customer` | ✓ | ✓ | ✓ |
| `vendor` | | ✓ | ✓ |
| `internal` | | | ✓ |

`internal` now means staff-only, and that includes hiding it from the vendor.
A staff assessment of a vendor's responsiveness is exactly the note that must
not reach them.

> **Implemented 2026-08-17 — a third audience, not a third filter.**
> `MESSAGE_VISIBILITIES` gained `vendor`, and the audience became a union
> (`"customer" | "vendor" | "staff"`) rather than the boolean it could have
> stayed. `visibilityFilter()` in the repository is the single query fragment
> both the thread read and the unread count use, so the two cannot disagree —
> which matters because a note bumping a customer's unread count tells them a
> note exists even if they never see it.
>
> All three layers of §37's boundary extend rather than bend:
>
> 1. **Query** — `visibilityFilter` is in the `find`, not applied after it.
> 2. **A function per audience** — `vendorThread()` alongside `customerThread()`
>    and `staffThread()`, so a vendor-facing caller has no audience argument to
>    get wrong.
> 3. **A type per audience** — `VendorMessage` has no `visibility` field, so an
>    internal message cannot be serialised into a vendor payload even if the
>    first two failed. It carries a derived `visibleToCustomer` boolean instead,
>    which is the whole of what a vendor needs to know.
>
> A vendor's own `internal` is coerced to `vendor`, because since `internal`
> means staff-only they would be writing a note they could not read back.

### Who answers first

The vendor. They wrote the software, and routing every question through staff
who have not seen the code helps nobody. A thread opens against the vendor with
staff as observers.

Escalation to platform staff when: the vendor does not respond within the SLA,
the customer asks for it, the vendor asks for it, or the thread becomes a refund
or a dispute. Escalation adds staff as participants; it does not remove the
vendor, because the person who can actually fix it is still the person who wrote
it.

### Either party may raise a dispute, and staff are told either way

Support is a question; a dispute is a claim that something is wrong and needs
deciding. **Both the customer and the vendor can raise one**, on an existing
thread or as a new one, and raising it is what pulls staff in — not an escalation
somebody has to notice is due.

| Raised by | Typically | Staff role |
|---|---|---|
| Customer | not as described, does not work, refund refused | decide |
| Vendor | abusive or fraudulent buyer, licence misuse, a review they believe breaches policy | decide |

> **Implemented 2026-08-17 — `Conversation.dispute`, and the thread is the record.**
> Raising one sets `escalatedAt` in the same update, so "raising it pulls staff
> in" is one write rather than a second step somebody could omit. A second open
> dispute on the same thread is refused: the other party's position belongs *in*
> the conversation as a message, not as a competing dispute about the same
> argument.
>
> `$set` on the whole subdocument replaces it, with no `$unset` of the old
> outcome fields alongside — MongoDB refuses `$set` on a path and `$unset` on its
> child in one update, which is how the first version failed loudly rather than
> quietly.

A dispute is a state on the thread rather than a fourth subject type — the
conversation is already there and splitting it would mean two records of one
argument. Raising it notifies staff immediately, adds them as participants, and
creates a follow-up so it cannot sit unread; the thread stays visible to whichever
of the two parties raised it and to the other, because a dispute neither party can
see the progress of is one they will re-raise by email.

Any active vendor member may raise or answer a dispute (vendor ticket 03) — this
is not owner-only. The person who knows why the software behaved that way is
whoever wrote it, and gating it on the account holder is how a Friday becomes a
Monday.

> **Implemented 2026-08-17 — recording the decision does not perform it.**
> `resolveDispute` requires an outcome *and* a reason, guards on the current
> status so two reviewers produce one decision, closes the follow-up, and tells
> both parties. What it deliberately does **not** do is carry the outcome out: a
> refund, a delisting, a review removal and a suspension each have their own
> service, permission and audit row, and a resolver that triggered them would be
> a second way into all four. The screen says so under the control, so nobody
> assumes a refund has gone out.
>
> `no_action` is in the outcome enum for a reason: a dispute decided in the
> vendor's favour is a real decision, and without it a reviewer's only choices
> would be to act or to leave the thread open — which is exactly how a dispute
> goes quiet.

Staff resolve it explicitly: an outcome, a reason, and whatever action follows —
refund, delisting, review removal, vendor suspension, or nothing. Recorded on the
thread, audited, and each party told what was decided. A dispute that simply goes
quiet is the failure mode this structure exists to prevent.

### Response SLA

A target, per verification level, shown to the customer before they open a
thread so the expectation is set rather than discovered. Time-to-first-response
is measured and feeds the operational signals on vendor ticket 12's staff view —
distinct from the rating, which is customer opinion. A vendor may be well rated
and slow.

> **Implemented 2026-08-17 — hourly, not daily, and the reason is arithmetic.**
> The targets are 24 and 48 hours (`SLA_HOURS`, from the verification level), so
> a daily sweep would report a breach up to a day late — on a 24-hour target that
> is a 100% margin of error. The query is `{responseDueAt, firstVendorResponseAt}`-
> indexed and finds nothing most hours.
>
> `firstVendorResponseAt` is stamped with `$min` by the vendor's first
> **customer-visible** reply. A note to us is not an answer to the buyer, and
> letting one stop the clock would report a response time nobody experienced.

An overdue thread creates a follow-up for staff, reusing ticket 20's `FollowUp`
model and the daily reminder sweep from ticket 25 — the `{status, dueAt}` index
already exists for exactly this shape of query.

### Refund requests

A customer asks through the thread. The platform decides, because the platform
is merchant of record and took the payment (decision **V4**) — a vendor cannot
approve or refuse a refund of money they never held.

An approved refund runs the existing `processPaymentRefunded` path, which
suspends rather than revokes the entitlement, and writes the negative ledger
entry from vendor ticket 08. The vendor is told, with the reason, because a
refund reduces their balance and a balance change they cannot account for is
the first thing they will ask about.

A refund **rate** per vendor is an operational signal, not a punishment: it goes
on the staff view and informs conversations, and no automatic consequence
attaches to it.

### Takedown

A claim that a product infringes copyright or licence terms. It needs a defined
path because the alternative is an ad-hoc decision under time pressure:

1. Claim received and recorded, with the claimant and the specific allegation.
2. Product delisted immediately where the claim is credible — vendor ticket 12's
   emergency delisting, entitlements suspended rather than revoked.
3. Vendor notified with the claim and a window to respond. Their submission
   attestation (vendor ticket 05) is the record this is weighed against.
4. Resolution: reinstate, permanent removal, or vendor offboarding.
5. Affected customers told what happened and what they are owed.

Every step audited. A takedown is the thing most likely to be litigated, and the
audit log is append-only precisely so that its record is worth something.

### What a customer sees

One place. Their request threads, their order threads and their vendor threads
are the same inbox, because a customer should not have to work out which of
three parties owns their problem before they can ask about it (§38, §101).

## Out of scope
A full ticketing system with SLA tiers and escalation matrices — already
deferred post-MVP for the platform's own support, and no more justified here.
Vendor-to-vendor communication. Automated takedown processing.

## Acceptance criteria
- [x] A vendor support thread uses the existing conversation model, not a second one.
- [x] A customer never receives an `internal` message — not in the page, the payload, or a notification.
- [x] A **vendor** never receives an `internal` message, and this is asserted separately from the customer case.
- [x] A `vendor`-visibility message reaches the vendor and staff and never the customer.
- [x] A vendor can only see threads about their own products, asserted in the tenant-isolation suite.
- [x] A thread opens against the vendor with staff able to observe.
- [x] Escalation adds staff without removing the vendor.
- [x] Both a customer and a vendor can raise a dispute, and either one notifies staff and creates a follow-up.
- [x] Any active vendor member can raise and answer a dispute; it is not owner-only.
- [x] A dispute cannot be closed without an outcome and a reason, and both parties are told what was decided.
- [x] A raised dispute is visible to both parties, not only to the one who raised it.
- [x] An overdue thread creates a staff follow-up through the existing model and reminder sweep.
- [x] Time-to-first-response is measured per vendor and visible to staff.
- [x] A vendor cannot approve or refuse a refund.
- [x] An approved refund suspends rather than revokes the entitlement and writes the negative ledger entry.
- [x] The vendor is notified of a refund and its reason, and can reconcile it against their balance.
- [x] A takedown claim records the claimant and the allegation, and every step is audited.
- [x] A delisted product's existing customers keep their downloads unless the resolution says otherwise.
- [x] A customer sees request, order and vendor threads in one inbox.

## Implementation notes — 2026-08-17

**The thread's subject is the entitlement.** One choice, three jobs: the scope check is the same
indexed `organizationId` filter every other thread uses, a customer can only open a thread about
something they actually bought (no second rule needed), and the vendor is derivable from the
product. It also makes open-and-reply the same operation, since the conversation's unique
`(subjectType, subjectId)` index means the second message continues the first thread.

**`VendorSupportThreadOpened` fires only on the first message.** A vendor notified "a question
about X" on every reply learns to ignore the notification; the reply itself already produces a
`MessagePosted`.

**A second question does not restart the response clock.** `responseDueAt` is set only when unset
or when the previous cycle was answered — otherwise a customer chasing an unanswered thread would
push the deadline out by asking again.

**"An approved refund suspends rather than revokes" was already true.** `processPaymentRefunded`
takes that position (vendor ticket 08 attached the negative ledger entry to it), so the refund half
of this ticket is a *route in* rather than new behaviour: `requestRefund` records the ask as a
dispute so staff are pulled in, and `assertNotVendorRefund` is the structural guard that fails
loudly if somebody adds a vendor-facing refund action by copying a staff one.

**Takedown: receiving and delisting are separate steps, deliberately.** A claim is not a finding,
and a system that delisted on receipt is one where a competitor takes a product down by emailing
us. Step 1 records the claim whether or not step 2 follows; step 2 goes through vendor ticket 12's
`emergencyDelist`, so entitlements are **suspended, not revoked** by the same one decision.

**The allegation is copied into the audit row as well as onto the claim.** The claim document is
mutable by design — its status moves — and §90's append-only copy is what proves what was alleged
and when. A takedown is the thing most likely to be litigated.

**Every reason a party reads is stored verbatim and rendered escaped.** Dispute details, outcome
reasons and takedown allegations are all attacker-influenced text shown to the other party; none of
it goes near `dangerouslySetInnerHTML`.
