# 07 — Commercial Terms & Commission

**Bucket:** §20.7 · **Depends on:** vendor 01 · **Blocks:** vendor 08, 09 · **Size:** M
**Spec:** §61 (orders — historical prices are frozen), §62 (payments), §84 (money — integer minor units), §90 (audit), §106.31 (decisions needing stakeholder input)

## Why
The brief says payout and percentage rates are configurable. What that costs is
a resolution order, a place to configure it, and — the part that is easy to get
wrong and expensive to fix — a rule about *when* the rate is read. §61 already
says a historical price is frozen and never recomputed; a commission rate is the
same kind of fact and needs the same treatment.

## Scope

### Resolution order

Two levels, most specific wins:

```
platform default  →  vendor override
```

A **per-product** third level was specified and is dropped. It is the level with
the least demand and the most explaining attached: a vendor asking why two of
their own products earn different percentages is a conversation nobody wants, and
the answer would live in a field on a product the vendor may edit every other
part of. One rate per vendor is a sentence a vendor can repeat back.

The resolution order is written as a chain precisely so a third level is additive
— `resolveCommission()` gains a lookup and nothing else changes, and decision
**V1** may yet ask for one that varies by product *type* rather than by product.

Stored in basis points, never as a float. `money.ts` already exports
`percentage(m, basisPoints)`, so 3000 means 30% and the arithmetic is integer
throughout. A percentage held as `0.3` is the same mistake as a price held as a
float, and §84 has already settled that argument for money.

The platform default lives in `/admin/settings` beside the tax and payment
configuration. A vendor override is set on the vendor by staff. **A vendor cannot
change their own rate**, which is worth stating because every other field on
their product is theirs.

> **Implemented 2026-08-17 — its own route, not a panel on Payments setup.**
> `/admin/settings/commission`, gated on a new `vendor.manage_commission`. The natural
> home looked like `/admin/settings/payments`, since the default is stored on
> `PaymentSettings` — but that page is gated on `payment_provider.configure`, which
> `marketplace_manager` does not hold. Putting the rate there would have meant either
> widening that permission (handing whoever sets our cut the provider configuration too)
> or granting a permission for a *page* rather than for a capability. The vendor override
> lives on the staff vendor screen, in a "Money" section beside the ledger.

### The rate is snapshotted onto the order line

At checkout, the resolved rate and the vendor id are written onto the order
line, alongside the price that is already frozen there.

This is the whole point. A rate change must never rewrite what a vendor earned
last month, and a rate resolved at payout time would do exactly that — silently,
and in the platform's favour, which is the worst possible direction for a
mistake in a revenue share. The snapshot is what makes an earning arguable six
months later.

```ts
// on OrderItem, beside unitPrice and lineTotal
vendorId?: Types.ObjectId;
commissionBasisPoints?: number;   // resolved at checkout, never re-read
```

Both absent on a first-party line, which is how the ledger tells the two apart.

### The split

Platform fee = `percentage(lineTotal, commissionBasisPoints)`; vendor earning is
the remainder. Computed with `allocate()` where a line splits across more than
two parties so the remainder lands somewhere rather than vanishing — `money.ts`
already guarantees no lost pennies, and a rounding rule invented here would be a
second one.

Both are computed in the **order's currency**. `money.ts` throws on
cross-currency arithmetic, which is the right behaviour and means a split cannot
straddle currencies; what happens at payout is decision **V5** and vendor
ticket 09's problem.

What the fee is taken on — the line total before or after discount and tax — is
decision **V1**'s neighbour and must be settled before this ships. The default:
the fee is taken on the **net line total, after discount and before tax**,
because tax is never the platform's revenue and a platform-funded discount
should not be charged to the vendor.

> **Implemented 2026-08-17 — `subtract`, not `allocate`.** The text above suggests
> `allocate()`; the implementation uses `percentage()` for the fee and `subtract()` for the
> earning, which makes `fee + earning === lineTotal` exactly, in every currency including a
> zero-exponent one, with **one** rounding rather than two. `allocate()` is for apportioning
> something *across* parties; this is two halves of one number, and subtraction is the
> arithmetic that cannot drift. A test walks 9 rates × 13 amounts × 2 currencies asserting
> the sum, because the failure mode is a penny per line and nobody notices it until a vendor
> adds their own figures up.
>
> The discount **is** apportioned, and there `allocate()`'s guarantee is the one that
> matters — a line's share is proportional to its share of the subtotal, rounded once. The
> fee is then taken on the net.

### Add-ons and services

An add-on line (installation, branding) is platform-delivered work. It carries
no vendor and no commission; the platform keeps it. A vendor who wants paid
services around their product is a different feature and is not this one.

### The vendor agreement

A versioned document. Accepting is recorded on the vendor with the version
string (vendor ticket 01). A new version requires re-acceptance, and until it is
accepted the vendor can service existing customers but cannot submit new
products — the softest gate that still means something.

A rate change to an *existing* vendor is a change of terms: notified, effective
from a date, and never retroactive. The snapshot on the order line is what makes
"never retroactive" true rather than promised.

### Visibility

A vendor sees their effective rate and what it is derived from, on every product
and in their settings. A revenue share nobody can read is one every vendor
emails support about.

## Out of scope
Per-product rates (above). Tiered rates that vary with volume, promotional rates,
and vendor-funded discounts. Each changes the arithmetic here and none is asked
for; the resolution order leaves room for a third level if one is ever wanted.

## Acceptance criteria
- [x] Rates are stored and computed in basis points; no float appears in the split anywhere.
- [x] Resolution is platform → vendor, most specific winning, and the effective rate is derivable from one function.
- [x] Adding a third resolution level would touch `resolveCommission()` and nothing else.
- [x] A vendor cannot change any rate, in the action and not only in the UI.
- [x] The resolved rate and vendor id are written onto the order line at checkout.
- [x] Changing a rate does not alter the split on any order placed before the change.
- [x] The split is computed in the order's currency, and an attempt to cross currencies throws.
- [x] Platform fee plus vendor earning equals the line total exactly, for every currency including a zero-exponent one.
- [x] An add-on line carries no vendor and no commission.
- [x] A first-party line is distinguishable from a vendor line by the absence of `vendorId`, not by a sentinel.
- [x] A vendor sees their effective rate and where it came from.
- [x] A new agreement version blocks new submissions until accepted, without affecting products already on sale.
- [x] Every rate change is audited with the before and after and the staff member who made it.
