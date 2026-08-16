# S11 — Card payment fails with a generic error

**Source:** follow-up report, 2026-08-16 (not in ticket 30) · **Severity:** **blocker** — no card payment can be taken
**Depends on:** — · **Blocks:** ticket 29 §A1, §A2 · **Size:** M
**Spec:** §62 (payments), §13 (checkout), §95 (observability), §104 (degradation)
**Status:** **fixed, 2026-08-17.** The diagnosis below was wrong — see *What it actually was*.

> ## ⚠️ Read this first
>
> The **reasoning** in this ticket holds: the generic message does prove an
> unmodelled exception escaped, and both gaps it names are real and are now
> fixed. The **conclusion** did not: it was neither the unwrapped `fetch` nor the
> `{}` payload.
>
> It was a mistyped enum in a seed script — `licenceType: "single_site"`, which
> is not a `LicenceType` — that made **1000 of 1004 products unbuyable**. The
> failure was in `Order.create()`, three layers above the payment code this
> ticket spent its length on.
>
> Kept as written, with the correction appended, because the wrong half is
> instructive: every hypothesis here was reached by reading code, and reading
> code cannot tell you what is in the database.

## Why

With a Paystack **test key** configured, initiating a card payment fails with:

> Something went wrong on our side. Please try again.

That is `GENERIC_ERROR_MESSAGE` (`src/lib/errors.ts:149`), and where it comes from tells us
a great deal. `withAction` (`src/lib/action-result.ts:39-59`) has three exits:

```ts
if (error instanceof ValidationError) return fail(error.message, …);   // specific
if (isDomainError(error))             return fail(error.message, …);   // specific
logUnexpected(error);                 return fail(GENERIC_ERROR_MESSAGE, …);  // ← this one
```

So the customer is seeing the **last** branch: whatever threw was **not a `DomainError`**.
That rules out most of the payment layer, which is thorough about its own error types:

- Provider said no → `ProviderError` (`src/services/payments/provider.ts:96-106`), a
  `DomainError`. Would show Paystack's own message — which is what the *earlier*
  currency-routing report saw (smoke ticket 05). Not this.
- No provider for the currency → `ValidationError` from `resolveProvider`
  (`registry.ts:118-123`), showing "We can't take payment in GBP at the moment."  Not this.
- Key missing → `isConfigured()` false → provider filtered out → same `ValidationError`
  as above. **Not this either** — a missing or misplaced key produces a specific message,
  so the key is being found.
- Order not payable → `ConflictError` / `NotFoundError`, both specific. Not this.

Something is throwing that the payment layer does not model at all.

## Narrowing it further

The previous smoke-test run reported that **bank-transfer checkout worked** — it placed an
order and reached the confirmation page (ticket 30, line 13). Both methods run the same
`placeOrderAction` and the same `checkout.createOrder`, which is wrapped in
`withTransaction` (`src/services/checkout/checkout-service.ts:106`).

So order creation, the replica set and the transaction helper are all fine. The two paths
diverge only at `src/features/checkout/actions.ts:83-87` — offline returns early; card falls
through to `initiatePaymentForOrder` (`:88-96`).

**The fault is inside `initiatePaymentForOrder`, and specifically inside the driver call.**

## Root cause

Two ways for a non-`DomainError` to escape `PaystackDriver.call()`
(`src/services/payments/drivers/paystack.ts:133-168`), and both produce exactly this message.

### 1. A transport failure is not wrapped at all

```ts
const response = await fetch(`${API}/${path}`, { … });
```

There is **no `try`/`catch` around any `fetch` in any driver.** Verified: four call sites —
`paystack.ts:141`, `stripe.ts:172`, `paypal.ts:223,252` — and `grep "try {"` across
`drivers/` returns nothing.

If the request never gets an HTTP response — DNS failure, no outbound network, a corporate
proxy, TLS interception, a timeout — `fetch` rejects with `TypeError: fetch failed`. That is
not a `DomainError`, so it sails past both specific branches and becomes
"Something went wrong on our side."

The driver models "the provider said no" carefully and does not model "we could not reach
the provider" at all.

**`ProviderUnavailableError` exists for precisely this case** — `src/lib/errors.ts:126-138`,
documented as "An upstream we don't control is down — AI provider, payment provider,
storage". A repo-wide search finds **zero usages outside its own definition**. The right
class was written and never wired up.

### 2. An unparseable 200 becomes `{}`, then a `TypeError`

```ts
const payload = (await response.json().catch(() => ({}))) as { status?: boolean; message?: string };
if (!response.ok || payload.status === false) throw new ProviderError(…);
return payload as T;
```

If the body is not JSON — an HTML error page from a proxy or captive portal is the common
case — the `.catch` yields `{}`. Then `response.ok` is true and `payload.status` is
`undefined`, not `false`, so **both guards pass** and `{}` is returned as `T`. Back in
`initiate` (`:45-67`):

