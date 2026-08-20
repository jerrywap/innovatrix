# Innovatrix Smoke-Test Follow-Ups

Findings from the first human smoke-test run against ticket 29's checklist, split into
workable tickets. The raw notes are `../30-user-testing-results-v1.md` and are preserved
unedited — this directory is the triage, not a replacement.

Read `../README.md` for the main ticket set these build on, and `../../00-techinical.md`
for product context.

## Why these are separate tickets

Ticket 30 is twenty-one observations in one flat list. They differ in size, in dependency
and in kind: some are bugs with a precise root cause, some are content that was never
written, some are configuration that turns out to need code, and one is a deferred phase
resurfacing because a customer noticed its absence.

Each ticket below carries a **Root cause** section recording what the code actually does,
with file and line references, so implementation does not have to re-derive it. Several of
those causes were not visible from the outside — see *What the tester could not see*.

## Reading these alongside the main set

Numbering restarts in this directory, so "ticket 05" would be ambiguous. The convention,
following `../vendor/README.md`:

- **"smoke ticket 05"** — a sibling here, `05-payment-currency-routing.md`.
- **"ticket 06"** — the main set, `../06-admin-product-management.md`.

Files are prefixed `S` in their titles for the same reason.

## The set

Severity uses ticket 29's scale: **blocker** (money, data, or a §37 leak) · **major** (a
journey cannot be completed) · **minor** (wording, spacing, polish).

| # | Ticket | Severity | Size |
|---|--------|----------|:----:|
| 01 | [Public content & legal pages](01-public-content-and-legal-pages.md) | ~~minor¹~~ **done** | M |
| 02 | [Landing hero & suggestion pool](02-landing-hero-and-suggestion-pool.md) | ~~minor~~ **done** | S |
| 03 | [Guest AI conversation](03-guest-ai-conversation.md) | ~~**major**~~ **fixed** | S |
| 04 | [Google sign-in & SMTP email](04-google-sign-in-and-smtp-email.md) | ~~minor~~ **done** | M |
| 05 | [Payment currency routing](05-payment-currency-routing.md) | ~~**major**~~ **done** | M |
| 06 | [Order detail & post-checkout](06-order-detail-and-post-checkout.md) | ~~**major**~~ **done** | M |
| 07 | [Timestamps that keep their time](07-timestamps-that-keep-their-time.md) | ~~minor~~ **done** | S |
| 08 | [Navigation & stub screens](08-navigation-and-stub-screens.md) | ~~minor~~ **done** | M |
| 09 | [Portal analytics](09-portal-analytics.md) | ~~minor~~ **done** | M |
| 10 | [Delivery progress tracking](10-delivery-progress-tracking.md) | ~~**major**~~ **done** | L |
| 11 | [Card payment fails with a generic error](11-payment-initiation-failure.md) | ~~**blocker**~~ **fixed** | M |
| 12 | [Expired session redirect loop](12-expired-session-redirect-loop.md) | ~~**blocker**~~ **fixed** | S |

¹ Minor as a defect; `/terms` and `/privacy` are main-set decision #12 and block launch.

**All eleven are done (2026-08-17).** What follows is the order they were tackled in and
why, kept because the reasoning still applies to the next batch.

**Suggested order.** ~~**11 first**~~ — done. Its diagnosis was wrong and the
ticket records why: the cause was a mistyped enum in `seed-bulk.ts` that made 1000 of 1004
products unbuyable, not anything in the payment layer. Worth reading before starting any
other ticket here, because the same lesson applies to all of them — **verify against the
running system before fixing what the code appears to say.** Then the four majors — 06, 03, 05, 10 — because each closes a journey that
cannot currently be completed. 07 next: it is small, it touches ~19 call sites, and doing it
before 06 and 10 means those two write their timestamps correctly the first time. Then 08,
02, 04, and 01 and 09 last.

11 and 05 are adjacent and should be done in that order — 11 makes sure there *is* a modelled
error, 05 fixes what we say when there is one — but they are separable and each ticket says
where its boundary lies.

