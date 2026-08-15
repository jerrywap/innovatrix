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
