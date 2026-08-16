# S04 — Google sign-in & SMTP email

**Source:** ticket 30, lines 10–11 · **Severity:** minor
**Depends on:** — · **Blocks:** ticket 29 §G · **Size:** M
**Spec:** §75 (authentication), §69 (notifications)

## Why

Two requests that read like configuration and are not. Both features are wired
server-side, both stop one step short of working, and in each case the missing step is
code rather than a value in `.env`.

Worth saying plainly, because "configure email credentials in `.env` using SMTP
credentials" cannot be done: **there is no SMTP driver in this repo, and no SMTP variables
to fill in.**

## Part A — Google sign-in

### Current state

The server half is complete:

- `src/config/env.ts:66-68` — `AUTH_GOOGLE_ENABLED` (bool, default `false`),
  `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`.
- `src/config/env.ts:209-215` — cross-field validation throws at boot if enabled without
  both credentials. Good: a half-configured provider fails loudly rather than at the
  moment a customer clicks the button.
- `src/lib/auth/auth.ts:160-167` — `socialProviders` populated when enabled, `{}` otherwise.
- `src/lib/auth/auth.ts:151-155` — `trustedProviders: ["google"]` for account linking, so a
  customer who registered with a password and later uses Google lands on one account.
- `src/lib/auth/client.ts:28` exports `signIn`, so `signIn.social({ provider: "google" })`
  is available.
- `.env.example:30-32` carries all three keys.

**No Google button exists anywhere.** `src/features/auth/components/login-form.tsx` (55
lines) is email, password, remember-me, submit. `register-form.tsx` likewise. Nothing in
`src/features/auth/` or `src/app/(auth)/` mentions Google or social login.

So `AUTH_GOOGLE_ENABLED=true` today changes nothing a customer can see.

### Scope

- A Google button on **both** `/login` and `/register`, plus the divider treatment, shown
  only when the flag is on.
- **The flag has to reach the client.** `src/config/env.ts` has no client schema and no
  `NEXT_PUBLIC_` values at all — deliberately, per ticket 00's server-only leak guard. Do
  not add one for this. Read the flag in the page (a Server Component) and pass it as a
  prop; that is the pattern the rest of the app uses and it keeps the config module
  server-only.
- Keep the email/password form primary. Google is an alternative, not a replacement — §75
  lists OAuth as optional.
- Accessibility (AGENTS.md): a real `<button>`, a visible focus ring, and a name that
  reads as an action.
- Carry `?next=` through the OAuth round trip. `/login?next=/checkout` is a real path
  (smoke ticket 06 touches the same redirect), and losing it dumps the customer on the
  dashboard mid-purchase.
- Nothing to build for account linking — Better Auth's `trustedProviders` covers it.

## Part B — SMTP email

### Current state

`src/services/email/index.ts` — the port is `EmailTransport` (`:37-40`), and the **only**
driver is the development one, `consoleAndFileTransport` (`:53-89`), which prints a banner
and writes a `.txt` into `.dev-emails/`.

`resolveTransport()` (`:96-99`) is the whole story:

```ts
function resolveTransport(): EmailTransport {
  // if (serverEnv().RESEND_API_KEY) return resendTransport();   ← ticket 24
  return consoleAndFileTransport;
}
```

The production branch is commented out and `resendTransport()` was never written. A
repo-wide search for `SMTP`, `smtp` or `nodemailer` returns **zero hits** in `src/`,
`.env.example` and `package.json`.

The only email variables are Resend-shaped: `RESEND_API_KEY` and `EMAIL_FROM`
(`src/config/env.ts:159-161`, `.env.example:90-91`). And `EMAIL_FROM` is **never read** —
the dev transport has no concept of a sender.

Ticket 24 shipped the catalog, the channel registry and the preferences honestly and left
delivery as a seam. This is that seam being closed, with SMTP rather than Resend because
that is what the credentials in hand are.

### Scope

- Add `smtpTransport()` implementing `EmailTransport`, and add `nodemailer` (the transport
  is a port precisely so this is a contained change).
- **The variable names are already chosen.** `.env.example` now carries them:

  ```
  SMTP_HOST=          SMTP_PORT=465
  SMTP_USERNAME=      SMTP_PASSWORD=
  ```

  Use these exact names in `src/config/env.ts` — `SMTP_USERNAME`, not `SMTP_USER`. Port 465
  is implicit TLS, so derive `secure` from the port (`465 → true`, `587 → STARTTLS`) rather
  than adding a separate flag nobody will keep consistent with it.
- Validate as a group the way the Google block does at `:209-215` — a host with no
  credentials should fail at boot, not at send.
- `.env.example` is a committed template: keep the values there illustrative. A real
  hostname and mailbox in the example file will be copied into somebody's `.env` unchanged
  and then wondered about.
- **Actually use `EMAIL_FROM`.** It has been defined and ignored since ticket 24.
- Branch in `resolveTransport()`: SMTP when configured, dev transport otherwise. Leave the
  Resend line deleted rather than commented — the port is the extension point, and a
  commented-out driver is not a plan.
- Keep the dev transport the default. `.dev-emails/` is how ticket 29 §G is read, and
  nobody should send real mail from a laptop by forgetting a variable.
- Retries and failure belong to the existing job runner (ticket 25) — `sendEmail` is
  already a job. Do not add a second retry loop inside the driver.
- `sendAuthEmail()` (`:113-121`) swallows failures outside development. Revisit: a
  verification email silently failing in production is a customer who cannot sign in and a
  log that says nothing.

### Not in scope

HTML templates. Ticket 24 chose plain-text-first deliberately and that holds; the three
templates (`:132`, `:148`, `:164`) stay as they are. Getting mail *delivered* is this
ticket. Making it pretty is not.

## Acceptance criteria

- [ ] With `AUTH_GOOGLE_ENABLED=false`, no Google button on either page and no client
      bundle reference to it.
- [ ] With it on and credentials set, sign-in and sign-up both work, and an existing
      password account links rather than duplicating.
- [ ] `?next=` survives the OAuth round trip.
- [ ] No new `NEXT_PUBLIC_` variable was introduced; `npm run scan:bundle` still passes.
- [ ] With SMTP configured, verification, quote-issued and invoice-issued emails arrive at
      a real inbox, `From` matching `EMAIL_FROM`.
- [ ] Without it, mail still lands in `.dev-emails/` and nothing throws.
- [ ] A partial SMTP configuration fails at boot with a message naming the missing key.
- [ ] A send failure is retried by the job runner and visible in `/admin/jobs`.

## Root cause

Neither is a defect — both are the last mile of a seam left open on purpose. Google was
wired behind a flag in ticket 03 and marked `[~] untested (no credentials)` in the MVP
todo; email delivery was named in ticket 24 as "a `resolveTransport()` change".

That last description is optimistic, and `01-mvp-todo.md:326` should be corrected: there is
no driver to resolve *to*.
