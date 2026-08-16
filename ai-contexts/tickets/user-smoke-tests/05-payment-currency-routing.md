# S05 — Payment currency routing

**Source:** ticket 30, lines 12 and 27 · **Severity:** **major** — money cannot be taken
**Depends on:** — · **Blocks:** ticket 29 §A1, §A2 · **Size:** M
**Spec:** §62 (payments), §13 (checkout), §103 (single source of truth)

## Why

"Pay by card → *Currency not supported by merchant* (but I have Paystack)."

Two things are wrong, and the second is the one that bit:

1. We tell a customer a payment cannot be taken **in words written by Paystack**, leaked
   straight through our error handling.
2. We decide which provider can take a currency from a **hardcoded list of what
   Paystack-the-product supports worldwide**, not what this merchant's account is actually
   provisioned for. So we route confidently to a provider that then refuses.

The gap between "Paystack supports USD" and "*this* Paystack account supports USD" is the
whole bug, and no amount of admin configuration can currently close it.

## Root cause

### The message is Paystack's

`"Currency not supported by merchant"` appears nowhere in this repo — it is Paystack's API
text, verbatim. Its path to the screen:

1. Paystack returns HTTP 200 with `status: false`; we wrap `payload.message` into a
   `ProviderError` — `src/services/payments/drivers/paystack.ts:157-163`.
2. `withAction` returns `error.message` **unchanged** for `PROVIDER_UNAVAILABLE` —
   `src/lib/action-result.ts:50-54`.
3. Rendered by `FormErrors` — `src/features/checkout/components/billing-form.tsx:192`.

Step 2 contradicts our own documentation. `src/services/payments/provider.ts:89-95` says a
provider message is "frequently unsafe to show a customer verbatim". It is shown verbatim.

### The routing gate is a static list

`providersFor()` — `src/services/payments/registry.ts:138-180` — applies three gates
(`:166-174`): admin-enabled, currency supported, secret present. The middle one is:

```ts
if (!driver.supportedCurrencies().includes(currency)) continue;
```

and the driver answers from a constant — `paystack.ts:38-40` returns
`["NGN","GHS","ZAR","KES","USD"]`, `stripe.ts:38-40` `["GBP","USD","EUR","NGN"]`,
`paypal.ts:45-47` `["GBP","USD","EUR"]`.

Meanwhile `PaymentSettingsDoc.providers[].supportedCurrencies` **exists**
(`src/lib/db/models/commerce.ts:615`), is populated once at document creation from that
same static list (`registry.ts:67`), and is **never read by anything**. Dead data sitting
exactly where the per-account answer belongs.

### Two different failures, and the report is the second

Storefront currencies are `["GBP","USD","NGN"]`, default GBP
(`src/config/storefront.ts:23,28`).

- **GBP with only Paystack enabled** → GBP is not in Paystack's list → no candidates →
  our own message from `resolveProvider` (`registry.ts:118-123`): *"We can't take payment
  in GBP at the moment."* Clear, ours, correct.
- **USD or NGN with only Paystack enabled** → Paystack passes the gate → we call the API →
  the merchant account is not provisioned for that currency → Paystack refuses. **This is
  the reported bug**, and the customer reads the provider's sentence.

Also worth knowing: **no seed writes `PaymentSettings`**. The document is created lazily by
`getPaymentSettings` (`registry.ts:54-73`) with every provider `enabled: false` and
`currencyRouting: []`. Whatever a tester has is only what they toggled by hand.

## Scope

### 1. Per-account currency support

Read `providers[].supportedCurrencies` from the settings document in `providersFor`
(`registry.ts:173`) instead of calling `driver.supportedCurrencies()`. Keep the driver
method as the **default** offered when a provider is first enabled, and as the ceiling — an
admin may narrow it to what their account does, never widen it past what the provider can.

Make it editable in `/admin/settings/payments`, where it is currently static read-only text
(`src/app/admin/settings/payments/page.tsx:75-77`).

This is the fix that matters. Everything else here is a consequence.

### 2. Never show provider text to a customer

`withAction` must not return a `PROVIDER_UNAVAILABLE` message verbatim
(`action-result.ts:50-54`). Return the generic refusal — "We couldn't take that payment,
try another method or get in touch" — and log the provider's own words with the request id,
where support can find them. `provider.ts:89-95` already says this; make the code agree.

Check the other providers while here: an error message is the easiest place to leak an
account identifier or an internal reason.

### 3. Validate the routing write action

`routingSchema` (`src/features/payments/actions.ts:41-48`) is `z.enum(PAYMENT_PROVIDERS)`,
which **includes `"manual"`** (`src/lib/db/enums.ts:167`), and nothing checks the chosen
provider is enabled, configured, or supports that currency. A direct POST can store
`primary: "manual"` for GBP; the resolver skips it silently (`registry.ts:163`) while the
screen displays it as configured.

The UI restricts the options (`settings-view.ts:97`) — but the UI is not a permission check
(AGENTS.md, architectural rule 2). Validate server-side: reject a primary that is not
enabled, not configured, or cannot take the currency.

### 4. Fallback order is lost

`registry.ts:154-157` treats `[primary, ...fallbacks]` as a strict preference order, but the
UI collects fallbacks as **checkboxes** (`routing-row.tsx:39-69`) and stores them in DOM
order (`actions.ts:127`). "PayPal before Stripe" is not expressible. Make the order explicit
and editable, or stop describing the list as ordered.

### 5. Let an uncovered currency be configured ahead of time

When no enabled provider supports a currency, the row renders as a red read-only line with
no form at all (`routing-row.tsx:20-30`). The banner is right and should stay — but an admin
should be able to set the intended routing *before* enabling the provider, rather than
being locked out at exactly the moment they are trying to fix it.

### 6. Seed payment settings

Add `PaymentSettings` to `scripts/seed.ts` so a fresh environment has a coherent default
instead of every provider disabled and empty routing. Ticket 29 §A1 says "check out, paying
by card"; today that requires the tester to configure a payment provider first, which is not
what the checklist implies.

## Acceptance criteria

- [ ] An admin can record which currencies **their** account takes, and routing honours it.
- [ ] A currency the merchant cannot take is refused **before** any provider call, in our
      words, at the cart or checkout rather than after submitting card details.
- [ ] No provider-authored string reaches a customer; the original is in the logs with the
      request id.
- [ ] A direct POST cannot store a primary that is disabled, unconfigured, `manual`, or
      wrong for the currency.
- [ ] Fallback order is expressible and survives a save.
- [ ] Routing can be configured for a currency no enabled provider covers.
- [ ] `npm run db:seed` produces working payment settings.
- [ ] Ticket 29 §A1 completes with a card payment against a real account.

## Notes

The MVP todo already flags that no provider has ever been verified against a live account
(rows 7.1–7.5, and 14.8: "Not verified live: only Paystack is enabled in dev and it does not
take GBP"). This ticket is where that stops being a footnote — the *code* assumed a
provider's global capability list was the answer, and it never was.

Offline/bank transfer is unaffected and remains the working path in any currency; it is
configured separately (`page.tsx:46-49`) and does not appear in routing at all.
