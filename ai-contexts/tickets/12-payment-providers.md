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
- [ ] Adding a fourth provider requires implementing the interface and registering it — no changes in checkout,
      invoices, or any UI.
- [ ] `£299.99` reaches Stripe as `29999`, Paystack as `29999`, and PayPal as `"299.99"`, with no rounding error.
- [ ] Disabling every provider for a currency blocks checkout in that currency with a clear message rather than
      failing at the provider.
- [ ] A tampered webhook body fails signature verification on all three drivers.
- [ ] No provider secret is readable from the admin UI, the client bundle, or any API response.
- [ ] `verify()` is a real server-to-server call for all three (no reliance on redirect parameters).
- [ ] Switching a currency's provider takes effect on the next checkout without a deploy.
