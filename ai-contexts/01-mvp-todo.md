# Innovatrix — MVP Task Bucket List

Derived from `ai-contexts/00-techinical.md` (the product spec — **always read it for full context**), cross-checked
against the **current state of the repo**: a bare `create-next-app` (Next.js 16.3.1, React 19.2, Tailwind v4,
TypeScript) with a single `app/page.tsx`. Everything below is greenfield.

Detailed tickets live in `ai-contexts/tickets/NN-*.md`. Every row here maps to a ticket; every ticket maps back here.

Status key: `[x]` Done · `[~]` Skeleton/partial (UI or stub exists, real behaviour missing) · `[ ]` Not started

Column meaning: **FE** = Next.js route/page/component work (RSC + client islands). **BE** = server actions, services,
repositories, Mongoose models, jobs, webhooks, real business logic.

---

## Stack decisions (locked — do not re-litigate)

| Area | Decision | Why |
|------|----------|-----|
| Framework | **Next.js 16.3.1, App Router** | Spec §80. Note: this version renames `middleware.ts` → **`proxy.ts`**. Read `node_modules/next/dist/docs/` before writing routing/caching code. |
| Database | **MongoDB + Mongoose** (Atlas) | Catalog (§8, §42–43) and AI conversations (§72) are document-shaped. Integrity for money lives in the service layer + transactions. |
| Auth | **Better Auth** (MongoDB adapter, organization plugin) | Maps directly onto §76 organizations and §77 staff roles. |
| Payments | **Provider abstraction: Paystack + Stripe + PayPal**, selectable per-currency in admin | §62. Webhook is the source of truth (§13, §103). |
| Object storage | **S3-compatible** (Cloudflare R2 or AWS S3), signed URLs only | §44, §66, §85. |
| AI | **OpenRouter** via the `openai` SDK; model chosen in `/admin/settings/ai`, default `google/gemini-3.7-flash` | §71–73, §104. One gateway, one bill, model swappable without a deploy. `claude-opus-4.1` was the original default and cannot do structured output. |
| Money | **Integer minor units + ISO-4217 currency code**, BSON `Int32`/`Int64` — never `Double` | §84. |
| UI | Tailwind v4 + shadcn/ui, RSC-first | §81. |

---

## MVP scope boundary

**In scope** — the full revenue loop, both entry doors, and the staff side that services them:

```
Marketplace → Product → Cart → Checkout → Payment → Entitlement → Download
Product     → Request Customization → AI Assistant → Request → Staff → Quote → Payment
Landing     → Build Custom Software → AI Assistant → Request → Staff → Quote → Payment
```

**Explicitly deferred to post-MVP** (spec Phases 3–5). Do not build these; do leave seams where noted:

* Projects, milestones, tasks, deliverables (§53–54)
* Customer testing / UAT sessions and approvals (§55)
* Change Requests (§56–57)
* Full ticketing system with SLA (§35–37) — MVP uses Requests + threaded messaging instead
* Tech Assistant hours and time tracking (§59–60)
* Maintenance plans, subscriptions, renewals (§67–68)
* Dynamic sandboxes and deployment automation (§10, §58)
* Semantic/vector search (§74) — MVP is keyword + facets, Atlas Search index left in place to grow into
* Product comparison (§6)
* Ratings/reviews (§6) — **un-deferred and now built** (vendor ticket 10, 2026-08-17). Purchase-gated on an active entitlement, one per entitlement by unique index, published on submission and reportable after. `AggregateRating` is emitted only where real reviews exist, which is the rule ticket 27 protected rather than an exception to it
* Refunds beyond a manual admin-recorded refund (§62)
* **Third-party vendors** — outside the MVP *and* outside the spec, which never mentions a second
  seller. Tracked as its own set in `tickets/vendor/`; summarised as bucket 20 below.

---

