# 01 — MongoDB Connection & Data-Layer Conventions

**Bucket:** §0.8–0.9 · **Depends on:** 00 · **Blocks:** 02 and everything after · **Size:** M
**Spec:** §83 (database), §84 (money), §103 (single source of truth)

## Why
MongoDB gives us no foreign keys and no `CHECK` constraints. Every integrity guarantee this platform needs —
"an entitlement always points at a real order", "a paid order is never fulfilled twice" — has to be produced by
the data layer and the service layer. This ticket builds that layer before any collection exists.

## Scope

### Connection
- `src/lib/db/client.ts`: Mongoose connection cached on `globalThis` so Next.js HMR and serverless warm starts
  don't open a new pool per request. Guard with `import 'server-only'`.
- Connection options: `maxPoolSize`, `serverSelectionTimeoutMS`, `retryWrites: true`, `w: 'majority'`.
- Model registration must be idempotent — `mongoose.models.X ?? mongoose.model('X', schema)`. Without this,
  HMR throws `OverwriteModelError` on every save.
- **Local dev needs a replica set** (transactions require one). Ship a `docker-compose.yml` with a single-node
  replica set, or document Atlas local dev. Add a `db:up` script.

### Conventions (`src/lib/db/base.ts`)
- Base schema options applied everywhere: `timestamps: true`, `versionKey: false`,
  `toJSON: { virtuals: true, transform }` that maps `_id` → `id` and strips internals.
- **Money sub-schema**: `{ amount: { type: Number, required: true, validate: Number.isInteger }, currency: String }`.
  Never `Double`. Add a schema-level validator that rejects non-integers — this is the single most likely
  silent corruption in the system.
- **Soft delete** convention: `deletedAt: Date | null` plus a repository helper that excludes it by default.
- **Tenancy**: every org-owned document carries `organizationId`. A shared `orgScoped()` helper adds the field,
  indexes it, and the repository base class refuses to build a query without it.
- Standard `status` fields are string enums declared in `src/lib/db/enums.ts`, shared with Zod validators so the
  database and the API can't drift.

### Transactions
- `withTransaction<T>(fn: (session) => Promise<T>): Promise<T>` in `src/lib/db/transaction.ts`.
  Handles `TransientTransactionError` retry (Mongo's documented retry loop), commits, aborts on throw.
- Document the mandatory-transaction list — these operations must never partially apply:
  1. Checkout: create order + reserve/clear cart.
  2. Payment verified: mark payment paid + order paid + create entitlements + issue licences.
  3. Quote accepted: quote state + invoice creation.
  4. Reference generation used inside any of the above must join the same session.

### Repository base
- `src/repositories/base.ts` with `findById`, `findOne`, `list({filter, sort, page, limit})`, `create`, `update`,
  `softDelete` — all accepting an optional `session`.
- **Pagination is mandatory**: `list()` requires a limit and caps it (default 20, max 100). §94 forbids loading
  unbounded sets.
- A `populate` policy: prefer explicit second queries over deep populate chains; document N+1 hotspots.

### Integrity rules (the substitute for foreign keys)
Write `src/lib/db/INTEGRITY.md` recording, for each reference field:
- what it points at, whether it is required, and what happens if the target is deleted (restrict / null / cascade);
- which service is responsible for enforcing it.
Then enforce in services. Do not scatter existence checks through UI code.

## Out of scope
The collections themselves — ticket 02.

## Acceptance criteria
- [ ] Hot-reloading a file that imports a model does not open a new connection or throw `OverwriteModelError`.
- [ ] `withTransaction` rolls back every write when the callback throws (test with a deliberate mid-way failure).
- [ ] A retryable transient transaction error is retried and succeeds.
- [ ] Saving a money field with `29.99` (a float) is rejected by the schema validator.
- [ ] `list()` without a limit throws; with `limit: 5000` it clamps to 100.
- [ ] An org-scoped repository query built without `organizationId` throws in development.
- [ ] `INTEGRITY.md` exists and covers every reference field introduced in ticket 02.
