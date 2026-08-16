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
- [x] A job enqueued inside a transaction that then rolls back is never executed.
- [x] The same idempotency key enqueued twice runs once.
- [x] A handler that throws is retried with growing backoff, then dead-lettered with the error retained.
- [x] Two workers running concurrently never process the same job twice.
- [x] Killing a worker mid-job returns the job to the queue after the visibility timeout, not into limbo.
- [x] Scheduled endpoints reject unauthenticated calls.
- [x] `/admin/jobs` shows depth, failures and lets an operator retry a dead-lettered job.
- [x] Webhook handling stays under 1s because processing is queued (ticket 13's criterion).
- [x] Every scheduled sweep is itself idempotent — running twice in a day changes nothing extra.

---

## What shipped, and what did not

### The runner

**A MongoDB-backed queue** — the ticket's own default recommendation. The reasoning
is recorded in `src/services/jobs/DECISION.md` rather than in a `docs/adr/` tree,
because the repo has no such tree and its actual convention is a topic document
beside the code (`src/lib/db/ERD.md`, `STATES.md`, `INTEGRITY.md`).

Two things decided it. **Transactional enqueue is the requirement and only one
option can satisfy it** — with Redis or a platform queue the enqueue has already
happened by the time the transaction aborts. And **the pattern already existed
and worked**: `webhookEvents` has been a single-purpose queue since ticket 13,
with a guarded claim and an attempts counter, verified live.

### The hosting decision did not need making

Business decision #10 was listed as blocking this ticket. It is not, because
everything funnels through one function:

```
                drainQueue({ maxJobs, budgetMs })
                   ↑                          ↑
     worker.ts (JOBS_WORKER=inline)    /api/cron/tick (JOBS_WORKER=off)
```

Moving between a container and a serverless host is one environment variable.
No job changes, and neither path has semantics the other lacks.

### Jobs implemented

`send-email` · `retry-notification-emails` · `expire-quotes` ·
`mark-invoices-overdue` · `send-invoice-reminders` · `send-followup-reminders` ·
`reconcile-pending-payments`.

Three of the ticket's named jobs are **not** built, each for a reason recorded
in `types.ts` and `DECISION.md` rather than left as a stub:

- **`generate-quote-pdf` / `generate-invoice-pdf`** — there is no PDF pipeline in
  the project. `quote-document.tsx` and `invoice-document.tsx` are print-styled
  HTML and the browser's own print-to-PDF renders them. Adding headless Chrome to
  the deploy image to render pages we can already render was declined.
- **`cleanup-expired-carts`** — already done, by a TTL index on `Cart.expiresAt`.
  Rebuilding it as a job would be more code, more failure modes, same outcome.
- **`cleanup-orphaned-uploads`** — cannot be built honestly. Finding an orphan
  means listing the bucket and diffing against `productFiles`, and the bucket is
  shared with unrelated live applications including regulated PII, so granting
  this app `s3:ListBucket` over it is a capability decision rather than an
  implementation detail. `s3:DeleteObject` is denied besides, so even a correct
  sweep could only produce a list. **Left out rather than stubbed.**

`create-entitlements` is already inside fulfilment's transaction, where it
belongs, and `notify-version-released` already reaches the bus.

### Two things fixed on the way, both pre-existing

**The email retry query described a state that could not exist.** The email
channel driver stamped `channels: "email"` and `emailSentAt` in the same update,
on success only — so "an `email` channel and no `emailSentAt`", which two code
comments named as ticket 25's retry handle, matched nothing, ever. Fixed at the
root: `channels` now records the channels that were *intended*, resolved before
the row is written. The old integration test asserted the weaker property and
passed throughout.

**`CRON_SECRET=` in `.env.example` crashed the app at boot.**
`z.string().min(16).optional()` looks right and is not — an empty string is
*present*, so `.optional()` never applies and `.min(16)` rejects it. Following
the README's own quick start produced a process that would not start. Fixed with
an `optionalShaped()` preprocessor (the codebase already had `optionalBool` for
exactly this, for enums) applied to `CRON_SECRET`, `OPENROUTER_API_KEY` and
`OPENROUTER_SITE_URL`, with a regression test. Found by trying to verify the
503-when-unset posture rather than reading it.

### New environment

`JOBS_WORKER` (`inline` | `off`) · `JOBS_POLL_MS` · `JOBS_VISIBILITY_TIMEOUT_MS`.
`CRON_SECRET` is reused for `/api/cron/tick`.

### Consequences worth knowing

- **A job is at-least-once, not exactly-once.** A worker killed between the
  handler returning and `complete()` runs the job again once the lease expires.
  Every handler tolerates it.
- **Latency is bounded below by the poll interval** (5s by default), or by the
  cron interval on serverless. Nothing in the schedule cares.
- **Succeeded rows are swept after seven days; dead rows never are.** A
  dead-letter that expired would be a failure nobody ever saw.

## Live verification (2026-08-16)

`npm run jobs:probe`, against the real dev database and the seeded organisation:

```
SCHEDULE
  reconcile-pending-payments   every 15 min
  retry-notification-emails    every 15 min
  mark-invoices-overdue        every 1440 min
  expire-quotes                every 1440 min
  send-invoice-reminders       every 1440 min
  send-followup-reminders      every 1440 min

  tick 1 enqueued 6, skipped 0
  tick 2 enqueued 0, skipped 6  ← idempotent

TRANSACTIONAL ENQUEUE
  rows before 0, after rollback 0  ← nothing leaked

NOTIFICATION → QUEUE
  written 1, skipped 0, failed 0
  send-email jobs pending: 1

DRAIN
  claimed 6 · succeeded 6 · failed 0 · dead 0 · reclaimed 0
```

All six sweeps ran green against real seeded data, and the notification's email
reached `.dev-emails/` **through the queue** with an absolute link — the whole
leg, dispatch → notification row → job → transport.

The auth ladder on both cron routes, by curl:

```
no header                     401
wrong x-cron-secret           401
wrong Authorization: Bearer   401
correct secret                200
CRON_SECRET unset             503   ← refuses rather than running open
```

Reconciliation reported one seeded payment the provider does not recognise
(`PAY-2026-0001`, "Transaction reference not found") — the expected result for
seed data, handled per item, and the job still succeeded.

`/admin/jobs` was left dead-letter-free by the probe, so the retry control was
exercised against a job failed deliberately in the integration suite rather than
on the screen.

### Ticket 13's criterion, and why it is ticked

"Webhook handling stays under 1s because processing is queued" was already true
before this ticket: `/api/webhooks/[provider]` persists the event row, returns
200, and processes in `after()`. The retry it lacked is
`reconcile-pending-payments`, which is now a scheduled job rather than a route
body — with an attempt count, backoff, and a dead-letter that shows up on a
screen instead of a 500 in a scheduler's log nobody reads.