## 0. Foundation & Infrastructure

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 0.1 | Next.js 16 App Router skeleton: `src/` layout, route groups, path aliases, strict TS | [x] | [x] | 00 |
| 0.2 | Feature-folder architecture (`features/`, `services/`, `repositories/`, `validators/`) per §80/§82 | [x] | [x] | 00 | ← folders scaffolded; populated per feature ticket |
| 0.3 | Env config module — typed, validated at boot, server-only secrets | — | [x] | 00 | ← `src/config/env.ts` (+`public-env.ts`); `server-only` leak guard verified against a real build |
| 0.4 | Money primitives (`Money` type, minor units, formatting, arithmetic) — §84 | [x] | [x] | 00 | ← incl. `allocate()` for deposit splits (ticket 23) |
| 0.5 | Business reference generator (`REQ-2026-0148`, `ORD-…`, `INV-…`) — §26 | — | [x] | 00/01 | ← pure logic + port (00); Mongo atomic `$inc` store (01), proven at 500-way concurrency |
| 0.6 | Error handling: `error.tsx`, `not-found.tsx`, typed `ActionResult<T>` for server actions | [x] | [x] | 00 | ← incl. `global-error.tsx`, domain error taxonomy, `withAction`/`parseInput` |
| 0.6b | Tooling gate: `npm run verify` (lint → typecheck → test), Prettier, lint-staged + husky | — | [x] | 00 | ← 40 unit tests passing |
| 0.7 | Tailwind v4 + shadcn/ui installed, theme tokens, dark mode | [x] | — | 04 | ← shadcn tokens are *aliases* onto Meridian, never literals — `init` overwrites literals. Dark-mode completeness + AA enforced by `theme-tokens.test.ts`; Lighthouse a11y 100
| 0.8 | **MongoDB connection** (HMR-safe singleton), Mongoose base schema conventions, index strategy | — | [x] | 01 | ← `defineModel()` makes registration idempotent across HMR |
| 0.9 | **Transaction helper** (`withTransaction`) + replica-set local dev via Docker/Atlas | — | [x] | 01 | ← delegates to the driver's documented retry loop; `docker-compose.yml` + `npm run db:up` |
| 0.10 | Seed script — categories, industries, technologies, demo products, staff users, org | — | [x] | 02 | ← `npm run db:seed`, idempotent; also syncs indexes
| 0.11 | **Object storage service** — S3 client, signed upload + signed download, key namespacing | — | [x] | 05 | ← code complete + live-probed (`npm run storage:probe`). ⚠️ **two env blockers**: bucket serves objects publicly (fails §66), and `s3:DeleteObject` is denied. Both need bucket/IAM changes — see ticket 05. |
| 0.12 | **Background job runner** — queue, retries, scheduled jobs | — | [ ] | 25 |
| 0.13 | **AI service wrapper** — Anthropic client, streaming, structured output, cost logging | — | [ ] | 16 |

---

## 1. Domain Model

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 1.1 | ERD for the MVP subset of §78 (~28 of the ~45 conceptual entities) | — | [x] | 02 | ← `src/lib/db/ERD.md`, 26 collections, Mermaid + embed/reference rationale
| 1.2 | Collections: `users`, `organizations`, `organizationMembers`, `staffProfiles` | — | [x] | 02 |
| 1.3 | Collections: `products`, `productVersions`, `productFiles`, `taxonomies` | — | [x] | 02 |
| 1.4 | Collections: `carts`, `orders`, `entitlements`, `licences`, `downloads` | — | [x] | 02 | ← +`payments`, `webhookEvents`, `paymentSettings`
| 1.5 | Collections: `aiConversations`, `customerRequests`, `quotes`, `invoices`, `payments` | — | [x] | 02 | ← +`followUps`
| 1.6 | Collections: `conversations`, `messages`, `followUps`, `notifications`, `activityEvents`, `auditLogs` | — | [x] | 02 |
| 1.7 | Referential-integrity rules documented + enforced in services (no FKs in Mongo) | — | [~] | 01/02 | ← `INTEGRITY.md` complete; per-service enforcement lands with each feature ticket
| 1.8 | Index plan: unique refs, licence keys, slug uniqueness, staff-queue compound indexes | — | [x] | 02 | ← 120 indexes, `npm run db:indexes`; faceted search via a flattened `facets` array (Mongo can't index parallel arrays)

---

## 2. Identity, Organizations & Permissions

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 2.1 | Better Auth setup — email/password, email verification, password reset, sessions | [x] | [x] | 03 | ← 1.6.29; adapter creates NO indexes (ours do); `transaction` derived from the URI, not assumed
| 2.2 | Organizations + members with roles (Owner/Admin/Billing/Technical/Member) — §76 | [x] | [x] | 03 | ← `createAccessControl`; personal org auto-created at signup; invite/accept via the plugin
| 2.3 | Staff roles + permission matrix (§77) — permissions, not one admin flag | — | [x] | 03 | ← 41 permissions × 11 roles, union semantics, no `isAdmin`; `assertMatrixIsComplete()` gates the build
| 2.4 | **DAL** (`verifySession`, `requireOrg`, `requireStaff`, `requirePermission`) with React `cache` | — | [x] | 03 | ← memoization measured: 5 calls cost the same as 1 (2.05 vs 2.10 mongo ops/request)
| 2.5 | `proxy.ts` optimistic route guards (cookie-only, no DB reads) | — | [x] | 03 | ← measured: **0 mongo ops across 20 requests**
| 2.6 | Auth pages: register, login, verify, forgot/reset password | [x] | [x] | 03 | ← + accept-invite; server actions, no-JS forms, generic messages (§88). Reset tokens proven single-use
| 2.7 | Tenant isolation: every org-scoped query filtered by `organizationId` at the repository layer | — | [x] | 03 | ← scope comes from the session, never from client input; cross-tenant suite asserts `FORBIDDEN`, not merely "threw"
| 2.8 | Optional OAuth (Google) — behind a config flag | [ ] | [~] | 03 | ← wired behind `AUTH_GOOGLE_ENABLED`, off; untested (no credentials)

---

## 3. Application Shells & Design System

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 3.1 | Route groups: `(public)`, `(auth)`, `dashboard`, `staff`, `admin` with distinct layouts | [x] | [x] | 04 | ← each protected layout calls the DAL; layouts redirect, pages `forbidden()`, actions throw
| 3.2 | Public site chrome — header, mega-nav, footer, marketing landing (§4.1) | [x] | — | 04 | ← session-aware header, no flash; every footer link resolves (15 `href="#"` removed)
| 3.3 | Customer dashboard shell — sidebar per §28 (MVP modules only), mobile nav | [x] | — | 04 | ← role-filtered (billing sees invoices not deliverables); dashboard leads with actions (§102)
| 3.4 | Staff portal shell — queue-first navigation (§30) | [x] | — | 04 | ← permission-filtered; verified live for 4 roles
| 3.5 | Admin portal shell (§4.4) | [x] | — | 04 | ← gated on *management* permissions, not view — customer_service could otherwise reach catalogue management
| 3.6 | Shared primitives: DataTable, EmptyState, StatusBadge, Timeline, MoneyDisplay, FileDropzone | [x] | — | 04 | ← +PageHeader, StatCard, Attention, Stepper, ConfirmDialog, RichText. DataTable is an RSC on URL state
| 3.7 | Loading/streaming conventions — `loading.tsx`, Suspense boundaries, skeletons | [x] | — | 04 | ← per-segment `loading.tsx`/`error.tsx`; conventions written into `AGENTS.md`

---

## 4. Marketplace — Administration

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 4.1 | Taxonomy admin: categories, industries, technologies (§7) | [x] | [x] | 06 |
| 4.2 | Product create/edit wizard — the §42 step sequence, save-per-step draft | [x] | [x] | 06 |
| 4.3 | Product configuration fields (§43) incl. licence type, support/update duration | [x] | [x] | 06 |
| 4.4 | Media: screenshots + video, ordering, alt text | [~] | [x] | 06 |
| 4.5 | Pricing: per-currency prices (GBP/USD/NGN/…), licence packages, add-ons (§49) | [x] | [x] | 06 |
| 4.6 | Publishing lifecycle: Draft → Internal Review → Ready → Published → Deprecated → Archived (§46) | [x] | [x] | 06 |
| 4.7 | Product versions + changelog + release notes (§45) | [x] | [x] | 07 |
| 4.8 | Product file uploads to object storage, per version (§44) — never public paths | [~] | [x] | 07 |
| 4.9 | Demo configuration + **encrypted** demo credentials, exposure rules (§9) | [x] | [x] | 07 |
| 4.10 | Customization configuration — availability, suggested areas, AI workflow toggle (§50) | [x] | [x] | 06 |
| 4.11 | Internal product testing checklist before publish (§47) | [x] | [x] | 07 |

> **4.4, 4.8** — the *browser* half of uploading is blocked by ticket 05's environment issues (bucket
> CORS unset, so a PUT fails preflight; `s3:DeleteObject` denied, so a file could never be removed).
> The server half of 4.8 is verified against the real bucket: presigned PUT, a 3600s TTL, size and
> type inside the signature, and `verifyUpload` afterwards. 4.4's form takes an image URL meanwhile;
> `media[].storageKey` is already in the schema beside it.

