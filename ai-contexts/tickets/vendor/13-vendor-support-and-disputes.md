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

### Who answers first

The vendor. They wrote the software, and routing every question through staff
who have not seen the code helps nobody. A thread opens against the vendor with
staff as observers.

Escalation to platform staff when: the vendor does not respond within the SLA,
the customer asks for it, the vendor asks for it, or the thread becomes a refund
or a dispute. Escalation adds staff as participants; it does not remove the
vendor, because the person who can actually fix it is still the person who wrote
it.

### Response SLA

A target, per verification level, shown to the customer before they open a
thread so the expectation is set rather than discovered. Time-to-first-response
is measured and feeds the operational signals on vendor ticket 12's staff view —
distinct from the rating, which is customer opinion. A vendor may be well rated
and slow.

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
- [ ] A vendor support thread uses the existing conversation model, not a second one.
- [ ] A customer never receives an `internal` message — not in the page, the payload, or a notification.
- [ ] A **vendor** never receives an `internal` message, and this is asserted separately from the customer case.
- [ ] A `vendor`-visibility message reaches the vendor and staff and never the customer.
- [ ] A vendor can only see threads about their own products, asserted in the tenant-isolation suite.
- [ ] A thread opens against the vendor with staff able to observe.
- [ ] Escalation adds staff without removing the vendor.
- [ ] An overdue thread creates a staff follow-up through the existing model and reminder sweep.
- [ ] Time-to-first-response is measured per vendor and visible to staff.
- [ ] A vendor cannot approve or refuse a refund.
- [ ] An approved refund suspends rather than revokes the entitlement and writes the negative ledger entry.
- [ ] The vendor is notified of a refund and its reason, and can reconcile it against their balance.
- [ ] A takedown claim records the claimant and the allegation, and every step is audited.
- [ ] A delisted product's existing customers keep their downloads unless the resolution says otherwise.
- [ ] A customer sees request, order and vendor threads in one inbox.