Otherwise none of these depend on each other, so they can be picked up in any order by
different people. The only sequencing that genuinely pays is 07 before 06 and 10.

## Outcome

All twelve shipped. **12 arrived after the batch** — a super-admin's session expired and
`/dashboard` looped with `ERR_TOO_MANY_REDIRECTS`. Pre-existing since ticket 03, and latent
because it needs a session to genuinely expire: the proxy guards on cookie *presence* and the
DAL on *validity*, and nothing cleared a cookie the server had stopped accepting. `npm test` — **862 tests, 54 files, all passing**; lint clean (the 11
remaining warnings are pre-existing in `scripts/storage-probe.ts`); typecheck clean;
`npm run scan:bundle` clean.

Four things were found *while fixing* that no ticket predicted, each caught by a test the
project already had:

- **`navigation.test.ts`** caught a first attempt at the cross-portal link that made
  `adminNavFor()` non-empty for everybody — which the admin layout reads as "may enter".
- **`loading-boundaries.test.ts`** caught the staff inbox guard sitting inside a
  `<Suspense>`, where `forbidden()` renders under a 200.
- **`dates.enforcement.test.ts`** — written as part of smoke ticket 07 — immediately caught
  a date call site the migration had missed.
- **`states.test.ts`** caught that the new delivery states broke an assumption nobody had
  written down: that a customer may cancel from any state with a `cancelled` edge. They may
  not, once money and work are committed, and the test now says so.
- **`action-guards.test.ts`** caught ticket 12's new route handler, which authenticates
  nothing — necessarily, since it serves the caller whose session is already rejected.

Ticket 12 also produced the batch's clearest lesson about *incomplete* fixes: repairing the
DAL did not fix the loop, because `dashboard/layout.tsx` had its own copy of the redirect.
`login-redirect.test.ts` is now the rule that catches the copy rather than the original.

The lesson from ticket 11 held throughout: the tickets' reasoning was sound and several of
their conclusions were not. `/dashboard/orders/[reference]` genuinely did not exist; the
`as Route` casts blamed for hiding it turned out to be unavoidable for dynamic routes and
could not have caught it either way.

## What the tester could not see

Recorded here because it changes what several tickets say, and because two of these mean
the feedback is describing something other than what it appears to.

1. **`/staff/dashboard` and `/admin/dashboard` do not exist.** The portal landing pages are
   `/staff` and `/admin`. Both reported URLs 404, so the pages being judged were never
   reached. (Smoke ticket 09.)
2. **`/dashboard/orders/[reference]/` is an empty directory** — no `page.tsx`, never
   committed. The 404 is a missing route, not a failed lookup, and it is the only empty
   route directory in the app tree. Both links to it use an `as Route` cast, which is why
   `typedRoutes` did not catch it at compile time. (Smoke ticket 06.)
3. **The guest-AI 404 is a cookie that is never minted.** `src/proxy.ts:131-138` mints the
   anonymous key only behind a `sec-fetch-dest: document` guard, so arriving via any in-app
   `<Link>` mints nothing, `startOrResume` then persists a conversation with no owner at
   all, and `assertCanRead` refuses it — to its own creator. A hard reload works, which is
   why it survived development. Guests are explicitly *allowed* here; this is a bug, not a
   policy. (Smoke ticket 03.)
4. **"Currency not supported by merchant" is Paystack's own sentence**, passed to the
   customer verbatim by `src/lib/action-result.ts:50-54` — against our own documented rule
   at `src/services/payments/provider.ts:89-95`. Underneath it, routing asks the driver what
   *Paystack* supports worldwide rather than what *this account* is provisioned for; the
   per-account field exists in the schema, is written once, and is never read.
   (Smoke ticket 05.)
5. **A `Timeline` component that renders hour and minute already exists**
   (`src/components/timeline.tsx:93-102`) and is imported by **zero** files. Meanwhile a
   copy-pasted `isoDay()` truncates every timestamp to a day across ~19 call sites. That is
   the entire "only date, no time" finding. (Smoke ticket 07.)
6. **`/concepts` is an internal design gallery**, already `noindex`, whose own footnotes say
   its numbers are illustrative — and it is linked from the public footer on every page.
   The hardcoded "148 products" in the hero came from that same set. (Smoke tickets 01, 02.)
