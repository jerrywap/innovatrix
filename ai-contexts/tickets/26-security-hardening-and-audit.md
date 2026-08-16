# 26 — Security Hardening & Audit Trail

**Bucket:** §17 · **Depends on:** all feature tickets · **Blocks:** launch · **Size:** L
**Spec:** §88 (security), §89 (credentials), §90 (audit trail), §66 (downloads), §87 (webhooks), §103

## Why
This is a **scheduled pass, not cleanup**. The platform holds payment data, licence keys, demo credentials and
multi-tenant business records. Run this ticket as a deliberate audit against a checklist, with findings recorded
and fixed.

## Scope

### 1. Authorization audit (§88)
- Enumerate **every** server action and route handler. Each must start with a ticket-03 DAL call.
  Write a lint rule or a test that walks the AST and fails on any exported action whose first statement isn't a
  DAL guard — a manual grep will drift.
- Confirm no `organizationId` is ever accepted from client input for scoping.
- Verify permission checks match the ticket-03 matrix, not ad-hoc role string comparisons.

### 2. Tenant isolation test suite
For every org-scoped resource (orders, requests, quotes, invoices, entitlements, conversations, downloads,
AI conversations): a test that Org B, authenticated, is refused when calling the action with Org A's id.
This suite is a permanent CI gate, not a one-off.

### 3. Input validation
Zod at every boundary: server actions, route handlers, webhooks, AI structured output. Reject unknown keys
(`.strict()`) on anything that writes. Validate ids as ObjectId-shaped before querying.

### 4. Rate limiting
Per-user and per-IP, backed by Mongo or Redis:
| Surface | Limit |
|---|---|
| Login / register / reset | strict, plus lockout with backoff |
| AI conversation turns | per-user per-hour cap (cost protection) |
| Downloads | per-entitlement per-day |
| Demo credential reveal | tight |
| Webhooks | generous but bounded |
| Search | moderate |

### 5. Headers & transport
CSP (no `unsafe-inline` for scripts; nonce the ones Next needs), `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`.
Cookies `httpOnly` + `secure` + `sameSite`. HTTPS only.
**CSRF**: document the posture explicitly — Next.js server actions carry built-in origin checks, but any
custom `POST` route handler needs its own protection or must be signature-authenticated.

### 6. Secrets (§88)
- No secret in `NEXT_PUBLIC_*`. Grep the built client bundle for known key prefixes (`sk_`, `whsec_`, `sk-ant-`)
  as a CI step.
- `import 'server-only'` on every module touching secrets, the database, or the AI client.
- Document key rotation for: payment providers, Anthropic, storage, the demo-credential encryption key,
  session secret.

### 7. Encryption at rest (§89)
Demo credentials (ticket 07) and any future stored customer credential use AES-256-GCM with a key from the
environment. Store `{ciphertext, iv, tag, keyVersion}` so rotation is possible.
**Reaffirm §89**: credentials must never be pasted into tickets, project notes, AI conversations or ordinary
message fields. Add a detector that warns when a message or AI turn looks like it contains a credential.

### 8. File security
Content-type allowlist + magic-byte verification (not just the declared type), size caps, no execution,
`Content-Disposition: attachment` on all downloads, no user content served from the app origin.

### 9. Audit trail (§90)
Append-only `auditLogs` covering at minimum: quote issued/accepted · payment received/refunded ·
product published/unpublished · product downloaded · licence generated/revoked · customer requirement changed ·
staff assignment changed · user permission changed · payment provider configuration changed · manual payment
recorded · demo credentials viewed.
Each entry: actor (user or `system`/`webhook`), action, subject, before/after where meaningful, IP, timestamp.
No update or delete path — enforce in the repository. Staff-visible viewer with filters.

### 10. Dependency & data hygiene
`npm audit` in CI with a documented severity gate; Dependabot/Renovate. Document data retention and a
GDPR-shaped deletion path (what is deleted vs anonymised — invoices and audit logs are retained by law).

## Acceptance criteria
- [x] The automated check finds zero server actions without a DAL guard.
- [x] The tenant-isolation suite passes and runs in CI on every PR.
- [x] Client bundle grep for secret prefixes returns nothing.
- [x] Demo credentials are ciphertext at rest; the decryption path is exercised by a test.
- [x] Rate limits trigger correctly and return 429 with a `Retry-After`, without leaking internals.
- [x] CSP is enforced (not report-only) — with `script-src 'unsafe-inline'`, for the reason below.
- [x] A `.exe` renamed `.pdf` is rejected on magic-byte verification.
- [x] Audit entries cannot be updated or deleted through any code path.
- [x] `npm audit` shows no unmitigated high/critical findings.
- [x] A structured self-review against OWASP Top 10 is recorded — `ai-contexts/SECURITY.md`.

---

## What shipped, and what did not

The written-up posture lives in **`ai-contexts/SECURITY.md`** — controls, rate
limits, CSRF, key rotation, retention, accepted risks and the OWASP review. This
section is what changed and what was found.

### Four real defects, all found by writing the check rather than reading

1. **An empty-string organisation scope silently became god mode.** Three
   loaders used `...(scope.organizationId ? { organizationId } : {})`. Correct
   for a customer, correct for staff — and for `organizationId: value ?? ""` it
   **dropped the filter entirely** and returned another organisation's invoice.
   Found by writing the tenant-isolation case for it and noticing the only
   assertion that passed was "returns the record". Fixed with `orgFilter()`,
   which throws on a blank scope: staff scope is `undefined` and nothing else is.

