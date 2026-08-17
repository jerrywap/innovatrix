# S12 — An expired session loops between /dashboard and /login

**Source:** reported 2026-08-17, after the 01–11 batch · **Severity:** **blocker** — the app becomes unreachable
**Depends on:** — · **Blocks:** — · **Size:** S
**Spec:** §75 (authentication), §88 (server-side authorization)
**Status:** **fixed, 2026-08-17.**

## Why

A super-admin left `/dashboard` open until the session expired, then reloaded:

> This page isn't working — localhost redirected you too many times.
> Try deleting your cookies. `ERR_TOO_MANY_REDIRECTS`

The browser's advice is the correct fix, applied by the wrong party. The server knew the
session was dead; it should have deleted the cookie rather than leaving the customer to.

**Pre-existing, not introduced by the 01–11 batch.** `git diff src/proxy.ts` shows the auth
block untouched by that work; the bug has been latent since ticket 03 and needs a session to
actually expire, which no test and no smoke run had waited for.

## Root cause

Two guards that are each correct and disagree in exactly one state.

`proxy.ts` protects `/dashboard`, `/staff` and `/admin` **optimistically** — it checks that a
session cookie is *present* and never touches the database. That is deliberate and measured:
ticket 03 records "0 mongo ops across 20 requests". The DAL checks whether the session is
*valid*.

For a cookie that exists and has expired:

```
GET /dashboard  → proxy sees a cookie, passes it through
                → guard finds no session, redirect("/login")
GET /login      → proxy sees a cookie, redirect("/dashboard")   ← AUTH_PAGES bounce
GET /dashboard  → …
```

Reproduced exactly, with a junk token:

```
/dashboard → 307 location: /login
/login     → 307 location: /dashboard
```

Neither guard is wrong on its own. The missing step is that **nothing ever cleared the stale
cookie**, so the optimistic check kept asserting a session that the authoritative check kept
refusing.

## What shipped

- **`GET /api/auth/stale-session`** — clears the session cookies and redirects to
  `/login?expired=1`. A Route Handler because a layout or page *cannot* delete a cookie;
  Next allows that only in a Server Action or a Route Handler, and the DAL discovers the
  problem in a layout. `api/auth` is outside the proxy's matcher, so the route cannot be
  caught by the loop it breaks.
- **`loginDestination()` in the DAL** — returns the clearing route when a session cookie is
  present, plain `/login` when there is none. It returns a path rather than redirecting so
  the call site keeps `redirect(...)` as its final statement: TypeScript narrows on a direct
  `never` and not through an awaited one, and losing that costs a null check at every caller.
- **`src/lib/auth/session-cookies.ts`** — the cookie names in one place, covering both the
  plain and `__Secure-` spellings, since `useSecureCookies` picks one from `APP_URL` and
  clearing only the expected spelling leaves the loop in place.
- **The password-reset action clears the cookie too.** Same hazard, narrower trigger, and
  changing a password should end the old session anyway.
- **`?expired=1` explains itself** on the login form. Somebody who was working a moment ago
  should not be shown a bare sign-in box and left to conclude something broke.

### The second copy was the real lesson

Fixing the DAL did **not** fix the loop. `app/dashboard/layout.tsx` had its own
`redirect("/login")` — reasonably, since it reads the session for the chrome regardless — and
that one still bounced. `loginDestination()` cannot help a caller that does not call it.

So `login-redirect.test.ts` scans the source and fails on any `redirect("/login…")` outside a
named allowlist. That is the rule that would have caught this, and the same pattern as
`dates.enforcement.test.ts` and `loading-boundaries.test.ts`: a convention only holds when
something fails.

`action-guards.test.ts` also caught the new route immediately — it authenticates nothing, by
necessity, since it exists for the caller whose session is already rejected. Allowlisted with
that reason rather than quietly exempted.

## Verified

| Case | Before | After |
|---|---|---|
| `/dashboard` with a stale cookie | loops until the browser gives up | **2 hops → `/login?expired=1`**, cookie deleted |
| `/staff`, `/admin`, and nested routes | same loop | same 2 hops |
| No cookie at all | 1 hop → `/login?next=/dashboard` | unchanged |
| **Valid session** | works | works — `/staff` and `/admin` serve 200 directly |

`npm test`: 862 tests across 54 files, all passing.

## Notes

The deeper trade-off stands: the proxy stays optimistic, because a database read per request
on every protected route is a real cost and the DAL is the authority anyway. What changed is
that the two now converge — the moment the authoritative check refuses a session, the
evidence the optimistic check relies on is destroyed.

A stricter alternative would be for the proxy to validate the cookie's signature and expiry
without a database read. That is worth considering if this class of bug recurs; it was not
needed here, and it would put cryptographic logic in the proxy runtime for the sake of one
transition.