7. **The workflow really does dead-end.** `converted` is terminal, only a state change can
   write to a customer's timeline, and there are no state changes left — so a customer who
   has paid a deposit hears nothing further, permanently. The `ready-to-start` queue filters
   on `converted` and therefore never empties. (Smoke ticket 10.)
8. **Main-set todo rows 9.5 and 9.6 are stale.** Customer request detail *and* quote
   list/detail are built and working. Corrected in `../../01-mvp-todo.md`.
9. **The wording of an error is evidence.** "Something went wrong on our side" is the only
   message an *unmodelled* exception can produce — every domain error carries its own text.
   So that message proves the failure is one the payment layer does not model, which is what
   narrowed smoke ticket 11 to an unwrapped `fetch` before any code was changed. Worth
   quoting error text verbatim in future reports for exactly this reason. (Smoke ticket 11.)

## Coverage

Tickets 01–10 come from ticket 30; every line of it maps to exactly one of them. Ticket 11
came in separately, after the set was written — a card payment failing with a generic error
once a real Paystack test key was configured. Nothing was dropped, and no two tickets claim
the same scope.

| Feedback (ticket 30) | Ticket |
|---|---|
| `/services`, `/pricing`, `/terms`, `/privacy`, `/concepts` need updating | 01 |
| Hero search is a stub · `custom-software` has only 4 messages | 02 |
| Signed-out user cannot chat on `/custom-software` | 03 |
| Login page should enable Google · configure SMTP email credentials | 04 |
| "Currency not supported by merchant" · payments currency-routing section | 05 |
| Bank checkout lands on empty My Software · `ORD-2026-0007` 404s | 06 |
| Dashboard shows date without time | 07 |
| `/staff` ↔ `/admin` sidebar link · `/dashboard/messages` · `/dashboard/organization` | 08 |
| `/admin/dashboard` and `/staff/dashboard` expected to be analytics | 09 |
| Staff request workflow unclear · no progress tracking after payment | 10 |
| *(reported separately)* Card payment fails: "Something went wrong on our side" | 11 |

## Themes worth noticing

Three patterns run through more than one ticket, and are cheaper to fix as patterns.

**A convention that is only written down does not hold.** AGENTS.md requires absolute
timestamps; the rule was honoured in the component nobody imported and broken in the helper
everybody copied. `typedRoutes` was meant to make a link to a missing route a compile error;
two `as Route` casts turned it off exactly where it would have helped. The project already
knows the answer — `theme-tokens.test.ts` and `loading-boundaries.test.ts` exist for this
reason. Smoke ticket 07 left `dates.enforcement.test.ts` behind it and ticket 12 left
`login-redirect.test.ts`, which discharges this theme. The enforcement set is now **closed**
at fourteen — see `## Testing` in `AGENTS.md`. Read the paragraph above as a finding from
this run, not as a standing instruction to the next one.

**Scaffolding that was never filled in still looks finished.** Four legal and marketing
stubs, two empty dashboard screens and a decorative search box all render cleanly, carry
correct metadata and appear in navigation. Nothing distinguishes "not built yet" from "built
and empty" to anyone outside the codebase — which is precisely what a first smoke test finds.

**Seams left open on purpose need to be listed where somebody will look.** Google sign-in,
SMTP delivery and the post-payment handover were each deliberate deferrals, documented in
their own tickets. A tester met all three as dead ends on the same afternoon. The MVP todo's
per-row notes are honest, but they are not where anyone looks when a screen does nothing.

## Not from this run

Two things worth a second pass that this feedback did not cover, noted so they are not lost:

- **The environment blockers from ticket 05** — the S3 bucket serves objects publicly
  (fails §66), `s3:DeleteObject` is denied, and CORS is unset so a browser PUT fails
  preflight. These are bucket and IAM changes, not code, and they still block rows 4.4 and
  4.8 of the MVP todo.
- **Ticket 29's own Findings table** was left empty; the notes went into ticket 30 instead.
  It now points here.