---

## 5. Marketplace — Public Experience

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 5.1 | `/marketplace` listing — grid, pagination, sort (popular/latest/price) | [x] | [x] | 08 |
| 5.2 | Faceted filters: category, industry, technology, product type, price range | [x] | [x] | 08 |
| 5.3 | Keyword search (Mongo text index or Atlas Search) — §74 | [x] | [x] | 08 |
| 5.4 | Category / industry landing pages (SEO surfaces) | [x] | [x] | 08 |
| 5.5 | Featured / latest / recommended rails on the marketplace home | [x] | [x] | 08 |
| 5.6 | Recently viewed (cookie) + saved/favourites (account) | [~] | [x] | 08 |
| 5.7 | Product detail page — full §8 layout, gallery, features, requirements, changelog | [x] | [x] | 09 |
| 5.8 | Demo panel — public/customer/admin demo URLs + credentials per exposure rules (§9) | [x] | [x] | 09 |
| 5.9 | Primary CTAs: Buy As-Is · Request Customization · Try Demo · Save for Later | [x] | [~] | 09 |
| 5.10 | Related products | [x] | [x] | 09 |

> **5.6** — complete. Saved/favourites at `/dashboard/saved`, keyed on the user rather than the
> organisation. Recently-viewed is written in `proxy.ts` (a Server Component may not set a cookie)
> with a `Sec-Fetch-Dest` guard so a prefetch is not mistaken for a visit.
>
> **5.9** — all four CTAs are drawn. **Buy As-Is** is live end to end (ticket 10). **Try Demo**
> appears only when a demo exists, and goes to the external URL or to `#demo` depending on what is
> configured. **Request Customization** is drawn and correctly hidden when customization is off; the
> action behind it is ticket 17's, which is the remaining `[~]`.

---

## 6. Commerce — Cart, Checkout, Orders

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 6.1 | Cart model (guest cookie cart + user cart, merge on login), single currency per cart | [x] | [x] | 10 |
| 6.2 | Add/remove/update, licence-package selection, service add-ons (§11, §12) | [x] | [x] | 10 |
| 6.3 | Discount codes, tax lines, totals computed **server-side only** | [x] | [x] | 10 |
| 6.4 | Checkout flow: account → billing → review → pay → confirm (§13) | [~] | [x] | 11 |
| 6.5 | Order creation with **frozen price snapshot** per line (§61) | [x] | [x] | 11 |
| 6.6 | Order states: Pending → AwaitingPayment → Paid → Fulfilled → Cancelled/Refunded | [x] | [x] | 11 |
| 6.7 | Order confirmation page + emailed receipt | [x] | [~] | 11 |

