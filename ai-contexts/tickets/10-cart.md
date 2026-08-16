# 10 — Shopping Cart

**Bucket:** §6.1–6.3 · **Depends on:** 09 · **Blocks:** 11 · **Size:** M
**Spec:** §11 (buy as-is), §12 (cart), §49 (add-ons), §84 (money), §61 (historical pricing)

## Why
§12 requires a cart that mixes digital licences with services (installation, branding, support) — the
"CRM Pro £299 + Installation £99 + Brand Setup £49 + 1 Year Support £149" example. Totals are money, so they
are computed server-side, always.

## Scope

### Model
- Guest cart keyed by an httpOnly cookie id; user cart keyed by userId + active organization.
- **On login, merge** the guest cart into the user cart (union of items; quantities summed for quantity-bearing
  lines; conflicting currencies resolved by keeping the user cart and telling the customer).
- `expiresAt` with a TTL index (§12 cart expiry). Guest carts 7 days, user carts 30.

### Items
```
{ kind: 'product_licence' | 'addon',
  productId, licencePackageKey?, addonKey?,
  quantity,
  unitPrice: Money,        // captured at add time
  displayName, displaySummary }
```
- **One currency per cart.** Adding an item priced only in another currency is refused with a clear message
  offering to switch the cart currency (which re-prices every line and warns).
- Add-ons attach to the product line they belong to, so removing the product removes its add-ons.
- Quantity applies only where meaningful (multi-installation licences, hours-style services). A single-project
  licence is quantity-locked to 1.

### Pricing & totals — server-side only
- `CartService.recalculate(cart)` returns `{ lines[], subtotal, discount, tax, total }`.
- **Re-price on every read.** If a product's price changed since the item was added, show the new price and a
  notice — never silently charge the old one and never trust a client-supplied price.
- Discount codes: fixed or percentage, min-spend, product/category scoping, usage limit, expiry. Validated
  server-side on every recalculation, not just at apply time.
- Tax: a simple rule engine keyed on the organization's billing country and product type (digital goods vs
  services). Store the applied rate and rule id on the cart so the order can snapshot it.

### UI
- Cart drawer (add-to-cart feedback) + `/cart` page.
- Line items with thumbnail, licence package, add-ons nested, unit price, quantity, line total.
- Discount code entry with inline validation. Order summary with subtotal, discount, tax, total.
- Empty state links back to the marketplace.
- Cross-sell: relevant add-ons the customer hasn't selected (installation, branding, support).

## Acceptance criteria
- [x] Server actions recompute totals from the database; a tampered client payload cannot change the total.
- [x] Adding a GBP-only product to an NGN cart is refused with an actionable message.
- [x] Guest → login merges the cart without losing items or duplicating them.
- [x] Removing a product removes its attached add-ons.
- [x] A price change between add and checkout is surfaced to the customer before payment.
- [x] An expired or over-limit discount code is rejected at recalculation, not just at entry.
- [x] Totals are exact integers — `£299.99 + £99.00 + £49.00 + £149.00 = £596.99` with no floating-point drift.
- [x] Cart TTL removes abandoned guest carts.

---

## Implementation notes

### The tamper-proofing is the shape of the input, not a check

`addToCartAction`'s schema has no `unitPrice`, no `lineTotal`, no `total`. A
client says *which product* and *which licence*; the server decides what that
costs on every read. The stored `unitPrice` on a cart line is a **record of
what it cost when it was added** — compared against the live product to produce
a notice, never read as an amount to bill.

Proven by writing a penny price straight into the cart document, bypassing the
action entirely: the total stays £299.99.

### The order of operations

```
subtotal   Σ (unit × quantity)
discount   applied to the subtotal
taxable    subtotal − discount
tax        applied to the taxable amount
total      taxable + tax
```

Taxing before discounting charges tax on money nobody paid. One line, equally
plausible either way, and wrong in a way a customer only notices on the invoice.

Two other clamps worth naming: a fixed discount larger than the subtotal clamps
to zero rather than going negative (a negative total sent to a provider is
either an error or, with the wrong one, a *refund*), and a percentage rounds
**once on the subtotal** rather than per line — otherwise the same basket costs
differently depending on how it was split.

### Decisions that shaped the code

- **`ownerKey` is one string**, `guest:<nanoid>` or `user:<id>`, with a unique
  index. Two nullable columns would mean a branch in every query and four cases
  in the merge; this makes the merge a rename.
- **On a currency conflict the merge keeps the *user* cart.** Re-pricing what
  somebody built while signed in, on the strength of a cookie from another
  session, is the wrong default.
- **A currency switch keeps unpriceable lines and flags them.** Emptying a
  basket because somebody clicked a toggle is a second problem, not a recovery.
- **A single-installation licence is quantity-locked to 1.** Three installations
  is a different licence package, not a quantity.
- **Reads never write.** `recalculate` returns notices rather than repairing the
  cart, so the notices survive the refresh the customer is about to do.

### Discounts and tax are models with admin screens

Your call, and it made the snapshot test more important rather than less:
`orders.tax` stores the rule id **and** the rate, so an admin editing VAT does
not rewrite an order placed last year. There is a test for exactly that.

`usedCount` increments with `$inc` inside the checkout transaction, with the
limit check in the filter — so the database decides who gets the last use of a
hundred-use code. Verified with two concurrent checkouts against a one-use code:
`usedCount` ends at 1, and exactly one order carries the discount.

### A pre-existing seed bug, fixed

`scripts/seed.ts` upserted the demo licence on `entitlementId` while `key`
carries the unique index — so a re-run that found no matching entitlement tried
to insert a second licence with the same key and died on `E11000`. Now keyed on
`key`. Upsert on the unique field, or the upsert is not one.

25 integration tests against a replica set, 19 unit tests on the arithmetic.
