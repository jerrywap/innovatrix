# 12 — Payment Provider Abstraction (Paystack · Stripe · PayPal)

**Bucket:** §7.1–7.5 · **Depends on:** 11 · **Blocks:** 13, 23 · **Size:** L
**Spec:** §62 (payments), §13 (server-side verification), §103 (source of truth), §84 (money)

## Why
Three providers with different currency reach: **Paystack** (NGN, GHS, ZAR, KES), **Stripe** (GBP, USD, EUR, …),
**PayPal** (broad). The rest of the platform must not know which one ran. One interface, three drivers, and an
admin screen that decides who handles what.

## Scope

### The interface (`src/services/payments/provider.ts`)
```ts
export interface PaymentProvider {
  readonly key: 'stripe' | 'paystack' | 'paypal'
  supportedCurrencies(): CurrencyCode[]

  /** Create a provider-side payment and return where to send the customer. */
  initiate(input: {
    payment: PaymentRecord            // our record, already persisted
    amount: Money
    customer: { email: string; name?: string; organizationId: string }
    description: string
    returnUrl: string
    metadata: Record<string, string>  // must include our payment reference
  }): Promise<{ redirectUrl: string; providerRef: string }>

  /** Authoritative server-to-server check. Never trust the browser. */
  verify(providerRef: string): Promise<{
    status: 'pending' | 'succeeded' | 'failed'
    amount: Money
    paidAt?: Date
    raw: unknown
  }>

  /** Verify signature + normalise a webhook into a domain event. */
  parseWebhook(req: { rawBody: string; headers: Headers }): Promise<{
    providerRef: string
    eventId: string                   // provider's own id — our idempotency key
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'ignored'
    amount?: Money
    raw: unknown
  }>

  refund(providerRef: string, amount: Money): Promise<{ refundRef: string }>
}
```
Rules every driver obeys:
- **Amounts go to and come back from providers in minor units.** Stripe and Paystack already use minor units;
  **PayPal uses decimal strings** — convert at the driver boundary and nowhere else.
- Every driver echoes our `payment.reference` in provider metadata so a webhook can be traced back even if our
  `providerRef` write failed.
- Drivers never write domain state. They return data; ticket 13's service decides what it means.

### Drivers
| Driver | Initiate | Verify | Webhook signature |
|---|---|---|---|
| **Stripe** | Checkout Session (`mode: payment`) | `checkout.sessions.retrieve` / `paymentIntents.retrieve` | `stripe-signature` HMAC via the SDK's `constructEvent` on the **raw body** |
| **Paystack** | `POST /transaction/initialize` → `authorization_url` | `GET /transaction/verify/{reference}` | `x-paystack-signature` = HMAC-SHA512 of the raw body with the secret key |
| **PayPal** | Orders v2 `create` (intent CAPTURE) → approve link | `orders/{id}` + `capture` | `POST /v1/notifications/verify-webhook-signature` |

Each driver lives in `src/services/payments/drivers/<key>.ts` and is unit-tested against recorded fixture
payloads (ticket 28).

### Admin configuration (`/admin/settings/payments`)
- Enable/disable each provider; `test` vs `live` mode per provider.
- **Per-currency routing**: for each storefront currency choose a default provider and optional fallbacks.
  Show a validation error if any enabled currency has no provider that supports it.
- Display connection status (a live `ping`/balance call) and the webhook URL to register, with a copy button.
- Secrets: **API keys live in environment variables**, referenced by name from the settings document. The admin
  UI shows only which env var is expected and whether it is present — never the value, never an input that
  writes a secret into MongoDB.
- Changes are permission-gated (`payment.configure`) and audited (§90).

### Selection service
`resolveProvider(currency, preferred?)` → the enabled provider for that currency, honouring admin routing and
falling back in order. Checkout shows the customer the resulting method(s); if two providers serve the currency,
the customer picks.

## Acceptance criteria
- [x] Adding a fourth provider requires implementing the interface and registering it — no changes in checkout,
      invoices, or any UI. `registry.ts` is the only module that names all three.
- [x] `£299.99` reaches Stripe as `29999`, Paystack as `29999`, and PayPal as `"299.99"`, with no rounding error.
- [x] Disabling every provider for a currency blocks checkout in that currency with a clear message rather than
      failing at the provider.
- [x] A tampered webhook body fails signature verification on all three drivers.
- [x] No provider secret is readable from the admin UI, the client bundle, or any API response.
- [x] `verify()` is a real server-to-server call for all three (no reliance on redirect parameters).
- [x] Switching a currency's provider takes effect on the next checkout without a deploy.

---

## Implementation notes

### Raw HTTP and `node:crypto`, zero new dependencies

Paystack's signature is HMAC-SHA512 of the raw body; PayPal's verification is a
**remote API call**. Neither has anything an SDK would add. Stripe's scheme is
thirty lines — and testable in a way a mocked SDK is not: the tests **generate a
real signature** with a known secret, round-trip it, then flip a byte.

Two Stripe details that are easy to miss and both matter, both covered:

- **The timestamp is checked against the clock.** Without the tolerance a
  signature stays valid forever and a captured webhook replays indefinitely.
- **There can be more than one `v1`.** During a secret rotation Stripe signs
  with both, and a parser taking the first rejects half the traffic.

Every comparison is `timingSafeEqual`. `a === b` on a signature leaks its length
and first differing byte to anyone who can measure — a real attack against a
public endpoint with an unlimited retry budget.

### The minor-units boundary lives in one function

`toProviderAmount()`. Stripe and Paystack take integers; **PayPal takes a
decimal string**. `formatPlain()` derives the decimal from the currency's own
exponent, so JPY renders `"1000"` rather than `"1000.00"` — `toFixed(2)` there
is a hundredfold error that looks perfectly ordinary in a log.

Coming back, `decimalStringToMinorUnits` splits on the point and pads rather
than parsing to a float: `29.99 × 100` is `2998.9999999999995`. The round-trip
is tested across four currencies × six amounts × three providers.

### Three status mappings that would each fulfil an unpaid order

- **Stripe**: a session can be `complete` with `payment_status: "unpaid"` — a
  bank transfer awaiting settlement. `payment_status` is the money question.
- **Paystack**: returns HTTP **200 with `status: false`** for business failures,
  so checking `response.ok` alone treats a declined card as a success.
- **PayPal**: `APPROVED` means the customer said yes and **the money has not
  moved**. Only `COMPLETED` with a completed capture is paid.

### Secrets: names, never values

`/admin/settings/payments` shows which environment variable each provider's key
lives in and a tick for whether it is set. `loadPaymentSettings` reduces
`serverEnv()` to a **boolean** server-side, so no value crosses the RSC
boundary, and the actions have no field that could write one into Mongo.

The screen also names the specific misconfiguration that produces a checkout
failing at the last step: enabled, but the key is missing.

### Not verified against a live account

There are no provider credentials yet. Signature verification is tested with
real HMACs; the drivers' HTTP is stubbed. Env placeholders are in `.env.example`
including `PAYPAL_ENV` (sandbox by default — guessing wrong towards live means
charging a real card in testing).
