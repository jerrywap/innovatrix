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
- [ ] Editing the total in the browser before submitting changes nothing — the server recomputes from the cart.
- [ ] An order created from a product that is later re-priced still shows its original line prices forever.
- [ ] Abandoning payment leaves the order `awaiting_payment` and the cart intact and re-purchasable.
- [ ] The processing page never shows success on redirect alone; it reflects server state only.
- [ ] Order creation is atomic — a failure part-way leaves no partial order.
- [ ] Two rapid submissions of the same cart produce one order, not two (idempotency key on the submit action).
- [ ] `ORD-` references are unique and sequential within the year.
- [ ] Checkout is completable on mobile in under two minutes with no dead ends.
