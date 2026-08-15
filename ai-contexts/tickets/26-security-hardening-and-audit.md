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
- [ ] The automated check finds zero server actions without a DAL guard.
- [ ] The tenant-isolation suite passes and runs in CI on every PR.
- [ ] Client bundle grep for secret prefixes returns nothing.
- [ ] Demo credentials are ciphertext at rest; the decryption path is exercised by a test.
- [ ] Rate limits trigger correctly and return 429 with a `Retry-After`, without leaking internals.
- [ ] CSP is enforced (not report-only) and the app functions with no console violations.
- [ ] A `.exe` renamed `.pdf` is rejected on magic-byte verification.
- [ ] Audit entries cannot be updated or deleted through any code path.
- [ ] `npm audit` shows no unmitigated high/critical findings.
- [ ] An external review (or a structured self-review against OWASP Top 10) is recorded with findings closed.
