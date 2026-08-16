# Security posture

Ticket 26's audit, written down. Read alongside `AGENTS.md`, which carries the
rules a feature screen must follow; this is the platform-level picture and the
things that are *not* covered by code.

Last reviewed **2026-08-16**.

---

## Where each control lives

| Control | Where | Enforced by |
|---|---|---|
| Authorization | `src/lib/auth/dal.ts` | `action-guards.test.ts` — every action reaches a guard, with a reasoned allowlist |
| Tenant isolation | scope from `requireOrg()`, never from input | `tenant-isolation.integration.test.ts`; `orgFilter()` refuses a blank scope |
| Rate limiting | `src/lib/rate-limit.ts`, plus Better Auth's own | the `LIMITS` table |
| Security headers & CSP | `src/config/security-headers.ts` → `next.config.ts` | applied to `/:path*`, API routes included |
| Secrets | `src/config/env.ts` (`server-only`), 40 marked modules | `scripts/bundle-secret-scan.ts` over the built output |
| Encryption at rest | `src/lib/crypto.ts` — AES-256-GCM, key versioning, AAD | `crypto.test.ts` |
| Upload safety | `services/storage/policy.ts` + `verifyUpload()` | magic-byte sniff on a 4KB range read |
| Audit trail | `src/services/audit/`, append-only at the **model** | `audit.integration.test.ts` |
| Webhook verification | `services/payments/signatures.ts` | `signatures.test.ts` |

## Rate limits

`src/lib/rate-limit.ts` → `LIMITS`. Mongo-backed fixed window, **fails open** if
the database is unreachable — a Mongo blip must not lock everyone out of signing
in, and every limited endpoint has a real authorisation check behind it.

| Surface | Budget |
|---|---|
| Sign in | 10 / 5 min (Better Auth) |
| Register, password reset, resend verification | 5 / hour (Better Auth) |
| Licence activation | 20 / hour per IP |
| AI turns | 60 / hour per user (or IP) |
| Downloads | 100 / day per organisation |
| Demo credential reveal | 20 / hour |
| Webhooks | 600 / min |
| Search | 300 / min |

## CSRF posture

**Server actions**: Next.js compares `Origin` against `Host` on every action
POST and rejects a mismatch. That is the protection, and it is why no action
carries a token.

**Route handlers** are not covered by that and each states its own credential:

| Route | Credential |
|---|---|
| `api/auth/[...all]` | Better Auth's own handling |
| `api/webhooks/[provider]` | the provider's signature over the raw bytes (§87) |
| `api/cron/*` | `CRON_SECRET`, constant-time, **503 when unset** |
| `api/licences/activate` | the licence key (§65), rate limited by IP |
| `api/downloads`, `api/payment-evidence`, `api/request-files`, `api/ai` | session + permission |

`action-guards.test.ts` fails if a new route appears without one of these.

## Key rotation

| Key | How to rotate |
|---|---|
| `ENCRYPTION_KEY` | Generate a new one, move the old into `ENCRYPTION_KEYS_PREVIOUS` as `<version>:<hex>`, bump `ENCRYPTION_KEY_VERSION`. Existing ciphertext keeps opening; new writes use the new key. **Never rotate without keeping the old one** — sealed demo credentials become unreadable and there is no recovery. |
| `AUTH_SECRET` | Rotating signs every session out. Do it deliberately, off-peak. |
| `CRON_SECRET` | Change the variable and the scheduler together. The routes 503 rather than run open in the gap. |
| Payment provider keys | Rotate in the provider's dashboard, then the environment. `STRIPE_SECRET_KEY` requires `STRIPE_WEBHOOK_SECRET` — the env schema enforces the pair. |
| `OPENROUTER_API_KEY` | No state depends on it; rotate freely. |
| `STORAGE_*` | Existing presigned URLs signed with the old key stay valid until they expire (five minutes). |

## Data retention and deletion

A GDPR erasure request is **not** "delete the user row".