```ts
return { redirectUrl: result.data.authorization_url, providerRef: result.data.reference };
```

`result.data` is `undefined` → `TypeError: Cannot read properties of undefined` → generic
message again. `as T` is an assertion, not a check; nothing validates the shape.

All three drivers share the pattern — bare `fetch`, `.catch(() => ({}))`, `payload as T`
with no shape validation. This is systemic in the payment layer, not a Paystack quirk.

## Diagnose it in two minutes

**The real error is already logged.** `logUnexpected` (`action-result.ts:88-90`) writes it
through `log.exception` with `code: "action.unhandled"`. In the terminal running `next dev`,
look for:

> Unhandled error in a server action … `action.unhandled`

That line carries the actual exception — `fetch failed`, a `TypeError`, or something else
entirely — and settles which of the two routes above is in play before any code is written.

Worth checking alongside it:

- Is the key in `.env.local` (which `next dev` loads) rather than `.env.example`? Note the
  npm scripts pass `--env-file=.env.local` explicitly.
- Is it the **secret** key (`sk_test_…`)? A public key would produce a 401 with a Paystack
  message — specific, not generic — so this is unlikely, but it is free to rule out.
- Can the machine reach the API at all: `curl -sS https://api.paystack.co` from the same
  shell.
- Which currency is the cart in? Paystack declares `["NGN","GHS","ZAR","KES","USD"]`
  (`paystack.ts:38-40`) and **not GBP**, the storefront default. A GBP cart cannot select
  Paystack at all — that is smoke ticket 05's territory and gives a different message.

## Scope

### 1. Wrap transport failures in every driver

Catch around each `fetch` and throw `ProviderUnavailableError(provider, cause)`, preserving
the original as `cause` so the log keeps it. Apply to all four call sites, including
PayPal's token fetch (`paypal.ts:223`) — an auth-step failure is just as invisible today.

Add a timeout (`AbortSignal.timeout`). A hung request currently blocks the action until the
platform's own timeout, and the customer watches a spinner with no idea anything is wrong.

### 2. Validate the response shape

`payload as T` should become a parse. The drivers already depend on Zod elsewhere in the
codebase; a small schema per response (`initialize`, `verify`, `refund`) turns "undefined
property" into a named provider error. At minimum, refuse a success payload with no `data`
rather than reaching into it.

Also treat a non-JSON body as a failure rather than as `{}`: if `response.json()` throws on
a 200, the provider is not speaking our protocol and that is a `ProviderUnavailableError`.

### 3. Distinguish the two failures for the customer

Both currently read as "something went wrong on our side", which is true but useless. §104's
degradation principle applies:

- **Cannot reach the provider** → "We couldn't reach our payment provider. Your order is
  saved — try again in a moment, or pay by bank transfer." The order genuinely is saved and
  `awaiting_payment`, and the offline path genuinely works. Offer it.
- **Provider declined** → the generic refusal, with the provider's own words in the log only
  (smoke ticket 05 covers not leaking them).

Note the order survives a failed initiation by design — `payment-service.ts:16-24` explains
why the `Payment` record is written *before* the driver call. Say so on screen instead of
implying the customer has lost their basket.

### 4. A probe script

Add `npm run payments:probe`, following `storage:probe`, `ai:probe` and `jobs:probe`. It
should initiate a small transaction against the configured key and print what came back —
resolved provider, currency, HTTP status, and the parsed result or the exact failure.

This is the missing tool. The MVP todo has flagged since ticket 12 that "no provider is
verified against a live account: there are no credentials yet". Credentials now exist, and
there is no way to exercise them except by going through checkout — which is exactly how a
generic error message and no diagnosis happens.

### 5. Make the log reachable

`logUnexpected` writes the truth and nobody saw it. Surface unhandled action errors in
`/admin/jobs`-style visibility, or at least document in `OPERATIONS.md` that
`code: "action.unhandled"` is the first thing to grep when a customer reports a generic
failure. §95 lists error tracking; the Sentry seam (ticket 27) is where this eventually
lands.

## Acceptance criteria

- [ ] With a valid Paystack test key and a supported currency, initiating a card payment
      redirects to Paystack's hosted page.
- [ ] With the network to the provider blocked, the customer sees a message saying the
      provider could not be reached and offering bank transfer — never
      "Something went wrong on our side."
- [ ] A `fetch` rejection in any driver becomes `ProviderUnavailableError` with the original
      as `cause`; the class has usages.
- [ ] A 200 with a non-JSON or `data`-less body is a named provider error, not a `TypeError`.
- [ ] A request that hangs times out and reports as unreachable.
- [ ] The order remains `awaiting_payment` and payable after any of the above, with no
      duplicate `Payment` record on retry.
- [ ] `npm run payments:probe` reports success or the precise failure against a real key.
- [ ] Tests cover both escape routes with a stubbed transport.

## What it actually was

