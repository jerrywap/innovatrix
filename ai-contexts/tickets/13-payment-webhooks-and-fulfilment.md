# 13 — Payment Webhooks, Verification & Fulfilment

**Bucket:** §7.6–7.9 · **Depends on:** 12 · **Blocks:** 14, 23 · **Size:** L
**Spec:** §87 (webhooks), §62 (payment events verified/idempotent/audited), §13, §103, §90 (audit)

## Why
This is the single most failure-sensitive path in the platform. A dropped webhook means a customer paid and
got nothing; a replayed webhook means duplicate licences. §87 sets the bar: verify signatures, be idempotent,
store processing status, tolerate duplicate delivery.

## Scope

### Webhook endpoints — `app/api/webhooks/[provider]/route.ts`
- **Raw body access.** Signature verification requires the exact bytes; read with `await req.text()` before any
  parsing, and make sure no middleware/proxy rewrites the body.
- Steps, in order:
  1. Verify the signature via the driver. Invalid → `400`, log, **stop**.
  2. Extract `eventId`. If a `webhookEvents` record with that `(provider, eventId)` already exists → `200 OK`
     immediately (duplicate delivery is normal, not an error).
  3. Persist the raw event with `status: received` **before** processing.
  4. Enqueue processing (ticket 25) and return `200` fast. Providers retry on slow responses; do the work
     asynchronously.
  5. The job processes, sets `status: processed | failed`, records the error, and is retried with backoff.
- Endpoints are **public and unauthenticated by design** — the signature is the authentication. Rate-limit them
  and never leak internal errors in the response body.

### Payment processing service
On `payment.succeeded`:
1. Load our `payments` record by `providerRef` (or by the metadata reference as fallback).
2. **Independently re-verify** with `provider.verify()`. Do not trust the webhook payload's amount alone.
3. Assert the verified amount and currency **exactly match** the order/invoice total. A mismatch does not
   fulfil — it flags the payment `requires_review` and alerts staff.
4. Inside one transaction (ticket 01):
   - payment → `succeeded`, `verifiedAt`, `paidAt`
   - order → `paid` (or invoice → `paid` / `partially_paid`)
   - clear the cart
   - hand off to ticket 14 to create entitlements and licences
   - write `activityEvents` and `auditLogs` entries
5. Emit `PaymentReceived` and `OrderPaid` domain events → notifications (ticket 24).

On `payment.failed`: mark failed, keep the order `awaiting_payment`, notify the customer with a retry link.
On `payment.refunded`: mark refunded, revoke or suspend the entitlement per policy, audit it.

### Safety net — reconciliation
Providers do drop webhooks. Add a scheduled job (ticket 25) that, every 15 minutes, finds payments that have
been `pending` for over 10 minutes and calls `provider.verify()` directly, then runs the same processing path.
**The processing path must be idempotent enough that webhook and reconciliation racing produce one fulfilment.**

### Manual / offline payments (§7.9)
Staff with `payment.record_manual` can record a bank transfer against an order or invoice: amount, currency,
date, reference, note, optional proof upload. It runs the identical fulfilment path so entitlements are created
the same way. Fully audited — this is a high-trust action.

## Acceptance criteria
- [x] Delivering the same webhook five times creates exactly one payment record, one order transition, and one
      set of licences. Tested sequentially **and** simultaneously.
- [x] A webhook with a valid signature but a mismatched amount does **not** fulfil and raises a staff alert.
- [x] An invalid signature returns 400 and changes nothing — verified live: `HTTP 400`, and the payload is
      not echoed back.
- [x] Killing the app between "webhook received" and "processed" leaves the event replayable; on restart the
      sweep completes fulfilment.
- [x] A payment succeeding with the webhook never delivered is fulfilled by reconciliation.
- [x] Webhook and reconciliation firing simultaneously still produce one fulfilment (forced race, tested).
- [x] Webhook handler responds in under 1 second — measured live at **54ms**, processing deferred to `after()`.
- [x] Every state change from this path appears in the audit log with the source.
- [~] Fixture-based tests exist for all three providers' success, failure and refund payloads — **signature
  verification** is fully tested for all three with generated HMACs. Per-provider *payload* fixtures are
  ticket 28's, and are the thing real credentials would let us record properly.