| Data | On erasure |
|---|---|
| `users` | Anonymised — name and email replaced, `deletedAt` set. The row stays because orders, audit entries and licences reference it. |
| `sessions` | Deleted. |
| `aiConversations` | Deleted. A transcript is the customer's own words and nothing downstream needs it once the request is closed. |
| `orders`, `invoices`, `payments` | **Retained.** A financial record is a statutory obligation (six years in the UK) and is not the customer's to delete. |
| `auditLogs` | **Retained**, and append-only — deleting one is not possible through any application path. |
| `downloads` | Retained, IP dropped after 90 days. |
| `notifications`, `messages` | Deleted with the account. |
| Uploaded objects | `s3:DeleteObject` is currently denied for the app's credential, so this is a manual step. **Known gap.** |

Not implemented as code. There is no erasure endpoint and no scheduled
retention sweep — this table is the specification for one, and it belongs to
whoever schedules the work.

## Known and accepted

Each of these is a decision rather than an oversight.

**`script-src 'unsafe-inline'`.** The strict answer is a per-request nonce, and
Next's own guide says nonce-based CSP is incompatible with Partial
Prerendering, which `cacheComponents: true` turns on everywhere. A nonce would
make every page dynamic — no static shell, no CDN caching — on the two pages
whose latency is a revenue number. `experimental.sri` is the way out and is
experimental in this version. Full reasoning in `security-headers.ts`.

**The dev/staging bucket is public-read for a known key.** Reported, not
fixable from application code. It is why payment evidence is served only
through a permission-checked route that 307s to a short-lived presigned GET and
never through `publicObjectUrl()`. The bucket is also shared with unrelated live
applications, so nothing is ever written outside `innovatrix/{env}/` —
`assertKeyInPrefix()` enforces it.

**`.strict()` is on route-handler bodies, not on form-backed action schemas.**
Zod's default *strips* unknown keys, so the mass-assignment risk is already
closed; `.strict()` adds loudness rather than safety. Turning it on across all
80 action schemas is a change whose failure mode is a form that stops
submitting, and it cannot be verified without exercising every form in a
browser — so it is on the ticket-29 human checklist rather than done blind.

**No external security review.** A structured self-review against OWASP Top 10
is below.

## OWASP Top 10 (2021) self-review

| # | Risk | Position |
|---|---|---|
| A01 Broken access control | Every action and route reaches the DAL, enforced by a test. Tenant isolation has its own suite. Scope never comes from the request. |
| A02 Cryptographic failures | AES-256-GCM with key versioning and AAD binding for stored credentials. Passwords are scrypt via Better Auth. Cookies `httpOnly` + `sameSite` + `secure` when served over https. |
| A03 Injection | Mongo with a typed ODM and no string-built queries. The one regex over user input (`audit-view`) is escaped and anchored. React escapes output; the one hand-built HTML string (the notification email) has its own `escape()`. |
| A04 Insecure design | Money is integer minor units. State transitions go through explicit maps. Fulfilment is idempotent and re-verifies with the provider. Refusals are uniform where they would otherwise be an oracle. |
| A05 Security misconfiguration | Env validated at boot and named on failure. Headers applied to every path. `NODE_ENV`-aware HSTS and `unsafe-eval`. |
| A06 Vulnerable components | `npm run audit:deps` gates at **high**. Currently zero findings at any level. No Dependabot yet — a gap. |
| A07 Auth failures | Better Auth, verified email gates checkout, rate limits on every credential-guessing surface, sessions 30 days with daily refresh. |
| A08 Integrity failures | Uploads verified by magic bytes. Webhooks verified by signature over raw bytes. Audit log append-only. No SRI on scripts yet — see the CSP note. |
| A09 Logging failures | Audit log covers the §90 list. Structured application logging is ticket 27. Alerting on payment and job failure is ticket 27. |
| A10 SSRF | The only server-side fetches are to configured provider hosts and the object store. `next/image` has an explicit remote allowlist in production — the development wildcard is deliberately excluded from production for exactly this reason. |
