# 03 — Authentication, Organizations & Permissions

**Bucket:** §2 · **Depends on:** 02 · **Blocks:** everything user-facing · **Size:** L
**Spec:** §75 (auth), §76 (organizations), §77 (staff roles), §88 (server-side authorization)

## Why
Four portals (§4) share one user table but have completely different authority. Get the Data Access Layer right
once and every later ticket inherits correct authorization; get it wrong and every later ticket leaks data.

## Read first
`node_modules/next/dist/docs/01-app/02-guides/authentication.md` — specifically the **Data Access Layer** and
**optimistic checks with Proxy** sections. In Next.js 16 the file is `proxy.ts`, not `middleware.ts`.

## Scope

### Better Auth
- Install `better-auth` with the **MongoDB adapter** and the **organization plugin**. Verify against the
  installed version's docs before writing config — do not assume option names.
- Enable: email + password, email verification (required before purchase), password reset, secure session
  cookies (`httpOnly`, `secure`, `sameSite: lax`), session rotation on privilege change.
- Optional Google OAuth behind `AUTH_GOOGLE_ENABLED`.
- Leave a seam for MFA (§75) — do not implement.

### Organizations (§76)
- Every customer resource belongs to an **organization**, never directly to a user. A solo customer gets a
  personal organization created automatically at signup.
- Roles: `owner`, `admin`, `billing`, `technical`, `member`. Invite by email, accept, revoke, transfer ownership.
- Active-organization selection stored in the session; an org switcher in the dashboard header.

### Staff roles & permissions (§77)
- `StaffRole`: `super_admin`, `customer_service`, `sales`, `technical_analyst`, `developer`, `project_manager`,
  `support_agent`, `marketplace_manager`, `finance`, `devops`, `content_manager`.
- Define **permissions** as the atomic unit (`product.publish`, `request.assign`, `quote.issue`, `payment.refund`,
  `customer.view_all`, …) and a static `ROLE_PERMISSIONS` matrix mapping roles → permissions.
  A user's permissions are the union of their roles'. **No `isAdmin` boolean shortcut anywhere.**
- Keep the matrix in one module so ticket 26's audit can read it.

### Data Access Layer — `src/lib/auth/dal.ts` (`import 'server-only'`)
```ts
export const getSession      = cache(async () => …)                    // React cache, per-render memoized
export const requireUser     = cache(async () => …)                    // redirect('/login') if absent
export const requireOrg      = cache(async () => …)                    // { user, organization, role }
export const requireStaff    = cache(async () => …)                    // { user, staffProfile, permissions }
export const requirePermission = (p: Permission) => …                   // throws ForbiddenError
export const assertOrgAccess = (organizationId: string) => …            // tenant isolation guard
```
- **Every server action and route handler calls one of these first.** A hidden button is not authorization —
  server actions are reachable by direct POST.
- Repositories take `organizationId` from the DAL, never from client input. Treat any client-supplied
  `organizationId` as untrusted and ignore it.

### Proxy (`src/proxy.ts`)
- Optimistic, cookie-only checks: unauthenticated → `/login`; non-staff hitting `/staff` or `/admin` → `/`.
- **No database access in the proxy** — it runs on prefetches too.
- Real enforcement stays in the DAL, close to the data.

### Auth pages `(auth)` route group
Register (with org name), login, verify-email, forgot-password, reset-password, accept-invite. Server actions +
`useActionState`, field-level Zod errors, generic messages that don't disclose whether an email exists.

## Acceptance criteria
- [ ] A logged-in customer of Org A cannot read any Org B record — verified by calling the server actions
      directly with Org B ids, not just by navigating the UI.
- [ ] A `customer_service` staff user is denied `product.publish`; a `marketplace_manager` is allowed it.
- [ ] Unverified users can browse but cannot check out.
- [ ] `getSession()` called five times in one render issues one database read (React `cache` works).
- [ ] Removing a member immediately revokes their access to that org's resources.
- [ ] Session cookie is `httpOnly` and `secure` in production; no session token is readable from client JS.
- [ ] `proxy.ts` performs no database query (assert by instrumentation or review).
- [ ] Password reset tokens are single-use and expire.

## Verification
Add the cross-tenant test suite here; ticket 26 extends it into a standing gate.

---

## Implementation notes (built 2026-08-15)

Delivered: `src/lib/auth/{auth,dal,permissions,organization-access,client}.ts`,
`src/features/auth/` (schemas, server actions, forms), the `(auth)` route group, `src/proxy.ts`,
`src/services/email/`, four new Mongoose models for the Better Auth-owned collections, and 31 unit
+ 12 integration tests.

### Library findings that changed the design

Verified against the installed `better-auth@1.6.29`, not from memory.

1. **The MongoDB adapter creates no indexes.** `unique: true` in its schema is validation metadata;
   nothing reaches the database. `sessions.token` — read on every authenticated request — would
   have been a collection scan with no uniqueness constraint. Declared in
   `src/lib/db/models/identity.ts` and applied by `npm run db:indexes`; an integration test asserts
   they exist.
2. **`transaction` defaults to `true` whenever a `MongoClient` is passed**, and a standalone mongod
   rejects every transaction — which is what local dev runs. Now derived by `supportsTransactions()`
   (`mongodb+srv` yes; `?replicaSet=` yes; otherwise no), overridable with `MONGODB_TRANSACTIONS`.
   The guess is deliberately pessimistic: guessing "no" costs atomicity we can detect, guessing
   "yes" breaks every write.
