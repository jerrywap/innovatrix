# 14 — Vendor-Directed Customization

**Bucket:** §20.14 (new) · **Depends on:** vendor 04, 05, 07, 08, 13; tickets 17, 19, 21, 22 · **Blocks:** — · **Size:** L
**Spec:** §15–§20 (customization request, interview, submission — extended to a second party), §34 (customer-confirmed requirements), §37 (visibility), §38 (unified communication), §22/§59 (quotes), §61–63 (money in) — **displaces** `01-mvp-todo.md:37`, which states the flow as `Product → Request Customization → AI Assistant → Request → Staff → Quote → Payment` with staff explicit

## Why

A customer on `/customize/[slug]` can ask for changes to **any** product, and since vendor
ticket 04 some of those products belong to somebody else. The request goes only to the staff
queue: nothing in the request path reads `Product.vendorId`, `CustomerRequest` has no vendor
field, and `request-view.ts` does not even select `vendorId` when it loads the base product.

So a request to adapt a vendor's software is scoped, priced and delivered by people who did
not write it, while the person who did is not told it was asked for. That is the wrong way
round on all three counts — the vendor knows their own code, the vendor is the one who can
say what a change costs, and the vendor is the party whose product is being altered.

### This was never considered, not deferred

Worth stating because the rest of this directory is careful about what it leaves out.
Tickets 17, 19 and 22 contain no occurrence of "vendor" — they predate the vendor set
entirely. Grepping `ai-contexts/tickets/vendor/` for customization finds two hits, both in
vendor tickets 01 and 05, and both arguing the *opposite* point: that `QUEUES` is a registry
of `CustomerRequest` queues and vendor work does not belong in it. The README's "what these
tickets deliberately leave out" lists five things and this is not among them, and none of the
eleven open business decisions covers it — V9 is a *listing* price, V4 is merchant-of-record
on a *purchase*.

## Scope

### The four decisions this ticket rests on

Taken with the business on 2026-08-17, before any code:

| # | Question | Decision |
|---|---|---|
| W1 | Who prices the work | **The vendor.** Vendor-authored pricing, commission on custom revenue |
| W2 | Does the vendor see who asked | **No.** Mediated — requirements and product only |
| W3 | Who sees it first | **Staff triage first**, then it goes to the vendor |
| W4 | How mediation is enforced | **Two threads, staff relay.** Structural, not a visibility flag |

Together they fix the shape: the vendor is a **priced supplier who never meets the buyer**,
staff are the channel and the gate, and the platform stays merchant of record — V4's default
survives, because a mediated relationship *cannot* have the vendor invoicing a customer it
cannot see. The vendor prices the work; the platform issues the quote under its own name and
settles the vendor's share through the vendor ticket 08 ledger.

### Two threads, because one cannot be mediated

Vendor ticket 13 established the three-audience thread, and the temptation is to reuse it
directly. It does not work here, for a reason that is worth writing down rather than
rediscovering:

| Message visibility | Customer | Vendor | Staff |
|---|---|---|---|
| `customer` | ✓ | **✓** | ✓ |
| `vendor` | | ✓ | ✓ |
| `internal` | | | ✓ |

A `customer`-visibility message is visible to the **vendor** by design — that is what makes a
support thread a three-party conversation. There is no level meaning "customer and staff but
not the vendor", and `VendorMessage extends CustomerMessage`, so it carries `senderName` too.
On a shared thread the vendor would read the customer's messages *and* their name.

A fourth visibility level would fix the projection and not the problem: `visibility` defaults
to `customer` on a customer's own message, so one missed case — or one existing request thread
that later gains a `vendorId` — exposes the entire history. And no visibility rule can stop a
customer typing their own phone number into a message body.

So mediation is **structural**:

```
REQUEST THREAD  (subjectType "request")   BRIEF THREAD  (subjectType "vendor_brief")
customer ↔ staff                          staff ↔ vendor

The vendor sees: the brief, and staff messages.
The vendor never sees: the customer's name, their organisation, or anything they wrote.
```

The vendor is not a participant in the customer's conversation at all, so there is nothing in
a message body that *can* leak. `Conversation` has a unique index on `{subjectType, subjectId}`,
so the second thread needs its own subject type — hence `vendor_brief`, keyed by the brief.

