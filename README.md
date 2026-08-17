# Innovatrix

A software acquisition and delivery platform. Customers buy software that
already exists, have it adapted to how they work, or commission it outright —
then have it installed, supported and maintained.

Three doors into the same pipeline: a **marketplace** of ready-made products, an
**AI assistant** that turns "here's my problem" into a scoped customization
request, and a **custom-build** conversation for work that has no product behind
it yet. Everything downstream — quotes, invoices, payments, licences, downloads
— is one flow regardless of which door somebody came through.

Next.js 16 · React 19 · MongoDB · TypeScript · Tailwind 4

---

## Requirements

| | |
|---|---|
| **Node** | **≥ 20.19** (`.nvmrc` says 22, which is what CI uses) |
| npm | 10+ |
| MongoDB | **as a replica set** — see below |
| Docker | optional, only if you want `npm run db:up` |
| S3-compatible storage | optional for local work; see [Storage](#storage-is-optional-locally) |

### MongoDB must be a replica set, and that is not negotiable

Checkout, payment fulfilment, quote acceptance and request submission all run in
**multi-document transactions**, and a transaction cannot start on a standalone
`mongod`. If you point this at a plain local MongoDB, everything reads fine and
every write that matters fails with:

```
This MongoDB deployment does not support transactions — a replica set is required.
```

A **single-node** replica set is enough. Two ways to get one:

#### Option A — Docker (isolated, no effect on anything else)

```bash
npm run db:up      # starts mongo:8 with --replSet rs0, waits for a primary
npm run db:down    # stop, keep the data
npm run db:reset   # stop and wipe
```

The healthcheck in `docker-compose.yml` is what actually runs `rs.initiate()`,
which is why `--wait` matters. It binds **port 27017**.

> ⚠️ If you already run a local `mongod` on 27017, `db:up` will collide with it.
> Stop yours first, or use Option B.

#### Option B — convert an existing local mongod to a replica set

Right if you have other projects using the same MongoDB. It keeps all existing
data and stays backwards-compatible for every other client.

```bash
# 1. Back up the config, then add the replica-set name.
sudo cp /usr/local/etc/mongod.conf /usr/local/etc/mongod.conf.backup
printf '\nreplication:\n  replSetName: rs0\n' | sudo tee -a /usr/local/etc/mongod.conf

# 2. Restart. (`brew services restart` fails if the mongodb/brew tap is
#    untrusted on your machine — this works either way.)
launchctl kickstart -k gui/$(id -u)/homebrew.mxcl.mongodb-community

# 3. Initiate the set, once.
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'

# 4. Confirm a primary was elected.
mongosh --eval 'rs.status().myState'   # 1 = PRIMARY
```

Then set the URI **with the `replicaSet` parameter** — the app derives
transaction support from the connection string, so without it transactions stay
switched off even though the server supports them:

```
MONGODB_URI=mongodb://localhost:27017/innovatrix?replicaSet=rs0&retryWrites=false
```

---

## Quick start

```bash
npm install
cp .env.example .env.local

# Generate the two secrets that have no sensible default.
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.local

npm run db:up      # or use your own replica set — see above
npm run db:seed
npm run dev
```

Then open <http://localhost:3000> and sign in as
**`super@innovatrix.test`** / **`innovatrix-demo-2026`** — that is the
super-admin, and the same password works for every seeded account.
[Demo accounts](#demo-accounts) lists all sixteen and what each one can reach.

> Every `db:*` and `*:probe` script passes `--env-file=.env.local` explicitly.
> **`.env` alone will not work** — it must be `.env.local`.

> **Email in development: keep `EMAIL_TRANSPORT=log`.** Every seeded account is
> on `.test`, a reserved TLD that can never receive mail, so a real send bounces
> and the verification or reset link you wanted is nowhere. With `log`, the link
> is printed in the terminal and written to `.dev-emails/`. See
> [Reading email in development](#reading-email-in-development).

---

## Environment

`.env.example` is the full list with comments. `src/config/env.ts` validates it
at boot and refuses to start naming the variable that is wrong, so a typo is a
startup error rather than an `undefined` inside a payment call three weeks
later.

**Required** — nothing boots without these:

| Variable | Notes |
|---|---|
| `APP_URL` | absolute; must be https in production unless localhost |
| `MONGODB_URI` | must reach a replica set — see above |
| `AUTH_SECRET` | ≥ 32 chars · `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | exactly 64 hex chars · `openssl rand -hex 32` |
| `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | any S3-compatible credentials |

**Optional, and what you lose without each:**

| Variable | Without it |
|---|---|
| `PAYSTACK_SECRET_KEY` / `STRIPE_*` / `PAYPAL_*` | no card payments — offline "pay by transfer" still works end to end |
| `OPENROUTER_API_KEY` | the AI assistants degrade to a form (§104), and everything else works |
| `RESEND_API_KEY` | email is written to `.dev-emails/` as readable text files instead of being sent |
| `CRON_SECRET` | `/api/cron/*` returns **503** rather than running unauthenticated |
| `NEXT_PUBLIC_SENTRY_DSN` | nothing — no Sentry integration exists yet, only the seam |

Three variables exist in `src/config/env.ts` and are **not** in `.env.example`
because they are rarely needed: `STORAGE_FORCE_PATH_STYLE` (MinIO/LocalStack
only), `ENCRYPTION_KEY_VERSION` and `ENCRYPTION_KEYS_PREVIOUS` (key rotation —
see `ai-contexts/SECURITY.md`).

**Never put a secret behind `NEXT_PUBLIC_`.** Those are inlined into the browser
bundle. `npm run scan:bundle` greps the built output for known key shapes *and*
for the literal values in your environment, and CI runs it on every PR.

### Storage is optional locally

Without `STORAGE_*` the seed prints `release files: skipped — storage not
configured` and everything else seeds normally. The catch: **the Download button
in My Software has no bytes behind it**. Everything up to and including the
licence key works; only the artefact is missing.

---

## Seeding

```bash
npm run db:seed        # idempotent — safe to run any number of times
npm run db:seed:bulk   # + 1000 synthetic products, for pagination and search work
npm run db:indexes     # sync indexes after a schema change
```

The seed **upserts on natural keys** and never wipes. Two deliberate
refinements: a password you changed while testing is not reset, and an existing
S3 `storageKey` is reused rather than re-minted (which would orphan objects).

To start clean, wipe the *database*: `npm run db:reset && npm run db:seed`.

### What you get

- **16 users** — 11 staff (one per role) and 5 in one customer organisation
- **1 organisation** — Brightpath Care (Leeds, GBP)
- **4 published products** — Atlas CRM (£299), Tenancy (£450), Roster (£380),
  Freightline (£520). Each with a released `1.0.0`, prices in GBP/USD/NGN, a
  licence package and two add-ons
- **28 taxonomy terms** across category, industry, technology and product type
- **1 fulfilled order** (`ORD-2026-0001`) with an entitlement and a licence key,
  so My Software has something in it immediately
- **4 tax rules** (UK VAT, NG VAT, rest-of-world zero)
- **4 discount codes** — `LAUNCH15` (15% off), `SAVE50` (£50 off, min £300),
  `SOLDOUT` (deliberately exhausted), `EXPIRED10` (deliberately expired)

### What is empty after seeding

Worth knowing before you go looking. These screens render their empty state
because there is genuinely nothing there:

| Empty | How to create one |
|---|---|
| Requests | Product → *Request customization*, or `/custom-software` |
| Quotes | Staff: a request → *Draft a quote* |
| Invoices | Accept a quote as the customer |
| Messages | Reply on any request |
| Notifications | Anything above produces some |
| Carts | Add something to one |
| Payment providers | `/admin/settings/payments` — the keys come from the environment, the routing from the UI |
| Jobs | `npm run jobs:probe`, or wait for the worker's first tick |

---

## Demo accounts

**Password for every account below: `innovatrix-demo-2026`**

This is hard-coded in `scripts/seed.ts` rather than read from the environment,
deliberately — a seed that can be pointed at production with a real-looking
password is a seed that eventually is. It is local fixture data, not a secret,
which is why it is written down in a public repository.

### Staff — one per role

The role is the point: each account reaches a different part of the platform,
and the differences are the permission model working.

| Email | Role | What they can do |
|---|---|---|
| `super@innovatrix.test` | `super_admin` | everything — all 51 permissions |
| `service@innovatrix.test` | `customer_service` | front line: customers, requests, orders, messages. No pricing, refunds or publishing |
| `sales@innovatrix.test` | `sales` | Customer 360 and the full quote lifecycle |
| `analyst@innovatrix.test` | `technical_analyst` | triage and scope. Can **draft** a quote, cannot **issue** one |
| `dev@innovatrix.test` | `developer` | products, files, project milestones |
| `pm@innovatrix.test` | `project_manager` | assignment, projects, order status |
| `support@innovatrix.test` | `support_agent` | read-only, plus internal notes and customer replies |
| `market@innovatrix.test` | `marketplace_manager` | the storefront: products, publishing, taxonomy, discounts |
| `finance@innovatrix.test` | `finance` | payments, invoices, refunds, tax. Deliberately **no** discounts |
| `devops@innovatrix.test` | `devops` | `/admin/jobs`, `/admin/audit`, settings |
| `content@innovatrix.test` | `content_manager` | product content and taxonomy |

Start with `super@` to see everything, then `finance@` and `market@` to see the
boundaries — they are the clearest pair.

### Customers — all in Brightpath Care

| Email | Org role | What they see |
|---|---|---|
| `amara@brightpath.test` | `owner` | everything, including billing |
| `kwame@brightpath.test` | `admin` | everything except ownership transfer |
| `bilal@brightpath.test` | `billing` | invoices and payments |
| `tobi@brightpath.test` | `technical` | software and downloads — **not** invoices (§89) |
| `nina@brightpath.test` | `member` | the least of anyone |

### Product demo credentials

Different thing entirely: encrypted showcase credentials for the demo
environments, stored as AES-256-GCM ciphertext and decrypted per viewer
depending on the product's exposure setting.

| Product | Exposure | Username | Password |
|---|---|---|---|
| Atlas CRM | `public` — anyone | `admin@atlas.demo` | `demo-admin-2026` |
| Atlas CRM | `public` | `sales@atlas.demo` | `demo-sales-2026` |
| Tenancy | `authenticated` — signed in | `landlord@tenancy.demo` | `demo-landlord-2026` |
| Tenancy | `authenticated` | `tenant@tenancy.demo` | `demo-tenant-2026` |
| Roster | `owners_only` — must own it | `manager@roster.demo` | `demo-manager-2026` |
| Freightline | *nothing configured* | — | — |

Freightline has no demo block on purpose: it is the fixture for "this product
has no demo", which is a state the product page has to handle.

---

## Reading email in development

Every seeded account is on `.test` — `super@innovatrix.test`,
`amara@brightpath.test`. That is not laziness: `.test` is reserved by IANA
precisely so it can never resolve, which makes these addresses safe to commit
and impossible to accidentally mail.

It also means **a real send can only fail**. Handing
`super@innovatrix.test` to an SMTP server gets you:

```
550 The mail server could not deliver mail to super@innovatrix.test.
    The account or domain may not exist…
```

and the reset link is gone — `sendAuthEmail` swallows the failure outside
development so a bounce never breaks sign-up, and the queue simply retries an
address that cannot exist.

### The switch

```bash
EMAIL_TRANSPORT=log    # .dev-emails/ + the terminal  ← use this locally
EMAIL_TRANSPORT=smtp   # really send, via SMTP_*
```

Left blank it derives: `smtp` if `SMTP_HOST` is set, otherwise `log`. Set it to
`log` explicitly and it wins **even with working SMTP credentials**, which is the
case it exists for. `EMAIL_TRANSPORT=smtp` with no `SMTP_HOST` refuses to boot
rather than silently sending nothing.

The transport is chosen once per process and announced, so "why did that email
not arrive" is answerable from the first line of the log:

```
[email] transport: log (.dev-emails/)
```

**Changing it needs a `next dev` restart** — the transport is memoised for the
life of the process, and its connection pool with it.

### Where the mail goes

```bash
ls -t .dev-emails | head          # newest first, one .txt per message
cat ".dev-emails/$(ls -t .dev-emails | head -1)"
```

Each file carries the recipient, subject, and the body with any link in it. The
terminal also prints a banner with just the URL, so a verification or reset link
can be clicked straight out of the log. `.dev-emails/` is gitignored — the link
*is* the credential.

So a password reset for a seeded account works end to end: request it, read the
link out of `.dev-emails/`, open it, set a new password.

---

## Scripts

**Develop**

| | |
|---|---|
| `npm run dev` | dev server on :3000 |
| `npm run build` · `npm start` | production build and serve |

**Database**

| | |
|---|---|
| `db:up` · `db:down` · `db:reset` | Docker MongoDB replica set |
| `db:seed` · `db:seed:bulk` | seed; +1000 synthetic products |
| `db:indexes` | sync indexes — **also drops undeclared ones**, so it is the migration path |
| `db:docs` | regenerate `src/lib/db/{ERD,STATES,INTEGRITY}.md` |
| `db:explain` · `db:explain:queues` | check the marketplace and staff-queue queries use their indexes |

**Probes** — drive real code against the real dev database and print what
happened. They exist because a unit test cannot tell you that audience
resolution found the right people.

| | |
|---|---|
| `jobs:probe` | the schedule, transactional enqueue, a real drain |
| `requests:probe` · `ai:probe` | request lifecycle; AI provider connectivity |
| `storage:probe` · `storage:media-probe` | S3 credentials, prefix enforcement, upload round-trip |

**Quality**

| | |
|---|---|
| `test:unit` | 545 tests, **~4s** — run this while working |
| `test:integration` | 260 tests against one shared in-memory replica set, ~2min |
| `test` | both |
| `test:coverage` | with thresholds on `lib/`, `services/`, `config/` |
| `lint` · `typecheck` · `format` | |
| `verify` | lint + typecheck + test — what to run before pushing |
| `scan:bundle` | after `build`: no server secret reached the browser |
| `audit:deps` | `npm audit`, gated at high |

---

## Layout

```
src/
  app/            routes only — thin, guarded, mostly Server Components
    (public)/     marketplace, product pages, cart, checkout, the AI doors
    (auth)/       sign in, register, verify, reset, accept invite
    dashboard/    the customer portal
    staff/        queues, requests, quotes, invoices, messages
    admin/        products, orders, payments, users, jobs, audit, settings
    api/          route handlers: webhooks, downloads, cron, health, AI stream
  features/       per-screen view models, server actions and components
  services/       the business logic — nothing here knows about HTTP
  repositories/   data access, org-scoped and paginated by construction
  lib/            auth (the DAL), db, money, events, jobs, logger, rate limiting
  components/     shared UI primitives
```

Two rules that shape everything: **business logic lives in `services/`**, and
**every page and every server action calls the DAL first**. `AGENTS.md` has the
full set and the reasoning behind each.

`typedRoutes` is on, so a link to a route that does not exist is a compile
error rather than a 404 somebody finds later.

---

## Documentation

| | |
|---|---|
| `AGENTS.md` | the conventions a feature screen must follow — **read this before writing code** |
| `ai-contexts/00-techinical.md` | the product and technical specification, `§`-referenced throughout the code |
| `ai-contexts/01-mvp-todo.md` | the tracker |
| `ai-contexts/tickets/` | 30 tickets, each with what shipped and what did not |
| `ai-contexts/SECURITY.md` | controls, rate limits, CSRF, key rotation, retention, accepted risks |
| `ai-contexts/OPERATIONS.md` | environments, migrations, deploy, smoke test, rollback |
| `ai-contexts/tickets/29-human-checklist.md` | the manual test plan — the four critical journeys, every persona, mobile, a11y |
| `src/lib/db/ERD.md`, `STATES.md`, `INTEGRITY.md` | generated: the data model, its state machines, its invariants |

## Known limitations

Honest, and expanded on in the ticket docs:

- **No staging or production environment.** `OPERATIONS.md` specifies both;
  nothing provisions them, and rollback is documented but unrehearsed.
- **No E2E test automation.** Deliberate — replaced by the ticket-29 human
  checklist. A journey regression will not be caught automatically.
- **No Sentry.** Structured logging, `/api/health` and stable alert codes exist;
  nothing ingests them yet.
- **Card payments are configured but lightly exercised.** Only Paystack is set
  up in dev and it does not take GBP, so the offline path is the one that has
  been driven end to end.
- **No PDF generation.** Quote and invoice documents are print-styled HTML;
  the browser's own print-to-PDF is the pipeline.
- **`script-src` carries `'unsafe-inline'`** — nonce-based CSP is incompatible
  with the Partial Prerendering this app relies on. Reasoning in
  `src/config/security-headers.ts`.