---

## 7. Payments

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 7.1 | `PaymentProvider` interface — initiate, verify, webhook-parse, refund | — | [x] | 12 |
| 7.2 | **Stripe** driver (Checkout Session + webhook) | [x] | [x] | 12 |
| 7.3 | **Paystack** driver (initialize transaction + webhook) | [x] | [x] | 12 |
| 7.4 | **PayPal** driver (Orders v2 + webhook) | [x] | [x] | 12 |
| 7.5 | **Admin payment settings** — enable/disable providers, keys, per-currency routing, test mode | [x] | [x] | 12 |
| 7.6 | Webhook endpoints with **signature verification + idempotency + raw-body handling** (§87) | — | [x] | 13 |
| 7.7 | Payment records, state machine, reconciliation against provider | — | [x] | 13 |
| 7.8 | **Fulfilment on verified payment only** — never trust the browser redirect (§13) | — | [x] | 13 |
| 7.9 | Manual/offline payment recording (bank transfer) for staff | [~] | [x] | 13 |

> **6.4** — one page rather than a wizard, and a signed-out visitor is redirected to
> `/login?next=/checkout`. Guests creating an account *inline* is a real §13 requirement and is not
> built; flagged rather than half-done.
>
> **6.7** — the confirmation page is complete and distinguishes a confirmed payment from one still
> awaiting the webhook. The **emailed** receipt is ticket 24's.
>
> **7.1–7.5** — no provider is verified against a live account: there are no credentials yet.
> Signature verification is tested with generated HMACs for all three; the drivers' HTTP is stubbed.
> Env placeholders are in `.env.example`.
>
> **7.9** — the action and the fulfilment path are complete and permission-gated
> (`payment.record_manual`); the staff *form* for it hangs off ticket 20's Customer 360.

---

## 8. Entitlements, Licensing & Downloads

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 8.1 | Order → OrderItem → Entitlement chain on payment (§64) | — | [x] | 14 |
| 8.2 | Licence issuance: key generation, type, activation limit, expiry, support expiry (§65) | — | [x] | 14 |
| 8.3 | Entitlement gates: which versions, updates until, support until | — | [x] | 14 |
| 8.4 | Signed, expiring download URLs + download log (§66) — **rate limit is ticket 26** | [x] | [x] | 14 |
| 8.5 | Licence view/verify page for the customer | [x] | [x] | 14 |

---

## 9. Customer Portal

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 9.1 | Dashboard — **action-oriented**: Needs Your Attention first, then counts (§27, §102) | [x] | [x] | 15 |
| 9.2 | **My Software** — owned products, versions, updates, licence, support window (§29) | [x] | [x] | 15 |
| 9.3 | Per-product actions: Download · Licence · Changelog · Demo · Request Customization. **Docs** (no field on `ProductDoc`), **Request Support** (17) and **Request Installation** (needs a standalone cart service line) are not shipped | [x] | [x] | 15 |
| 9.4 | Orders list + order detail | [x] | [x] | 15 |
| 9.5 | Requests list + request detail (AI summary, status, timeline, messages) | [x] | [x] | 19 | ← both pages shipped with ticket 19; this row was never updated. Timeline entries lose their time (smoke ticket 07) and stop at `converted` (smoke ticket 10)
| 9.6 | Quotes list + quote detail with Accept / Reject / Ask Question | [x] | [x] | 22 | ← shipped; **Ask Question** is still unwired, per 14.3
| 9.7 | Invoices list + pay-invoice flow. Gated on the billing org roles at the page **and** the action, not only in the nav | [x] | [x] | 23 |
| 9.8 | Organization settings, members, billing details; account/profile settings — **assigned to tickets 03 and 24 by ticket 15's own scope**; the routes exist as stubs | [ ] | [ ] | 03, 24 |
| 9.9 | Notifications centre + unread badge, customer and staff | [x] | [x] | 24 |

---