### The brief is a copy, not a join

`VendorBrief` holds the requirement list **as the vendor was shown it**, redacted at routing
time, rather than reading through to `CustomerRequest.customerRequirements` on each view. Same
reasoning as vendor ticket 05 versioning the attestation *text* rather than storing a boolean:
in a dispute, "this is what we asked them to price" has to be a fixed record. A join would
silently re-render if the customer revised their requirements, which is exactly the moment the
distinction matters.

A revision is therefore a **new brief**, not an edit — and staff decide whether to send it.

### No new request states, and no new actor on the request

Both worth naming, because both looked like the largest part of this ticket and neither is:

- **`technical_review` already exists.** `under_review → technical_review → {under_review,
  quoted, rejected}`, with the edge already labelled "Send to technical review". *With the
  vendor* is what that state means for a vendor-owned request. `REQUEST_TRANSITIONS` is
  untouched.
- **`TransitionRule` needs no `vendorMay`.** The vendor never moves the customer's request —
  staff take every transition. The vendor acts on the **brief**: replying, and submitting a
  priced proposal. Declining is a proposal outcome, after which staff move the request. So
  `TransitionRule`, `RequestActor` and `RequestStatusChanged.actorType` all stay two-actor,
  which is a real saving against the `PRODUCT_TRANSITION_RULES` precedent from vendor ticket 05.

### What the vendor sees, and what they do not

On `/dashboard/selling/requests`:

- The product, the requirements as sent, the timeline if the customer gave one, and the thread
  with staff.
- **Not** the customer's name, organisation, or user id. Not the customer's own messages. Not
  the quote total the customer is eventually shown — staff may add margin to the vendor's
  figure, and the vendor's proposal is the vendor's number.

### Money

Milestone C, and the part with no existing foundation. `LedgerEntry`'s only provenance fields
are `orderId` + `orderLineId`; `recordEarnings()` filters `order.items`; and `InvoicePaid` never
calls it. A vendor who delivered a customization today would earn nothing, and no `LedgerEntry`
shape could describe it. Custom work arrives through an `Invoice` against a `Quote`, never an
`Order`, so the ledger needs invoice-shaped provenance.

Commission is **snapshotted when the quote is issued**, via the existing
`resolveCommissionForVendor()`, mirroring `OrderLine.commissionBasisPoints` — "resolved at
checkout and never re-read". A deposit and a balance invoice mean an earning can arrive in two
parts, so it is recorded per invoice, not per quote.

## Out of scope

- **Vendor-set delivery.** Who *does* the work after the customer pays is unchanged: staff
  co-ordinate, and the request runs `converted → in_progress → delivered → completed` as it does
  now. This ticket routes the scoping and the pricing, not the project management.
- **Vendor-visible customer identity, ever.** W2 is a decision, not a default.
- **A vendor declining with a counter-offer negotiation loop.** One proposal, then staff relay.
- **Custom-build requests** (`kind: "custom_build"`). Those have no base product and therefore
  no vendor.

## Acceptance criteria

- [ ] A customization request against a vendor-owned product carries that vendor, resolved from the product at submission.
- [ ] A customization against a first-party product is unchanged, and cannot be routed to a vendor.
- [ ] The vendor is not notified at submission — staff triage first.
- [ ] Staff can send a request to its vendor, which moves it to `technical_review`.
- [ ] The brief a vendor reads contains no customer name, organisation or user id — asserted against the serialised payload.
- [ ] A vendor cannot reach another vendor's brief, and the refusal is a 404.
- [ ] A vendor cannot reach the customer's request thread at all.
- [ ] Staff can post into the brief thread, and the vendor can reply.
- [ ] Nothing a vendor writes reaches the customer without a staff member relaying it.
- [ ] A revision of the requirements creates a new brief rather than editing the one already sent.
- [ ] The vendor submits a price, an effort estimate and caveats; staff issue the customer's quote from it.
- [ ] The commission rate is snapshotted at issue and never re-read.
- [ ] The vendor never sees the total the customer is quoted.
- [ ] Paying a customization invoice records a vendor earning that appears on `/dashboard/selling/earnings` and clears on the usual terms.
- [ ] A deposit and a balance invoice against one quote record two earnings, not one doubled.