2. **`.env.example` shipped a line that crashed the app at boot.**
   `CRON_SECRET: z.string().min(16).optional()` — an empty string is *present*,
   so `.optional()` never applies and `.min(16)` rejects it. Following the
   README's quick start produced a process that would not start. Fixed with
   `optionalShaped()`; the codebase already had `optionalBool` for exactly this.
   Found while trying to verify the 503-when-unset posture.

3. **The audit log's append-only guarantee had a hole the size of the model.**
   `AuditLogRepository` overrides `updateById`/`deleteById` to throw — and
   `AuditLog.updateOne(...)` never touches the repository. Several services
   import models directly, for good reasons. Closed with Mongoose `pre` hooks on
   all eight query mutations plus a non-new `save`; `audit.integration.test.ts`
   asserts every path. The remaining way through is the native driver, which is
   deliberate — a test teardown needs it and a service does not reach for it.

4. **Six of eleven staff roles had no seeded login**, including `devops`, which
   is the only role besides `super_admin` holding `audit.view` and
   `system.manage_jobs`. Those two screens could therefore only be reached as
   `super_admin` — the one role that proves nothing about whether a permission
   check works. Found by curling `/admin/audit` as each account. The seed now
   creates all eleven staff roles and all five organisation roles.

### Also fixed

- **`verifyUpload` had one caller.** Product files were sniffed; payment
  evidence and request attachments were not — so the one upload path a
  *customer* can reach was the unchecked one. Both now verify.
- **The resend-verification button's UI copy claimed a server-side rate limit
  that did not exist.** Better Auth's limiter was not configured at all, which
  meant `/sign-in/email` was unthrottled in development. Now enabled
  unconditionally with per-path budgets.
- **`next.config.ts`'s `authInterrupts` comment** still described the pre-fix
  `loading.tsx` behaviour. Corrected.

### Built

`src/lib/rate-limit.ts` (Mongo fixed-window, fails open, hashed identities) ·
`src/lib/auth/scope.ts` · `src/config/security-headers.ts` ·
`scripts/bundle-secret-scan.ts` · `/admin/audit` behind `audit.view` ·
`action-guards.test.ts` · `tenant-isolation.integration.test.ts` ·
`audit.integration.test.ts` · `ai-contexts/SECURITY.md`.

New audit actions: `session.created`, `product.demo_credentials_viewed`,
`job.retried`, `job.cancelled`.

### The CSP compromise, stated plainly

`script-src` carries `'unsafe-inline'`. The strict answer is a per-request
nonce, and Next's own guide is unambiguous:

> **Partial Prerendering (PPR) is incompatible** with nonce-based CSP since
> static shell scripts won't have access to the nonce.

`cacheComponents: true` means PPR everywhere. A nonce would make every page
dynamic — no static shell, no CDN caching, a full render per request on `/` and
`/marketplace`. `experimental.sri` hashes scripts at build time and keeps static
generation, which is the combination we want, and it is experimental in this
version. Revisit at the next major: it is deleting one token and adding four
lines. Everything else in the policy is strict — `frame-ancestors 'none'`,
`object-src 'none'`, `form-action 'self'`, `base-uri 'self'`.

### Not done, and why

- **`.strict()` on the 80 form-backed action schemas.** Zod's default *strips*
  unknown keys, so the mass-assignment risk is already closed and `.strict()`
  adds loudness rather than safety. Its failure mode is a form that stops
  submitting, which cannot be verified without exercising every form in a
  browser. Applied to the two route-handler JSON bodies, where an unexpected key
  really is a signal; the sweep is on the ticket-29 checklist.
- **CSP console violations** need a browser. On the ticket-29 checklist.
- **An erasure endpoint and a retention sweep.** `SECURITY.md` specifies what is
  deleted versus anonymised; nothing implements it.
- **Dependabot/Renovate.** `npm run audit:deps` gates at high (currently zero
  findings at any level); nothing yet raises the PR.
- **External security review.** Self-review recorded instead.

## Live verification (2026-08-16)

Rate limiting, against the running app — 22 posts to `/api/licences/activate`:

```
attempt 1–20   200
attempt 21     429
attempt 22     429

HTTP/1.1 429 Too Many Requests
retry-after: 3311
{"error":"Too many requests."}      ← no counts, no window, no rule name
```

Security headers, on a page **and** on an API route:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' …
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=() …
```

HSTS correctly absent in development — pinning `localhost` to https for two
years would break every other project on the machine, and it is not undone by
removing the header.

`/admin/audit`, one login per seeded role:

```
super_admin      200
devops           200      ← the role that actually holds audit.view
finance          403
marketplace_mgr  403
content_manager  403
support_agent    307 → /staff?denied=admin
```

The `support_agent` redirect rather than 403 is correct and worth noting: that
role has no admin-area permission at all, so the **layout** turns them away
before any page refuses. Layout → redirect, page → 403, exactly as the DAL's
table documents.

The guard test was checked by removing a real guard
(`requirePermission("invoice.issue")`) and confirming it failed naming
`invoices/actions.ts:raiseBalanceInvoiceAction`, rather than assuming a passing
test was a working one.

Bundle scan over 2,011 built files, 10 patterns and 8 live environment values:
nothing found.
