# Environments, migrations and rollback

Ticket 28's §97 half. `SECURITY.md` covers the security posture; this covers
where the thing runs and what to do when a deploy goes wrong.

Written **2026-08-16**, before there is a staging or production environment.
That is deliberate rather than premature: the decisions below are cheap now and
expensive once there is data to migrate.

---

## Environments

| | Local | Development | Staging / UAT | Production |
|---|---|---|---|---|
| Database | own mongod or `npm run db:up` | shared Atlas / container | own Atlas cluster | own Atlas cluster |
| Storage prefix | `innovatrix/development/` | `innovatrix/development/` | `innovatrix/staging/` | own bucket, own keys |
| Payment providers | test keys | test keys | test keys | **live keys** |
| AI | shared OpenRouter key | shared key | own key, spend cap | own key, spend cap |
| Email | `.dev-emails/` | `.dev-emails/` | real, to a catch-all | real |
| Seed | `npm run db:seed` | `db:seed` | anonymised subset | **never** |
| `JOBS_WORKER` | `inline` | `inline` | matches production | `inline` or `off` — see below |

Two things about this table are load-bearing.

**The storage prefix is not cosmetic.** The dev/staging bucket is shared with
unrelated live applications, including one holding regulated PII. Nothing may
be written or read outside `innovatrix/{env}/`, and `assertKeyInPrefix()`
enforces it on every key. Production has its own bucket and its own credentials.

**The seed never runs against production.** `scripts/seed.ts` hard-codes its
password rather than reading one from the environment, precisely so that a seed
pointed at production cannot create an account that looks real. That is a
guard, not a convenience.

## The one open decision

`JOBS_WORKER` is `inline` on a container and `off` on serverless — see
`src/services/jobs/DECISION.md`. Both paths call the same `drainQueue()`, so
this is an environment variable rather than a rewrite, and business decision
#10 (Vercel vs a container host) can stay open until there is a reason to close
it. On serverless, point a scheduler at `/api/cron/tick` every minute.

## Migrations

Mongo is schemaless, which means there is no migration *tool* and there are
still migrations. Two kinds:

### Indexes — `npm run db:indexes`

`syncIndexes()` creates what the models declare **and drops what they no longer
declare**. That second half is why it is a deploy step rather than something
`autoIndex` does lazily: a removed index disappearing silently, on a collection
whose queries still expect it, turns into a collection scan with no error
anywhere.

Run it **after** the new code is deployed, never before — an index the old code
does not know about is harmless; an index dropped while the old code still
needs it is an outage.

### Shape changes — `scripts/migrations/`

There are none yet, and this is the shape the first one takes:

```
scripts/migrations/2026-08-16-backfill-invoice-portion.ts
```

Every one must be:

- **Idempotent.** Run it twice and the second run changes nothing. Filter on
  the *absence* of the new shape (`{ portion: { $exists: false } }`), never on
  a counter or a date.
- **Reversible, or explicitly not.** A `down()` that restores the previous
  shape, or a comment saying why there isn't one. "Reversible" is what makes
  rollback a decision rather than a gamble.
- **Batched.** `updateMany` over a large collection holds a lock. Loop in
  batches of a few thousand with a filter that shrinks as it goes.
- **Additive first.** Write the new field while the old one is still read,
  deploy code that reads the new one, then remove the old in a *later* release.
  A migration and the code that depends on it in the same deploy is a window
  where one of them is live and the other is not.

## Deploying

```
merge to main
  → CI: lint · types · unit · integration · build · secret scan · audit
  → deploy staging
  → smoke (below)
  → manual approval
  → deploy production
  → npm run db:indexes
  → smoke
```

`db:indexes` after the deploy, for the reason above.

## Smoke test

Five things, in this order. Each one fails differently, and the order is
cheapest-first so a broken deploy is caught in seconds.

1. `GET /api/health` → `200 {"ok":true,"database":true,"storage":true}`.
   A 503 names which dependency; nothing else needs checking until it is green.
2. `GET /` and `GET /marketplace` → 200, and the page has products on it.
3. `GET /sitemap.xml` → 200 with more URLs than static pages, which proves the
   catalogue query ran.
4. Sign in as a staff account → `/staff` renders.
5. `GET /api/cron/tick` with the secret → 200, and `/admin/jobs` shows the
   scheduled jobs with a recent run.

## Rollback

**Not rehearsed.** There is no production environment to rehearse against, and
recording an untested procedure as tested would be worse than recording that it
is not. The procedure itself:

1. **Redeploy the previous build.** On any platform with immutable deploys this
   is a pointer change and takes seconds. Do this first — diagnose afterwards.
2. **Do not roll back the database by default.** The application is designed so
   that the previous release can read the current data: migrations are additive,
   and a field the old code does not know about is a field it ignores. Rolling
   the data back loses everything written since the deploy, including payments.
3. **If a migration must be undone**, run its `down()`, and only after the old
   code is already serving. If it has no `down()`, its comment says why — and
   the answer is a forward fix, not a restore.
4. **Indexes look after themselves.** The old code's `syncIndexes()` recreates
   what it needs on the next deploy. An extra index is a cost, not a fault.
5. **Check the queue.** Jobs enqueued by the new code may name handlers the old
   code does not have. They dead-letter rather than fail silently, and
   `/admin/jobs` shows them with "no handler" against the name — retry them
   after rolling forward again.

The one case where a data restore is unavoidable is corruption rather than a
bug: something wrote wrong values. Atlas point-in-time restore, to a *new*
cluster, then compare before switching. Never restore in place over live data.

## What is not covered

- **No staging environment exists.** The table above is a specification.
- **No deploy automation.** CI builds and gates; nothing deploys.
- **Rollback is unrehearsed** — see above.
- **No alert routing.** `src/lib/alerts.ts` emits stable codes at `error` level;
  nothing yet reads them. That is the seam, not the integration.
