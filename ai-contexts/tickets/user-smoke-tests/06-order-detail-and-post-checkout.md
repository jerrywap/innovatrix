# S06 — Order detail & post-checkout destinations

**Source:** ticket 30, lines 13–14 · **Severity:** **major** — a journey dead-ends
**Depends on:** — · **Blocks:** ticket 29 §A1, §B · **Size:** M
**Spec:** §61 (orders), §13 (checkout), §14 (post-purchase access), §102 (action-oriented)

## Why

Two reports, one story: **a customer who pays by bank transfer is shown the door to an
empty room, and the only other door 404s.**

> After checkout by bank it takes user to `/dashboard/software` but this page shows
> "Nothing here yet" … since this is still a pending order, it should take user to orders
>
> `/dashboard/orders/ORD-2026-0007` takes user to 404

The second is the more serious. `/dashboard/orders/[reference]` is linked from the orders
list, from the confirmation page, and named in the navigation comments — and it has never
existed.

## Root cause

### The order detail page was never built

`src/app/dashboard/orders/[reference]/` is an **empty directory**. No `page.tsx`, no files
at all. `git ls-files src/app/dashboard/orders/` returns only `page.tsx` — the list. It is
the only empty route directory in the app tree.

Next has no route, so **every** order reference 404s, for every customer. Not a lookup
failure, not a scoping bug: nothing is there.

**Why the compiler did not catch it.** AGENTS.md says `typedRoutes` makes a link to a
non-existent route a compile error. Both call sites defeat that with a cast:

```tsx
href={`/dashboard/orders/${order.reference}` as Route}   // orders/page.tsx:68
```

`as Route` asserts the very thing the checker exists to prove. The guard rail was there and
was written past — worth remembering, because it is the second time this pattern has cost
something (`/dashboard/software` uses the same cast on the confirmation page).

### The confirmation page sends everyone to My Software

`src/app/(public)/orders/[reference]/confirmation/page.tsx` handles the pending transfer
sensibly in its body — `awaitingTransfer` at `:69-70`, `TransferInstructions` at `:96-102` —
and then contradicts itself in the footer:

- `:173-179` — the **primary** CTA is an unconditional **"Go to My Software"** →
  `/dashboard/software`. An unpaid transfer has no entitlement, so this is guaranteed to
  land on "Nothing here yet". Exactly what the tester saw.
- `:180-185` — the secondary CTA is "View this order" → the 404 above. **Both exits are
  wrong for a pending order.**
- `:164-171` — "What happens next" is hardcoded to the card flow and shown to transfer
  customers too:
  > 1. We confirm your payment with the provider — usually seconds.

  For a bank transfer that is false. Nothing happens until a human at Innovatrix records the
  payment, which is what the instructions higher up the same page correctly say.

The redirect itself is **not** the bug: `src/features/checkout/actions.ts:125` sends offline
checkouts to `/orders/${reference}/confirmation`, which is right. Nothing auto-navigates to
`/dashboard/software`; the customer clicked the button we made most prominent.

## Scope

### Build `/dashboard/orders/[reference]`

- **Org-scoped, at the page.** `orders.findByReference`
  (`src/repositories/order.repository.ts:17-25`) is **not** org-scoped despite living on
  `OrgScopedRepository`. Scope comes from the session via `requireOrg()`, never from the URL
  (AGENTS.md). `src/app/admin/orders/[reference]/page.tsx:23-28` is the working shape;
  the confirmation page (`:50-57`) and `src/features/checkout/order-status.ts:32-39` both
  scope correctly and can be followed.
- Guard first, then `notFound()` on a miss — and no `loading.tsx` over this segment, since
  the 404 depends on the main query (AGENTS.md: "there is nothing to stream ahead of it,
  and blocking is correct").
- Content: reference, date **with time** (smoke ticket 07), status, the frozen line-item
  snapshot with per-line prices (§61 — never re-derive from live prices), totals, discount
  and tax lines, payment history and method, billing details, and links to the entitlements
  it produced.
- Actions by state: pay now if awaiting payment, transfer instructions if awaiting a
  transfer, download links once fulfilled.
- Money through `<MoneyDisplay>`; status through `<StatusBadge>` (AGENTS.md).

### Fix the confirmation footer

Make both CTAs conditional on the order's state:

| State | Primary | Secondary |
|---|---|---|
| Paid & fulfilled | Go to My Software | View this order |
| Awaiting transfer | **View this order** | Browse the marketplace |
| Awaiting card payment | **View this order** | — |

And rewrite "What happens next" per payment method. For a transfer it is: we receive it,
we record it, then your licence keys appear — and that takes days, not seconds. The page
already tells the truth in `TransferInstructions`; the footer should not undo it.

### Remove the casts

Drop `as Route` at `orders/page.tsx:68` and `confirmation/page.tsx:176,181` once the route
exists, so `typedRoutes` can do its job. Grep for other `as Route` casts in the same pass —
each one is a link the compiler is not checking.

## Acceptance criteria

- [ ] `/dashboard/orders/ORD-2026-0007` renders for its owner.
- [ ] A customer in another organization gets a 404 — not a 403, which would confirm the
      order exists (tenant isolation, ticket 26).
- [ ] Signed out redirects to login and returns to the order afterwards.
- [ ] Line prices match what was charged, after the product's price has been changed (§61).
- [ ] After a bank-transfer checkout the primary action leads to the order, not to an empty
      My Software.
- [ ] "What happens next" matches the payment method chosen.
- [ ] Once finance records the transfer, the same order shows paid and My Software has it.
- [ ] No `as Route` cast remains on either call site; the build still passes.
- [ ] Ticket 29 §B completes without hitting a 404 or an empty state.

## Notes

`ORD-YYYY-NNNN` references come from `generateReference(counterStore(), "ORD")` →
`formatReference` (`src/lib/references.ts:56-68`), stored uppercased and unique on
`OrderDoc.reference` (`src/lib/db/models/commerce.ts:213,259`). Look up by `reference`, not
by `_id` — the reference is what the customer has.

The online path is unaffected: `actions.ts:127` → `/checkout/processing?order=REF`, whose
poller (`processing.tsx:58-61`) forwards to the same confirmation page on success. It
inherits the fixed footer for free.
