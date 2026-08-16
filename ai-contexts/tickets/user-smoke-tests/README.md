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
| 01 | [Public content & legal pages](01-public-content-and-legal-pages.md) | minor¹ | M |
| 02 | [Landing hero & suggestion pool](02-landing-hero-and-suggestion-pool.md) | minor | S |
| 03 | [Guest AI conversation](03-guest-ai-conversation.md) | **major** | S |
| 04 | [Google sign-in & SMTP email](04-google-sign-in-and-smtp-email.md) | minor | M |
| 05 | [Payment currency routing](05-payment-currency-routing.md) | **major** | M |
| 06 | [Order detail & post-checkout](06-order-detail-and-post-checkout.md) | **major** | M |
| 07 | [Timestamps that keep their time](07-timestamps-that-keep-their-time.md) | minor | S |
| 08 | [Navigation & stub screens](08-navigation-and-stub-screens.md) | minor | M |
| 09 | [Portal analytics](09-portal-analytics.md) | minor | M |
| 10 | [Delivery progress tracking](10-delivery-progress-tracking.md) | **major** | L |
| 11 | [Card payment fails with a generic error](11-payment-initiation-failure.md) | ~~**blocker**~~ **fixed** | M |

¹ Minor as a defect; `/terms` and `/privacy` are main-set decision #12 and block launch.

**Suggested order.** ~~**11 first**~~ — **done (2026-08-17)**. Its diagnosis was wrong and the
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
reason. Smoke tickets 06 and 07 should each leave an enforcement behind them.

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