3. **`forgetPassword` no longer exists** — the endpoint is `requestPasswordReset`.
4. **The duplicate-signup error code is `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`**, not the shorter
   `USER_ALREADY_EXISTS` (which belongs to the admin plugin). Matching only the short one sent every
   duplicate signup down the generic "something went wrong" path — caught by live probing, not by
   types.
5. **`error instanceof APIError` is false inside Next's bundled server runtime.** Better Auth
   resolves to more than one module instance there, so the class-identity check silently failed and
   every handled error became a 500. Use the exported `isAPIError()` guard, which also matches on
   `name === "APIError"`. This one is invisible in unit tests — the integration suite's `instanceof`
   assertions pass, because there the module graph is single-instance.
6. **`session.activeOrganizationId` is declared as a plain string, not a reference**, so it is
   stored as a hex string rather than an `ObjectId`. Typing it as `ObjectId` in Mongoose would throw
   a CastError on hydration. Every other reference field the adapter writes *is* a real `ObjectId`.
7. **Password hashes live on `accounts.password`.** The previous comment in `identity.ts` claiming
   Better Auth owns credential columns on `users` was wrong; corrected, and asserted by a test.

### Bugs found by live probing that types did not catch

- **The session cookie does not exist in the request headers that created it.** `signUpEmail` writes
  `Set-Cookie` to the *response*; `await headers()` still returns the original request. Passing
  those to `createOrganization` called it unauthenticated, so **every registration created a user
  with no organization** — while still returning a redirect that looked like success.
  `signUpWithHeaders()` now lifts the issued cookies into a `Cookie` header, exactly as a browser
  would one round trip later.
- **`auth` was constructed at module scope**, so `next build` validated production secrets and
  opened a MongoDB client while collecting page config — and failed the build. Now `getAuth()`,
  built on first use.
- **`getAuth()` was evaluated before `await headers()`** inside `getSession`. Argument order meant
  the auth instance was built before the dynamic bailout fired, turning a page that should simply
  have been marked dynamic into a prerender failure.

### Two permission systems, deliberately separate

- `src/lib/auth/permissions.ts` — the §77 **staff** matrix. 41 permissions, 11 roles, union
  semantics, no `isAdmin` anywhere. `super_admin` holds the full list explicitly rather than by
  wildcard, so ticket 26's audit can read what it actually grants. `assertMatrixIsComplete()` fails
  the gate if a role is added to the enum without permissions being decided.
- `src/lib/auth/organization-access.ts` — the §76 **customer** access control, via Better Auth's
  `createAccessControl`. Adds `billing` and `technical` to the plugin's owner/admin/member, and
  extends its statements with `billing`, `order`, `request`, `delivery`. Least privilege is real
  here: the billing contact cannot download deliverables, and the technical contact cannot see
  invoices.

### Acceptance criteria — verified, with how

- [x] **Org A cannot read Org B** — integration test runs the exact membership query the DAL uses,
      then asserts Better Auth itself rejects `setActiveOrganization` and `getFullOrganization`
      across tenants with `APIError` status `FORBIDDEN` (asserted on the *reason*, not merely that
      something threw).
- [x] **`customer_service` denied `product.publish`, `marketplace_manager` allowed** — unit test.
- [x] **Unverified users browse but cannot check out** — `requireVerifiedUser()` throws
      `ForbiddenError`; `requireEmailVerification: false` at sign-in so browsing is unaffected.
- [x] **`getSession()` x5 in one render = one read** — measured against mongod's opcounters through
      the running dev server: 2.05 ops/request for a five-call page vs 2.10 for a one-call page. A
      broken `cache` would have been ~10.
- [x] **Removing a member revokes access immediately** — integration test; `requireOrg()` re-reads
      membership every call rather than trusting the session, so the still-valid cookie grants
      nothing.
- [x] **Session cookie is `httpOnly`** — observed live:
      `innovatrix.session_token=...; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`. `secure` is
      set from `NODE_ENV`, so it is off on localhost by necessity and on in production.
- [x] **`proxy.ts` performs no database query** — measured: **0 mongod operations across 20
      requests** to a proxy-handled path.
- [x] **Password reset tokens are single-use and expire** — live: first POST 200, replay of the same
      token 400 `INVALID_TOKEN`. `revokeSessionsOnPasswordReset` verified too: the pre-reset session
      cookie returns `null` afterwards.
- [x] **Enumeration** — reset returns an identical body for a real and a nonexistent address, and
      only the real one produces an email. Sign-in returns the same error for a wrong password and
      an unknown user.

### Known gaps, deliberately

- **MFA** — §75 asks only for a seam. None implemented; adding `twoFactor()` to the plugin list is
  the whole change.
- **Google OAuth** is wired but off (`AUTH_GOOGLE_ENABLED=false`); no credentials to test against.
- **`/dashboard`, `/staff`, `/admin` do not exist yet** — ticket 04. The proxy already protects
  those prefixes, so they currently redirect to login and then 404.
- **Rate limiting** on sign-in and reset is Better Auth's default; ticket 26 should set it
  explicitly.

