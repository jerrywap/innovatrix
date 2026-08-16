# 11 — Checkout & Orders

**Bucket:** §6.4–6.7 · **Depends on:** 10 · **Blocks:** 12, 13 · **Size:** L
**Spec:** §13 (checkout), §61 (orders & historical pricing), §82 (service layer), §103 (source of truth)

## Why
§13 gives two hard rules: keep checkout simple, and **never treat a frontend success redirect as payment
confirmation**. §61 gives a third: an order must preserve its own pricing forever.

## Scope

### Flow (§13 — resist adding steps)
```
Cart → Account/Login → Billing information → Order review → Payment → Confirmation
```
- Signed-in customers skip step 2. Guests may create an account inline; email verification is required before
  fulfilment but must not block the payment itself.
- Billing information: organization name, contact, address, country, tax id (optional), captured onto the
  organization for reuse and snapshotted onto the order.

### Order creation (inside a transaction — ticket 01)
1. Re-validate the cart server-side: products still published, prices current, discount still valid.
2. Generate `ORD-YYYY-NNNN` (ticket 00).
3. Create the order with a **full snapshot** per line (§61): product id + name + slug, version id + number,
   licence package key + its terms (activation limit, support months, update months), add-on keys and names,
   unit price, quantity, line total — plus order-level subtotal, discount (code + amount), tax (rate + rule id),
   total, currency.
4. Status `awaiting_payment`. Do **not** clear the cart yet — clear it on confirmed payment, so an abandoned
   payment leaves the customer's cart intact.

### Order states
```
draft → awaiting_payment → paid → fulfilled
                    ↓            ↘
                cancelled       refunded
```
Transitions validated against the ticket-02 map. `paid → fulfilled` is driven by ticket 14 (entitlements issued).
An order is never marked paid by anything except the ticket-13 webhook/verification path.

### Payment handoff
Checkout hands the order to the ticket-12 provider abstraction and redirects to the provider. The return URL
lands on `/checkout/processing?order=REF`, which **polls the order status** rather than asserting success —
because the webhook is the authority (§13, §103). Show "confirming your payment" until the server says paid,
with a clear path to support if it takes longer than expected.

### Confirmation `/orders/[reference]/confirmation`
Order summary, what happens next, links into My Software once fulfilled. Receipt email queued (ticket 24).

### Order views
- Customer: `/dashboard/orders` list + `/dashboard/orders/[reference]` detail with line items, totals, payment
  status, downloads, invoice link.
- Staff: read-only order view inside Customer 360 (ticket 20).

## Acceptance criteria
- [x] Editing the total in the browser before submitting changes nothing — the server recomputes from the cart.
- [x] An order created from a product that is later re-priced still shows its original line prices forever.
- [x] Abandoning payment leaves the order `awaiting_payment` and the cart intact and re-purchasable.
- [x] The processing page never shows success on redirect alone; it reflects server state only.
- [x] Order creation is atomic — a failure part-way leaves no partial order.
- [x] Two rapid submissions of the same cart produce one order, not two (idempotency key on the submit action).
- [x] `ORD-` references are unique and sequential within the year.
- [~] Checkout is completable on mobile in under two minutes with no dead ends — **one page**, not a wizard,
  and responsive. The stopwatch belongs to ticket 27's device pass.

---

## Implementation notes

### §61, tested by breaking the product afterwards

Every order line copies the product's name, slug, version, licence terms and
price **into the order**. The tests then rename the product, multiply its price
by three, shorten its support window and delete it outright — and re-read the
order. Nothing moves.

The licence terms matter as much as the price: ticket 14 issues entitlements
from `supportMonths` and `updateMonths` **on the order line**. Reading them live
would mean an edited package silently shortening a window somebody paid for.

### The reference joins the transaction

`generateReference(counterStore(session), "ORD")`. Without the session, a
rolled-back order burns an `ORD-` number and leaves a permanent gap in the
sequence. There is a test that forces a failure *after* the reference is taken
and asserts the next real order is still `-0001`.

### Idempotency is content-derived

The key is a hash of the cart id, its currency, its total and its line shape.
The cart id alone would make a customer's second, deliberate purchase of the
same basket collide with their first. Two rapid submits find the same order; a
week later, a genuinely different basket does not.

Belt and braces: a unique sparse index on `idempotencyKey`, so two submissions
that race past the read still produce one order — the loser reads back the
winner rather than seeing a duplicate-key error.

### The cart is *not* cleared here

Ticket 13 clears it on **confirmed payment**. An abandoned payment must leave
the basket intact and re-purchasable — the difference between a customer
retrying and a customer starting again.

### The processing page reflects server state and nothing else

`/checkout/processing` renders a poller and reads no order itself. It does not
check for `?success=true`, and it does not assume anything from having been
navigated to: the provider's redirect fires when the *browser* comes back,
which happens before — and sometimes without — the webhook. The poll backs off
and, after ninety seconds, stops and offers support rather than spinning
forever.

### Deviations

1. **Guests do not create an account inline.** `/checkout` redirects a
   signed-out visitor to `/login?next=/checkout`, which is §13's account step
   with one fewer page and a working Back button. Inline registration is a real
   §13 requirement and is **not** built — flagged rather than half-done.
2. **Billing address validation is deliberately thin.** Only the country is
   validated, because it decides the tax rule. §13 says "resist adding steps",
   and a checkout that rejects a postcode format it has never seen loses a sale.

### A Mongoose footgun, documented rather than worked around

An unset **nested path** comes back as `{}`, not `undefined` — so
`if (order.discount)` is true for an order with no discount. The only safe check
is `order.discount?.amount`. Recorded on `OrderDoc` where the next person will
read it; a test asserts the field rather than the object for the same reason.

16 integration tests against a replica set.
