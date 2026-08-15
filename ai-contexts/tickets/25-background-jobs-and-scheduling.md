# 25 — Background Jobs & Scheduling

**Bucket:** §16 · **Depends on:** 01 · **Blocks:** 13, 22, 23, 24 · **Size:** M
**Spec:** §86 (background jobs — retryable and observable), §87 (webhook follow-up), §68 (reminders)

## Why
§86 lists work that must not happen in a request: emails, notifications, PDF generation, invoice creation,
scheduled reminders, webhook follow-up processing. A webhook handler that generates a PDF inline will time out
and the provider will retry it — creating exactly the duplicate-fulfilment bug ticket 13 works to prevent.

## Scope

### Choosing the runner
Decide explicitly and record the decision in an ADR:
| Option | Fits when | Cost |
|---|---|---|
| **MongoDB-backed queue** (own `jobs` collection + worker loop) | You already have Mongo, want zero new infra, modest volume | You own visibility timeouts, backoff, dead-lettering |
| **BullMQ + Redis** | Higher volume, want mature tooling and a dashboard | Adds Redis to the deployment |
| **Platform queue** (QStash / Inngest / Cloud Tasks) | Serverless deploy with no long-lived worker | External dependency, per-message cost |

Default recommendation: **MongoDB-backed queue** for MVP — one datastore, transactional enqueue alongside the
domain write, and it can be swapped behind the interface later. Move to BullMQ when throughput demands it.

### Interface (`src/services/jobs/`)
```ts
enqueue(name, payload, { runAt?, maxAttempts?, idempotencyKey? })
defineJob(name, handler, { maxAttempts, backoff })
```
- **Transactional enqueue**: when a job is enqueued as part of a domain transaction, it joins the same session
  so a rolled-back order never leaves a phantom email queued.
- **Idempotency key** — enqueuing the same key twice yields one job. This is what makes webhook retries safe.
- Exponential backoff with jitter; after `maxAttempts` the job moves to a dead-letter state, is logged, and
  alerts. **Jobs never silently disappear.**
- A worker claims jobs atomically (`findOneAndUpdate` with a visibility timeout) so multiple instances are safe.

### Jobs to implement
`send-email` · `generate-quote-pdf` · `generate-invoice-pdf` · `process-payment-webhook` (ticket 13) ·
`reconcile-pending-payments` · `create-entitlements` (if deferred from the webhook path) ·
`expire-quotes` · `mark-invoices-overdue` · `send-invoice-reminders` · `send-followup-reminders` ·
`cleanup-expired-carts` · `cleanup-orphaned-uploads` · `notify-version-released`.

### Scheduling
Cron-style scheduled jobs. On a serverless host use the platform scheduler (e.g. Vercel Cron) hitting a
protected route handler; on a long-lived host run an in-process scheduler. Either way the **handler is the same
function** and is guarded by a secret so it isn't publicly triggerable.

Schedule: reconciliation every 15 min · overdue/expiry sweeps daily · reminders daily · cleanups nightly.

### Observability (§86, §95)
`/admin/jobs`: queue depth by name, in-flight, failed, dead-lettered; per-job history with payload, attempts and
error; manual retry and cancel. Alert when the dead-letter count or the oldest-pending age crosses a threshold.

## Acceptance criteria
- [ ] A job enqueued inside a transaction that then rolls back is never executed.
- [ ] The same idempotency key enqueued twice runs once.
- [ ] A handler that throws is retried with growing backoff, then dead-lettered with the error retained.
- [ ] Two workers running concurrently never process the same job twice.
- [ ] Killing a worker mid-job returns the job to the queue after the visibility timeout, not into limbo.
- [ ] Scheduled endpoints reject unauthenticated calls.
- [ ] `/admin/jobs` shows depth, failures and lets an operator retry a dead-lettered job.
- [ ] Webhook handling stays under 1s because processing is queued (ticket 13's criterion).
- [ ] Every scheduled sweep is itself idempotent — running twice in a day changes nothing extra.
