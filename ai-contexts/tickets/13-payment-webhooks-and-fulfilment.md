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
- [ ] Delivering the same webhook five times creates exactly one payment record, one order transition, and one
      set of licences.
- [ ] A webhook with a valid signature but a mismatched amount does **not** fulfil and raises a staff alert.
- [ ] An invalid signature returns 400 and changes nothing.
- [ ] Killing the app between "webhook received" and "processed" leaves the event replayable; on restart the
      job completes fulfilment.
- [ ] A payment succeeding with the webhook never delivered is fulfilled by reconciliation within 15 minutes.
- [ ] Webhook and reconciliation firing simultaneously still produce one fulfilment (test with a forced race).
- [ ] Webhook handler responds in under 1 second (processing is queued, not inline).
- [ ] Every state change from this path appears in the audit log with the source (`webhook` / `reconciliation` /
      `manual:{staffId}`).
- [ ] Fixture-based tests exist for all three providers' success, failure and refund payloads.