## 10. AI — Requirements Assistants

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 10.1 | **OpenRouter** client via the `openai` SDK: streaming, retries, typed errors, usage/cost logging. Anthropic prompt caching does **not** pass through the gateway | — | [x] | 16 |
| 10.2 | `aiConversations` persistence — resumable, org-scoped, full transcript retained (§72) | — | [x] | 16 |
| 10.3 | Chat UI: streaming, one-question-at-a-time, suggested-option chips, free text (§17) | [x] | [x] | 16 |
| 10.4 | **Structured requirement extraction** — `json_schema` or tool-calling per model capability, Zod parse either way (§17) | — | [x] | 16 |
| 10.5 | AI guardrails in prompt **and** code: no pricing (including endorsing the customer's own figure), no dates, org-scoped (§73) | — | [x] | 16 |
| 10.6 | Graceful degradation when the AI provider is down — manual form fallback (§104) | [x] | [x] | 16 |
| 10.7 | **Customization assistant** at `/customize/[slug]` — product-context aware, uses the product's suggested areas (§16, §50) | [x] | [x] | 17 |
| 10.8 | Requirements summary screen — editable, the customer's tick decides `origin` (§18) | [x] | [x] | 17 |
| 10.9 | Submission → request linked to product + version (§19, §20) — **coded and integration-tested; blocked live by the standalone MongoDB** | [x] | [x] | 17 |
| 10.10 | **Custom-build assistant** — business-first discovery, no tech jargon (§22) | [x] | [x] | 18 |
| 10.11 | AI feature suggestions — declined and deferred items recorded as `suggested`, never `confirmed` (§23) | [x] | [x] | 18 |
| 10.12 | **Marketplace recommendation** during custom build, reusing ticket 08's search (§24) | [x] | [x] | 18 |
| 10.13 | Submission → `CustomerRequest` + reference + dashboard access (§25). Carrying requirements *into* the customization flow is **not** done | [x] | [x] | 18 |

---

## 11. Requests, State Machines & Activity

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 11.1 | Unified `CustomerRequest` model with `kind: custom_build \| customization` | — | [x] | 19 |
| 11.2 | **Server-validated state machine** — graph plus a permission/actor layer, kept in agreement by a test (§91) | — | [x] | 19 |
| 11.3 | Domain events — in-process bus, dispatched after commit, each handler isolated (§92) | — | [x] | 19 |
| 11.4 | `activityEvents` → chronological timeline, customer and internal split (§70) | [x] | [x] | 19 |
| 11.5 | Customer-confirmed requirements refused to staff **at the service**, not just absent from the UI (§34) | [x] | [x] | 19 |
| 11.6 | Context preservation — base product, version, AI transcript all on the staff workspace (§101) | [x] | [x] | 19 |

---

## 12. Customer Service / Operations Portal

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 12.1 | Staff dashboard — counters clickable into the queue they count, from one shared definition | [x] | [x] | 20 |
| 12.2 | Seven work queues (§32), oldest-first, index-verified at 10k rows by `npm run db:explain:queues` | [x] | [x] | 20 |
| 12.3 | Request workspace — AI transcript (incl. withheld turns), requirements, internal notes, attachments | [x] | [x] | 20 |
| 12.4 | Assignment + assignment history + bulk assign, partial success reported (§40) | [x] | [x] | 20 |
| 12.5 | **Customer 360** — counters, software, orders, requests, interleaved timeline (§33) | [x] | [x] | 20 |
| 12.6 | Follow-ups — list with four scopes (overdue default), created from the request workspace and Customer 360 (§39) | [x] | [x] | 20 |
| 12.7 | Request-customer-action → `waiting_for_customer` + `CustomerActionRequested`. The **notification** is ticket 24 | [x] | [x] | 20 |

---

## 13. Communication

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 13.1 | Reusable `Conversation` + `Message` model, polymorphic subject (§38). Requests only so far — orders and quotes are refused explicitly, not silently allowed | — | [x] | 21 |
| 13.2 | Visibility: four layers — query filter, separate services, a DTO with no `visibility` field, and a payload-level test (§37) | [x] | [x] | 21 |
| 13.3 | Threaded UI on both sides, sanitised bodies. **Message attachments not built** (request-level ones are, ticket 20) | [x] | [x] | 21 |
| 13.4 | System state-change entries interleaved in the thread — **not built**; activity and messages are two sections | [ ] | [ ] | 21 |
| 13.5 | Email notification on new counterpart message, with reply-in-app link | — | [ ] | 24 |

---

## 14. Quotes & Invoices

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 14.1 | Quote builder — scope, deliverables, exclusions, line items, tax, discount, terms, expiry, with the requirements alongside (§51) | [x] | [x] | 22 |
| 14.2 | Quote states, with revisions superseding rather than editing; `{reference, version}` unique | [x] | [x] | 22 |
| 14.3 | Customer actions: Accept (confirmed, restating the total) · Reject. **Ask Question not wired** — ticket 21's thread isn't on the quote page yet | [x] | [x] | 22 |
| 14.4 | Quote document — a **print stylesheet**, not a generated PDF: the page is the document, so it matches by construction. Email delivery is ticket 24 | [x] | [x] | 22 |
| 14.5 | Acceptance audited with user, timestamp, IP and **version** (§90) | — | [x] | 22 |
| 14.6 | Quote → Invoice conversion, deposit vs full (§52) — the **deposit only**; the balance is raised by staff when the work is done, so it does not sit in the overdue queue for unstarted work | [x] | [x] | 23 |
| 14.7 | Invoice states: Draft → Issued → Partially Paid → Paid → Overdue → Cancelled (§63). `overdue` is **derived from `dueAt` on read**; the stored status is what ticket 25's sweep will act on | [x] | [x] | 23 |
| 14.8 | Pay-invoice through the same provider abstraction as checkout — `initiatePaymentForInvoice` + a `subjectType` branch in `fulfilment.ts`. **Not verified live**: only Paystack is enabled in dev and it does not take GBP | [x] | [x] | 23 |
| 14.9 | On payment: request → `converted`, `WorkReadyToStart` emitted, `ready-to-start` staff queue. The seam is the event; no project entity | — | [x] | 23 |

---

## 15. Notifications

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 15.1 | Notification model + in-app centre + unread count (§69). Bell in both shells, counted server-side per render — no polling, correct across devices because nothing is stored per device | [x] | [x] | 24 |
| 15.2 | Transactional email. **One** template, plain-text-first, through the existing `EmailTransport` port. **No React Email and no Resend** — the dev transport still writes to `.dev-emails/`. Production delivery needs a **driver to be written**, not merely selected: `resolveTransport()` has its production branch commented out and there is no SMTP or Resend implementation in the repo (smoke ticket 04) | — | [~] | 24 |
| 15.3 | Event → notification mapping, as a **data table** in `services/notifications/catalog.ts`. 12 of 14 rows; `OrderCompleted`/`LicenceIssued` need ticket 13 to emit after its transaction | — | [~] | 24 |
| 15.4 | Per-user notification preferences, per category, per channel. Essentials shown, locked and explained rather than hidden; refused server-side too | [x] | [x] | 24 |
| 15.5 | Channel seam — `NotificationChannelDriver` + a registry, with `in_app` and `email` registered and nothing else. A stub that pretends to send is worse than an absent channel | — | [x] | 24 |

---

## 16. Background Jobs

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 16.1 | Job runner + queue with retries, backoff, dead-letter, observability (§86) | — | [x] | 25 |
| 16.2 | Jobs: send email, process webhook follow-up, expire quotes, mark invoices overdue, reminders | — | [x] | 25 |
| 16.3 | Scheduled jobs (cron): quote expiry, invoice overdue + reminders, follow-up reminders | — | [x] | 25 |
| 16.4 | Admin job monitor (queue depth, failures, retry) | [x] | [x] | 25 |

---

## 17. Security, Audit & Compliance

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 17.1 | Authorization enforced in **every** server action and route handler (§88) | — | [x] | 26 |
| 17.2 | Zod validation at every trust boundary (`.strict()` on route bodies; form sweep deferred) | — | [x] | 26 |
| 17.3 | Rate limiting: auth, AI endpoints, downloads, webhooks | — | [x] | 26 |
| 17.4 | Security headers + CSP; secure cookies; CSRF posture documented for server actions | — | [x] | 26 |
| 17.5 | Secrets management; **no server secret ever reaches the client bundle** | — | [x] | 26 |
| 17.6 | Field-level encryption for demo credentials and any stored secret (§89) | — | [x] | 26 |
| 17.7 | `auditLogs` for the §90 action list, append-only | [x] | [x] | 26 |
| 17.8 | Tenant-isolation test suite (cross-org access must fail) | — | [x] | 26 |
| 17.9 | Upload safety: type/size limits, no executable rendering, virus-scan seam | — | [x] | 26 |

---

## 18. SEO, Performance & Observability

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 18.1 | Metadata API per route, canonical URLs, Open Graph, JSON-LD Product schema (§93) | [x] | [x] | 27 |
| 18.2 | `sitemap.ts` + `robots.ts`, published products only | [x] | [x] | 27 |
| 18.3 | Caching strategy — decide on Cache Components (`use cache` + `cacheLife`/`cacheTag`) and apply consistently | [x] | [x] | 27 |
| 18.4 | Image optimization, pagination everywhere, no unbounded queries (§94) | [x] | [x] | 27 |
| 18.5 | Structured logs, `/api/health`, payment + job alerts (§95). Sentry = a documented seam, no DSN yet | — | [x] | 27 |

---

## 19. Testing & CI/CD

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 19.1 | Vitest unit tests — money, references, state machines, entitlement rules | — | [x] | 28 |
| 19.2 | Integration tests against ephemeral Mongo — one shared replica set, `unit`/`integration` projects | — | [x] | 28 |
| 19.3 | ~~Playwright E2E~~ → replaced by the ticket-29 human checklist (all 4 journeys + personas) | [x] | [x] | 29 |
| 19.4 | Payment webhook tests with fixture payloads per provider — **not done**, signatures only | — | [ ] | 28 |
| 19.5 | CI: lint → typecheck → test → build → secret scan → npm audit (§97) | — | [x] | 28 |
| 19.6 | Environments, migration, rollback & seed strategy — `ai-contexts/OPERATIONS.md` (specified, not provisioned) | — | [x] | 28 |

---

## 20. Third-Party Vendors

> **Post-MVP, and outside the spec.** `00-techinical.md` never mentions a second
> seller — §107's vision is "one coherent operating system through which
> **Innovatrix** sells software" — so these rows have no `§` behind them and cite
> the sections they extend instead. Detailed tickets live in `tickets/vendor/`;
> the `Ticket` column below refers to that set, not to `tickets/NN-*.md`.
>
> **Simplified 2026-08-17**, keeping every feature and cutting the structure
> behind it: two vendor roles instead of four, one vendor per user, and the vendor
> workspace nested at `/dashboard/selling` rather than a fourth app shell. The
> full change list is in `tickets/vendor/README.md`.

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 20.1 | Vendor model, authenticated application, state machine, `/dashboard/selling` segment, `requireVendor()` | [x] | [x] | vendor 01 |
| 20.2 | Identity and business verification, document handling, trust badge | [x] | [x] | vendor 02 | ← docs upload + staff-only signed read route; `s3:DeleteObject` still denied, so `purgedAt` records intent
| 20.3 | Two vendor roles (`owner`/`member`), invitations in our own `VendorInvitation` collection | [x] | [x] | vendor 03 | ← the `Verification` "rails" the ticket assumed do not exist — Better Auth owns that collection outright
| 20.4 | Product ownership (`vendorId`), vendor authoring workspace, vendor facet | [x] | [~] | vendor 04 | ← nine of ten wizard steps; **versions deferred to vendor 06**, which owns delivery methods and has to scope ticket 07's file actions anyway
| 20.5 | Submission, staff review, rejection reasons, resubmission | [x] | [x] | vendor 05 | ← `PRODUCT_TRANSITION_RULES` as data, replacing an ad-hoc ternary that existed twice
| 20.6 | Delivery: platform archive **first**, then vendor-hosted mirror and repository-pulled release | [x] | [x] | vendor 06 | ← all three methods; scanning is still the `scanStatus` seam, so "cannot release until it passes a scan" is not claimed
| 20.7 | Configurable commission (platform → vendor), snapshot on the order line | [x] | [x] | vendor 07 | ← `/admin/settings/commission` as its own route: the payments page is gated on `payment_provider.configure`, which the role that sets our cut does not hold
| 20.8 | Append-only earnings ledger, clearance, refund clawback | [x] | [x] | vendor 08 | ← the 14-day refund window existed only as prose; this introduces the constant and asserts clearance exceeds it. Statements deferred to 20.9, which owns them
| 20.9 | Payouts, `PayoutProvider` interface, batches, self-billed statements | [x] | [x] | vendor 09 | ← `manual` is a real driver (unlike inbound, where it throws); a draft claims its entries so a second batch cannot see the same money; the statement is derived, so "immutable once paid" is a property of the data
| 20.10 | Purchase-gated ratings and reviews, moderation, `AggregateRating` | [x] | [x] | vendor 10 | ← the aggregate is a **sum and a count**, never a stored average, recomputed from the reviews in the same transaction; hiding a review drops it from the rating immediately
| 20.11 | Public vendor storefront, attribution, dynamic JSON-LD `seller` | [x] | [x] | vendor 11 | ← the grid goes through `searchMarketplace`, because a card's price is computed by that pipeline and not stored; the card became an overlay-link `<article>` so a second link inside it is valid HTML
| 20.12 | Vendor analytics; suspension, offboarding, emergency delisting | [x] | [~] | vendor 12 | ← **traffic figures are absent by design** (nothing counts a page view; the screen says so rather than showing a placeholder). Unlisting via `listingSuppressed` keeps URLs, publish dates and reviews, so reinstating is one action
| 20.13 | Vendor support threads, either-party disputes, SLA, refund requests, takedown | [x] | [x] | vendor 13 | ← `internal` now means **staff-only**, so a vendor cannot read a staff note about them either; the thread's subject is the entitlement, which makes the scope check the existing one

---

## 21. Smoke-Test Follow-Ups

> Findings from the first human run against ticket 29's checklist. Raw notes are
> `tickets/30-user-testing-results-v1.md`; the triaged tickets live in
> `tickets/user-smoke-tests/` and the `Ticket` column refers to that set.
>
> These are **not** new scope. Every row is either a defect in something already
> ticked above, or content and configuration a shipped feature was waiting on.
> Four of them close a §99 journey that currently cannot be completed.

| SN | Task | FE | BE | Ticket |
|----|------|:--:|:--:|--------|
| 21.1 | Public content: `/services`, `/pricing`, `/terms`, `/privacy`; drop the `/concepts` footer link | [x] | — | smoke 01 |
| 21.2 | Landing hero — a real search input and real counts; ~100-item suggestion pool sampled 4 at a time | [x] | [x] | smoke 02 |
| 21.3 | **Signed-out visitors cannot use the assistant** — owner-less conversations are persisted and then refused | [x] | [x] | smoke 03 |
| 21.4 | Google sign-in UI; **an SMTP driver** — neither is a config-only change | [x] | [x] | smoke 04 |
| 21.5 | **Per-account currency support**; stop leaking provider error text; validate routing writes | — | [x] | smoke 05 |
| 21.6 | **`/dashboard/orders/[reference]` — never built**; post-checkout destinations for pending orders | [x] | [x] | smoke 06 |
| 21.7 | `src/lib/dates.ts` — timestamps keep their time; adopt the orphaned `Timeline` | [x] | [x] | smoke 07 |
| 21.8 | Staff ↔ admin sidebar links; a real messages inbox; hide `/dashboard/organization` | [x] | [x] | smoke 08 |
| 21.9 | Headline figures on `/staff` and `/admin`; make the `/…/dashboard` URLs resolve | [x] | [x] | smoke 09 |
| 21.10 | **Delivery progress tracking** — states past `converted`, staff progress updates on the customer timeline | [x] | [x] | smoke 10 |
| 21.11 | **Card payment initiation fails** — no driver wraps `fetch`, so a transport failure escapes as an unmodelled exception | — | [x] | smoke 11 |
| 21.12 | **Expired session loops** `/dashboard` ⇄ `/login` — the proxy guards on cookie presence, the DAL on validity, and nothing cleared a stale cookie | — | [x] | smoke 12 |

> **All twelve are done (2026-08-17).** `npm test` passes at 862 tests across 54 files.
> 21.12 was reported after the batch and is a pre-existing bug, not a regression from it.
> Two of the tickets' own diagnoses were wrong and are corrected in place — see
> `tickets/user-smoke-tests/README.md` for what the tester could not see, and what the
> fixing turned up that no ticket predicted.
>
> **21.11** was the one blocking money: with a real Paystack test key configured, card
> payment fails with the generic message. `ProviderUnavailableError` exists in the error
> taxonomy and has **zero usages** — no driver wraps its `fetch`, so a network failure
> arrives as a bare `TypeError` and bypasses every specific branch of `withAction`. Rows
> 7.1–7.5 have flagged since ticket 12 that no provider was ever verified against a live
> account; this is the first time one was tried.
>
> **21.10** is the substantive one. `converted` is terminal and only a state change can
> write to a customer-visible timeline, so a customer who has paid a deposit hears nothing
> further — permanently. Scoped to extend the existing state machine and activity feed;
> §53–54 projects stay deferred and `WorkReadyToStart` remains the seam.

---

## Suggested implementation order

Ordered so that each block is independently demoable and nothing is blocked waiting on a later block.

### Phase A — Skeleton you can log into (tickets 00–04)
1. **00 Foundation** — structure, config, money, references, error handling.
2. **01 MongoDB** — connection, conventions, transactions.
3. **02 Domain model** — all MVP collections + indexes + seed. *Do this before any feature; retrofitting a 28-collection model is the most expensive mistake available here.*
4. **03 Auth + orgs + permissions** — everything downstream gates on the DAL.
5. **04 Shells + design system** — four layouts, shared primitives.

### Phase B — Something to sell (tickets 05–09)
6. **05 Object storage** → **06 Admin product management** → **07 Versions, files, demos**.
7. **08 Marketplace browse/search** → **09 Product detail**.
   *Milestone: an admin can publish a real product and the public can find and evaluate it.*

### Phase C — Money in (tickets 10–15)
8. **10 Cart** → **11 Checkout & orders**.
9. **12 Payment providers** → **13 Webhooks & fulfilment** → **14 Entitlements, licences, downloads**.
10. **15 Customer dashboard + My Software**.
    *Milestone: the §99 "Marketplace — As-Is" journey works end to end with real money.*

### Phase D — The differentiator (tickets 16–19)
11. **16 AI foundation** → **17 Customization assistant** → **18 Custom-build assistant**.
12. **19 Requests, state machines, activity**.
    *Milestone: both AI doors produce structured, tracked requests.*

### Phase E — Servicing it (tickets 20–23)
13. **20 Staff portal, queues, customer 360** → **21 Conversations & messaging**.
14. **22 Quotes** → **23 Invoices & payment collection**.
    *Milestone: a customization request can be reviewed, quoted, accepted, invoiced and paid — the revenue loop closes.*

### Phase F — Production-ready (tickets 24–28)
15. **24 Notifications** and **25 Background jobs** (start earlier if email is blocking a demo).
16. **26 Security hardening & audit** — schedule a dedicated pass, don't leave it as cleanup.
17. **27 SEO, performance, observability**.
18. **28 Testing & CI/CD** — write tests alongside each phase; this ticket is the harness and the gate.
    (Altitude and scope per change: `## Testing` in `AGENTS.md`.)

---

## Cross-cutting enablers (unblock multiple sections — track explicitly)

| SN | Enabler | Ticket | Blocks |
|----|---------|--------|--------|
| X.1 | Money type + per-currency pricing | 00 | §6, §7, §14 |
| X.2 | Business reference generator | 00 | §6, §10, §14 |
| X.3 | Mongo transactions (replica set required) | 01 | §6.5, §7.8, §8.1 |
| X.4 | Signed object storage URLs | 05 | §4.8, §8.4, §13.3 |
| X.5 | DAL + permission checks | 03 | Everything |
| X.6 | Domain event bus | 19 | §11.3, §15.3, §17.7 |
| X.7 | Background jobs | 25 | §14.4, §15.2, §16 |
| X.8 | Anthropic client wrapper | 16 | §10 |
| X.9 | PDF generation | 22 | §14.4, §14.6 |
| X.10 | Payment provider abstraction | 12 | §7, §14.8 |

---

## Architectural rules that apply to every ticket

Violating these is a bug even when the feature works:

1. **Business logic lives in services, not in components, route handlers, or server actions** (§82). Actions validate input, call a service, and shape the response.
2. **Every server action re-checks authentication and authorization.** Server actions are reachable by direct POST — the UI hiding a button is not a permission check.
3. **The database is the source of truth** — not the payment provider, not the AI, not the client (§103).
4. **State transitions are validated server-side** against an explicit allowed-transition map (§91).
5. **Money is integer minor units + a currency code.** Never a float, never a bare number.
6. **Historical prices are frozen on the order.** Never recompute an old total from current prices (§61).
7. **AI output is a suggestion until a human confirms it** (§104). Confirmed requirements and AI assumptions are distinct fields.
8. **Never expose an unsigned, permanent URL to a paid artefact** (§66).
9. **Progressive complexity** — a non-technical customer should never see framework, database, or infrastructure vocabulary unless it's relevant to them (§100).
10. **Context flows with the request** — staff must always see the base product, version, and AI transcript that produced a request (§101).
