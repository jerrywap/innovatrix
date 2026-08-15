# 00 — Project Foundation & Conventions

**Bucket:** §0 Foundation · **Depends on:** — · **Blocks:** everything · **Size:** M
**Spec:** §80 (structure), §82 (services), §84 (money), §26 (references), §88 (secrets)

## Why
Every later ticket assumes a folder layout, a typed config, a money type, a reference generator, and a
consistent server-action result shape. Establishing them now costs a day; retrofitting them costs a month.

## Read first
`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md` and `07-mutating-data.md`.
This is Next.js **16.3.1** — `middleware.ts` is now **`proxy.ts`**, and `params`/`searchParams` are Promises.

## Scope
- Move the app into `src/` and establish the §80 layout:
  ```
  src/
    app/                 (public)/ (auth)/ dashboard/ staff/ admin/ api/
    features/            marketplace/ commerce/ requirements/ requests/ quotes/ billing/ notifications/
    components/          ui/ (shadcn) + shared primitives
    lib/                 money, references, errors, dates, crypto, ids
    services/            application services — the only place business logic lives
    repositories/        data access; every org-scoped query filters by organizationId here
    validators/          Zod schemas, shared by client and server
    types/  config/  emails/
  ```
- `tsconfig` path aliases (`@/features/*`, `@/lib/*`, …). Keep `strict: true`; add `noUncheckedIndexedAccess`.
- **Typed env config** (`src/config/env.ts`): Zod-parsed at module load, throws on boot if invalid. Two exports —
  `serverEnv` (guarded by `import 'server-only'`) and `publicEnv` (`NEXT_PUBLIC_*` only).
- **Money primitives** (`src/lib/money.ts`):
  - `type Money = { amount: number; currency: CurrencyCode }` where `amount` is **integer minor units**.
  - `add`, `subtract`, `multiply(qty)`, `percentage(bps)`, `sum`, `format(money, locale)`, `zero(currency)`.
  - Every operation throws on currency mismatch. Reject non-integer amounts.
  - Currency registry with `minorUnitExponent` (GBP 2, NGN 2, JPY 0) — do not hardcode ×100.
- **Reference generator** (`src/lib/references.ts`): `REQ|CUS|PRJ|CHG|TKT|ORD|INV|QUO-YYYY-NNNN` (§26).
  Implement with an atomic `findOneAndUpdate` `$inc` on a `counters` collection, keyed by `prefix:year`.
  Database `_id` stays independent of the business reference.
- **Server action result shape** (`src/lib/action-result.ts`):
  `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string,string[]> }`.
  Add a `withAction` helper that catches, logs, and converts thrown domain errors — never leak stack traces.
- **Domain errors** (`src/lib/errors.ts`): `DomainError`, `NotFoundError`, `ForbiddenError`, `ValidationError`,
  `StateTransitionError`, `PaymentError`. Each carries a safe, user-facing message.
- `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`.
- ESLint + Prettier + `lint-staged`; npm scripts `dev build start lint typecheck test`.
- `.env.example` listing every variable with a comment; `.gitignore` covers `.env*`.

## Out of scope
Auth, database, UI kit — tickets 01/03/04.

## Acceptance criteria
- [ ] `npm run typecheck` and `npm run lint` pass on a clean tree.
- [ ] Booting with a missing required env var fails fast with a message naming the variable.
- [ ] `format({amount: 29999, currency: 'GBP'})` → `£299.99`; `format({amount: 29999, currency:'NGN'})` → `₦299.99`.
- [ ] Adding GBP to USD throws.
- [ ] 1,000 concurrent reference generations produce 1,000 distinct, gapless references for the year.
- [ ] Importing `serverEnv` from a client component is a build error.
- [ ] No `NEXT_PUBLIC_` variable holds a secret.

## Verification
Unit tests for money and references (including the concurrency case) land in ticket 28's harness; write them here.
