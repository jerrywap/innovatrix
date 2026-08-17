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
- [ ] Rates are stored and computed in basis points; no float appears in the split anywhere.
- [ ] Resolution is platform → vendor, most specific winning, and the effective rate is derivable from one function.
- [ ] Adding a third resolution level would touch `resolveCommission()` and nothing else.
- [ ] A vendor cannot change any rate, in the action and not only in the UI.
- [ ] The resolved rate and vendor id are written onto the order line at checkout.
- [ ] Changing a rate does not alter the split on any order placed before the change.
- [ ] The split is computed in the order's currency, and an attempt to cross currencies throws.
- [ ] Platform fee plus vendor earning equals the line total exactly, for every currency including a zero-exponent one.
- [ ] An add-on line carries no vendor and no commission.
- [ ] A first-party line is distinguishable from a vendor line by the absence of `vendorId`, not by a sentinel.
- [ ] A vendor sees their effective rate and where it came from.
- [ ] A new agreement version blocks new submissions until accepted, without affecting products already on sale.
- [ ] Every rate change is audited with the before and after and the staff member who made it.
