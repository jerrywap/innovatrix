# Choosing the job runner

**Status:** accepted, 2026-08-16 · **Ticket:** 25 · **Spec:** §86

Ticket 25 asks for this decision to be recorded. It lives here rather than in a
`docs/adr/` tree because the repo has no such tree, and the convention it does
have is a topic document next to the code it describes — `src/lib/db/ERD.md`,
`STATES.md`, `INTEGRITY.md`. Inventing a second convention for one file would be
worse than following the one already in use.

## The decision

**A MongoDB-backed queue**: a `jobs` collection, an atomic claim, and a drain
function that either a long-lived worker or a cron route calls.

## The options, and why the other two lost

| Option | Fits when | What it costs here |
|---|---|---|
| **MongoDB queue** | Mongo is already the datastore; volume is modest | We own visibility timeouts, backoff and dead-lettering |
| BullMQ + Redis | Higher volume; a mature dashboard is worth paying for | Redis in every environment, including CI |
| QStash / Inngest / Cloud Tasks | Serverless with no long-lived worker | An external dependency and per-message cost |

Two things settled it.

**Transactional enqueue is the requirement, and only one option can do it.**
`withTransaction`'s own doc comment has said since ticket 01 that side effects
belong on the session — "enqueue them on the session instead (ticket 25) so they
fire only on commit". With Redis or a platform queue, the enqueue has already
happened by the time the transaction aborts, so a rolled-back order leaves a
phantom confirmation email behind and the only defence is a compensating write
that can itself fail. With the queue in the same database, the job row is part
of the transaction and the problem does not exist.

**We had the pattern already, working, in production.** `webhookEvents` has been
a single-purpose queue since ticket 13: a guarded `findOneAndUpdate` for the
claim, an `attempts` counter, a retryable-versus-terminal `fail()`. It has been
verified live. Generalising a mechanism that works beat adopting one that would
have to be.

Volume is the assumption underneath both. The whole schedule is six recurring
sweeps plus one job per notification email — hundreds a day, not millions. A
polling queue over an indexed collection is not the bottleneck at that scale,
and if it becomes one, `enqueue` / `claimNext` / `drainQueue` is a small enough
surface to reimplement behind.

## The hosting question stays open, deliberately

Business decision #10 — Vercel or a container host — was listed as blocking this
ticket. It is not, because everything funnels through one function:

```
drainQueue({ maxJobs, budgetMs })
   ↑                        ↑
worker.ts (container)    /api/cron/tick (serverless)
```

`JOBS_WORKER=inline` starts the in-process loop from
`instrumentation.register()`. `JOBS_WORKER=off` leaves the queue to the cron
route. Moving between them is one environment variable; no job changes, and
neither path has semantics the other lacks.

## What we own, and where each part is

Choosing Mongo means implementing what BullMQ would have supplied:

| Behaviour | Where |
|---|---|
| Atomic claim (two workers, one job) | `queue.ts` → `claimNext` |
| Lease, and reclaim when a worker dies | `queue.ts` → `reclaimExpiredLeases` |
| Exponential backoff with jitter | `queue.ts` → `backoffFor` |
| Dead-letter, error retained | `queue.ts` → `fail` |
| Idempotent enqueue | the unique sparse index on `idempotencyKey` |
| Transactional enqueue | `enqueue(..., { session })` |
| Observability | `/admin/jobs`, `features/jobs/jobs-view.ts` |

The jitter is the one that looks optional and is not: without it, ten jobs that
failed together because a provider was down all retry in the same millisecond,
and hit it again together.

## Consequences

- **A job is at-least-once, not exactly-once.** A worker killed between the
  handler returning and `complete()` will run the job again after the lease
  expires. Handlers must tolerate it — the sweeps do, by narrowing their filters
  to rows they have not already handled, and `reconcile-pending-payments` does
  because `processPaymentSucceeded` re-verifies.
- **Latency is bounded below by the poll interval** (`JOBS_POLL_MS`, 5s by
  default), or by the cron interval on serverless. Nothing in the schedule cares.
- **Succeeded rows are swept after seven days; dead rows never are.** A
  dead-letter that expired would be a failure nobody ever saw.
- **No dashboard came for free.** `/admin/jobs` is ours to maintain.

## Not built, and why

- **`generate-quote-pdf` / `generate-invoice-pdf`** — there is no PDF pipeline.
  The quote and invoice documents are print-styled HTML components and the
  browser's own print-to-PDF renders them. Adding headless Chrome to the deploy
  image to render pages we can already render was declined.
- **`cleanup-expired-carts`** — a TTL index on `Cart.expiresAt` already does it.
- **`cleanup-orphaned-uploads`** — finding an orphan means listing the bucket and
  diffing against `productFiles`. The bucket is shared with unrelated live
  applications including regulated PII, so granting this app `s3:ListBucket`
  over it is a capability decision rather than an implementation detail; and
  `s3:DeleteObject` is denied, so even a correct sweep could only produce a
  list. Left out rather than stubbed.