---

## Implementation notes

### `after()` rather than a queue, and why that is enough

Ticket 25 owns the job runner. The criteria here are: respond under a second,
survive being killed mid-flight, and produce one fulfilment when a webhook and
the sweep race. `after()` gives the first. The **persisted `webhookEvents` row,
written before processing**, gives the second. A guarded claim gives the third.

None of that is queue-shaped, so ticket 25 replaces one call site rather than a
design. Named as such in `webhook-processor.ts`.

### Three independent guards, all of them load-bearing

1. `setStatusIfCurrent(pending → succeeded)` on the payment, **outside** the
   transaction — the second caller must be turned away before doing work, not
   rolled back after.
2. `setStatusIfCurrent(awaiting_payment → paid)` on the order, inside it.
3. The unique index on `entitlements (orderId, orderLineId)`.

Plus `webhookEvents.claim()`, a guarded `received → processing` transition —
which required adding `processing` to the status enum, since the schema had no
way to express "in flight".

### Retryable versus terminal decides whether a paying customer gets their licence

- **Retryable** → back to `received`, the sweep picks it up: a provider timeout,
  a database blip, and — the subtle one — **a payment we cannot find *yet***. A
  webhook can beat our own `providerRef` write by milliseconds, so "no payment
  for this ref" usually means "not yet".
- **Terminal** → `failed`, the sweep skips it: a forged signature, an
  unparseable payload, an amount mismatch (retrying produces the same mismatch).

Verified live: a valid signature for a payment that does not exist left the
event `status=received`, not `failed`.

### The amount check

The provider is asked directly — the webhook payload's amount is never trusted
on its own — and the answer must match the order **exactly**: same integer, same
currency. `29999 NGN` against a `29999 GBP` order is a mismatch, and there is a
test for that specific case.

A mismatch lands in `requires_review` with a staff audit entry and issues
nothing. It deliberately does **not** throw: the webhook must still return 200,
or the provider retries a payload that will mismatch identically every time.

### One path, three entry points

Webhook, reconciliation sweep and manual bank transfer all call
`processPaymentSucceeded`. A manual payment passes `skipVerification` — there is
no provider to ask, and the staff member's confirmation is the proof — but the
**amount is still checked against the order**, so a typo does not fulfil. That
has its own test, and its own permission (`payment.record_manual`), because it
creates real licences without a provider confirming anything.

The audit `source` names which ran: `webhook`, `reconciliation`, or
`manual:{staffId}`.

### Refund suspends rather than revokes

A refund may be a chargeback under dispute. Entitlements and licences go to
`suspended`; nothing is deleted, because that is not reversible.

### Details worth keeping

- **Licence keys come from `randomBytes`**, not `Math.random()` — a key is a
  bearer token for paid software. The alphabet excludes `I`, `O`, `0` and `1`
  because these get read down a phone line to support.
- **`addMonths` clamps the day.** `setMonth` overflows — 31 January plus one
  month is 3 March — and a support window that silently jumps a month is a
  billing dispute.
- **`/api/webhooks` and `/api/cron` are excluded from the proxy matcher.**
  Signature verification needs the exact bytes, and nothing may sit in front of
  them.
- **`env.ts` already refused `STRIPE_SECRET_KEY` without `STRIPE_WEBHOOK_SECRET`**
  — a pre-existing boot-time guard that caught a test's own setup. Working as
  intended.

### Verified live

```
invalid signature      HTTP 400, payload not echoed
no signature           HTTP 400
unknown provider       HTTP 404
valid signature        HTTP 200 in 54ms
same event again       HTTP 200 {"duplicate":true} — one row for two deliveries
cron, no secret        HTTP 401
cron, wrong secret     HTTP 401
cron, correct secret   HTTP 200
```

16 integration tests against a replica set, 28 unit tests on signatures and the
money boundary.
