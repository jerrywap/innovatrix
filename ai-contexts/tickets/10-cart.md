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
- [ ] Server actions recompute totals from the database; a tampered client payload cannot change the total.
- [ ] Adding a GBP-only product to an NGN cart is refused with an actionable message.
- [ ] Guest → login merges the cart without losing items or duplicating them.
- [ ] Removing a product removes its attached add-ons.
- [ ] A price change between add and checkout is surfaced to the customer before payment.
- [ ] An expired or over-limit discount code is rejected at recalculation, not just at entry.
- [ ] Totals are exact integers — `£299.99 + £99.00 + £49.00 + £149.00 = £596.99` with no floating-point drift.
- [ ] Cart TTL removes abandoned guest carts.