Established by `npm run payments:probe` (built as scope item 4, before any fix) and by
replaying the real checkout against the user's own cart.

### The evidence that redirected the search

The probe drove the real drivers against the real key:

```
RESOLUTION
  GBP: candidates = none
       refused   = ValidationError: We can't take payment in GBP at the moment.  (modelled)
  USD: chosen    = paystack
  NGN: chosen    = paystack

LIVE INITIATE
  USD: paystack FAILED — ProviderError: Currency not supported by merchant  (modelled)
  NGN: paystack OK → https://checkout.paystack.com/…
```

Every outcome **modelled**, and NGN genuinely working. The network was fine, the key was
valid, transactions worked, and the driver returned a real checkout URL. Nothing in the
payment layer could produce the generic message — so the premise that the fault was *in*
the payment layer was false.

Replaying the full `placeOrderAction` path against the user's actual USD cart found it
immediately, one layer up:

```
createOrder FAILED -> ValidationError: Order validation failed:
  items.0.licenceType: `single_site` is not a valid enum value for path `licenceType`.
   modelled: NO -> GENERIC MESSAGE
```

### The chain

1. `scripts/seed-bulk.ts:297` wrote `licenceType: "single_site"`. `LICENCE_TYPES`
   (`src/lib/db/enums.ts:134-144`) has no such value — the nearest real one is
   `single_installation`.
2. The bulk seed writes through `bulkWrite`, which **does not run document validators**, so
   the invalid value stored cleanly and sat there. 1000 of 1004 products carried it; the
   four hand-seeded ones did not, which is why *some* orders had always worked.
3. `Order.create()` **does** validate. Every checkout of a bulk-seeded product failed on the
   embedded item's enum.
4. Mongoose's `ValidationError` is not our `DomainError` — different hierarchy, same class
   name. `withAction` fell to its last branch and returned `GENERIC_ERROR_MESSAGE`.

So the message was accurate and useless: something *was* wrong on our side, and nothing said
what, where, or that it affected 99.6% of the catalogue. The symptom appeared on the last
click of the funnel, three screens from the cause.

Not currency-specific and not card-specific — bank transfer failed identically for the same
products. It read as "card is broken" because card was what got tried.

### What was fixed

| Fix | Where |
|---|---|
| `single_site` → a typed `LicenceType` constant, so a typo is now a compile error | `scripts/seed-bulk.ts` |
| Post-seed integrity check — the seed refuses to finish having written an invalid enum | `scripts/seed-bulk.ts` |
| 1000 products repaired by re-running `npm run db:seed:bulk` | data |
| `providerFetch` — every driver `fetch` wrapped in `ProviderUnavailableError`, with a 15s timeout | `provider.ts`, all 3 drivers |
| `readProviderJson` — a non-JSON body is an outage, not `{}` | `provider.ts`, all 3 drivers |
| Paystack initiate rejects a 200 carrying no `authorization_url` | `drivers/paystack.ts` |
| Unmodelled failures carry a quotable `E-XXXXXX` reference, echoed into the log | `lib/action-result.ts` |
| Unmodelled failures classified in the log: `action.data_integrity`, `action.database`, `action.timeout` | `lib/action-result.ts` |
| `npm run payments:probe` | `scripts/payments-probe.ts` |
| First tests for `withAction`, and for the transport boundary | `action-result.test.ts`, `provider.test.ts` |

`ProviderUnavailableError` had **zero callers** before this. It does now.

### What is still true and still blocking

**The merchant account only has NGN enabled.** GBP and USD both return
"Currency not supported by merchant" from Paystack itself, and the storefront's default
currency is GBP. So card payment works *only* in NGN today.

That is not a bug in this codebase — it is either a Paystack dashboard setting or a routing
decision — and it is exactly what smoke ticket 05 exists to model: `supportedCurrencies()`
claims USD because Paystack-the-product supports it, while this account does not.

### The lesson worth keeping

Three of this ticket's hypotheses were wrong, and all three were arrived at by reading code
carefully. The code was not the problem; the data was. A probe that exercises the real
configuration against the real database would have found it in two minutes, and there was no
such tool for payments — which is why building one was already scope item 4.

`grep` proves what the code *can* do. Only running it proves what it *does*.

## Relationship to smoke ticket 05

They are adjacent and must not be merged.

- **S05** is about *which* provider is chosen and *what we say* when one refuses:
  per-account currency support, routing validation, and not passing provider text to
  customers.
- **S11** is about failures the payment layer does not model at all, which arrive as
  unhandled exceptions.

A useful cross-check while implementing: Stripe's driver already carries the comment
"Stripe's messages are written for developers and sometimes name internal ids, so **callers
show their own copy** — this is for the log" (`stripe.ts:188-190`). Callers do not show their
own copy; `withAction` returns `error.message` verbatim. S05 fixes that; S11 makes sure
there is a modelled error to show in the first place.
