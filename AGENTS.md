<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Innovatrix conventions

Established in ticket 04. These are the rules a feature screen is expected to
follow; deviating is fine when you can say why, in a comment, at the deviation.
`## Testing` at the end is the exception — it is not about a screen, it is about
how much of the suite a change owes, and the answer is usually less than it looks.

## Authorization

**Every page and every server action calls the DAL (`src/lib/auth/dal.ts`)
first.** A server action is a public POST endpoint — a hidden button, a filtered
nav item and a client-side redirect are all cosmetic. Navigation filtering
decides what is *drawn*; the DAL decides what is *allowed*, and the second
without the first is merely untidy while the first without the second is a
vulnerability.

Pick the guard by where you are — the flavours differ in what failure looks
like, not in what they check:

| Caller | Function | On failure |
|---|---|---|
| layout | `requireStaffOrRedirect`, `requireAnyPermissionOrRedirect` | redirect — a wrong turn |
| page | `requirePermissionOrForbid`, `requireAnyPermissionOrForbid` | 403 page, server-rendered |
| server action | `requirePermission`, `requireAnyPermission` | throws `ForbiddenError` |

Scope comes from the session, **never** from the request. `requireOrg()` returns
the organization to filter by; a client-supplied `organizationId` is an untrusted
claim, and `assertOrgAccess()` exists to check one rather than to supply scope.

## Rendering

- Server Components by default (§81). A `"use client"` boundary needs a reason
  you could name — usually `usePathname`, form state, or a Radix primitive.
- **Never pass a component function across the RSC boundary.** React refuses it
  and the whole shell 500s. Pass a name and resolve it on the client — see
  `components/shell/nav-icons.ts`.
- Suspense around anything doing uncached I/O, so the static shell still renders.
- **Guard first, stream second.** `await` the DAL at the top of the page
  component, before returning any JSX, and put the slow query inside a
  `<Suspense>`. You get both: the refusal is decided before the first flush, so
  the status is right, and the shell still streams.

### `loading.tsx` and the status code

Once bytes are on the wire the status line is committed. `loading.tsx` puts a
Suspense boundary around its whole segment, which lets Next flush the shell
*before* the page resolves — so `forbidden()` and `notFound()` render the right
body under **`200 OK`**. A guard inside a `<Suspense>`d child does the same
thing one layer down, and looks tidier while doing it.

That is not cosmetic. `forbidden()` exists precisely because a thrown error
renders client-side under a 200; recovering the status and then losing it on the
shell is the same bug again. Crawlers, monitors, CDNs and `curl` in a runbook
are all told the request succeeded.

So: **a `loading.tsx` may only sit over a segment where no page, at it or below
it, can refuse** — and the guard belongs in the page component's own body, never
inside a boundary. `loading-boundaries.test.ts` enforces both and names the
offending pair.

Where the 404 depends on the main query — a detail page that loads a record and
calls `notFound()` — there is nothing to stream ahead of it, and blocking is
correct rather than a regression. Drop the `<Suspense>` instead of pretending.

## URL state

Search, filter, sort and pagination live in the URL, not in React state — parse
with `parseListParams()` (`src/lib/list-params.ts`). That makes a filtered view
linkable, makes Back work, and lets the server render the right rows on the
first pass. **Everything from a query string is untrusted**: `parseListParams`
clamps `limit` (§94, no unbounded reads) and drops sort columns and filter keys
the screen didn't declare.

## Forms

Server actions + `useActionState` + `useFormStatus`, validated with a shared Zod
schema so the client and the server agree. Actions return `ActionResult<T>` —
they never throw across the RSC boundary, because a thrown error reaches the
client as a redacted digest with no field information.

**A form containing a Radix control must not use `<form action={fn}>`.** React
runs a function action through `startHostTransition`, which requests a real DOM
`form.reset()` *before* the action — and Radix's Checkbox, Select and Switch each
answer a `reset` by restoring a ref captured on first render. Native inputs are
unaffected, because React writes their fresh `defaultValue` in the same commit, so
the failure looks like "only the dropdowns misbehave" rather than like the form
shell. It fires on failed submits too. Making the control *controlled* does not
help: Radix calls the controlled `onChange` with the stale value instead.

Dispatch by hand — `useManualSubmit`
(`features/products/components/section-form.tsx`) is the shared version:
`preventDefault()` puts React on the `action === null` path, which requests no
reset. Two things then follow that are easy to miss. `useFormStatus` reports
nothing for a manual dispatch, so `pending` has to travel as a prop; and
`new FormData(form)` omits the submitter, so use
`new FormData(form, event.submitter)` or the field distinguishing your submit
buttons silently disappears.

**"Optional" means the empty string, not `undefined`.** An empty text input
submits `""`, so `z.url().optional()` and `objectIdSchema.optional()` both reject
a field the person deliberately left blank. Use `optionalText`, `optionalUrl`,
`optionalId` and `countFromForm` from `validators/common.ts` — the last because
`z.coerce.number()` on `""` is `0`, which turns a blank field into a silent zero
or a spurious "too small".

## Money, status and dates

- Money renders through `<MoneyDisplay>` → `lib/money.ts`. **Never `toFixed`**:
  it breaks for zero-exponent currencies (JPY) and it is a float.
- Status renders through `<StatusBadge>`, whose tones are keyed to the ticket-02
  enums. A new state without a tone fails the test suite.
- Absolute dates, not "3 days ago" — relative time differs between server and
  client and flickers at hydration.

## Design tokens

`globals.css` has two vocabularies and they are not peers: **Meridian**
(`--background`, `--signal`, …) holds the literals; **shadcn** (`--primary`,
`--card`, …) are *aliases* pointing at them. Never give a shadcn token a literal
colour — `shadcn init` merges in place and will overwrite a literal, and the
alias layer is what makes that survivable. `theme-tokens.test.ts` enforces it.

Re-running `shadcn init` also resets `--radius` and re-adds a Geist font import;
check both afterwards.

## Object storage

**Bytes never pass through the Next.js server.** Both directions are presigned
and go browser↔S3 directly:

- **Download** — the route authorises, writes the log, then `307`s to a
  short-lived presigned GET. Never `GetObject` into a `Response`.
- **Upload** — a server action returns a presigned `PUT` and the browser sends
  the file itself. Never accept a file in a Server Action or route body.

This is an architectural constraint, not a preference. Proxying puts a 2GB
release artefact through the app server's memory and its request timeout, and
Server Actions have a body limit that a phone photo clears without trying. The
only bytes the server may read are the **4KB range read** in `verifyUpload()`,
which sniffs magic numbers and never reaches a client.

Two rules that follow from the bucket being shared with unrelated live
applications:

- **The key is built server-side**, from ids the server already trusts. A
  client-supplied key is a claim about where bytes may land.
- When a key *does* come from the client — the second half of a two-step upload
  — `assertKeyBelongsTo` must run, not just `assertKeyInPrefix`. In-prefix only
  proves it is one of ours, not that it is *this caller's*.

Uploading over an existing key overwrites in place, which is how media
replacement avoids orphaning; add a `?v=` stamp to the stored URL or caches keep
serving the old bytes. `s3:DeleteObject` is currently denied, so nothing else
cleans up — check with `npm run storage:media-probe` rather than assuming either
way.

## Accessibility

Keyboard-navigable, labelled controls, one visible focus ring per control, AA
contrast in **both** themes. `--subtle` carries 9.5px labels, so it is small
text and needs 4.5:1 — check any new colour against the muted surface, which is
the hardest background. An `aria-label` on a control with visible text must
*contain* that text (WCAG 2.5.3), so extend the name with an `sr-only` span
rather than replacing it.

## Navigation

`typedRoutes` is on: a link to a route that doesn't exist is a compile error.
That is deliberate — it is what keeps post-MVP modules out of the navigation.
Don't add a route just to satisfy a link.

## Testing

The two halves of the suite are not the same price. `npm run test:unit` is **773
tests across 49 files in 5–12s** — the spread is module-graph caching, and it is
seconds either way. `npm run test:integration` is **566 tests across 26 files in
414s** locally — nearly seven minutes, at 35% CPU, because every file queues
behind one shared mongod. CI runs those same files in **48s** on parallel workers.
So the slow half is slow *for you specifically*.

That asymmetry is the rule: **the default altitude is the unit project**, and an
integration test is earned by something a unit test cannot reach — not by
preference, and not by thoroughness.

| Reach for | When what you are checking is |
|---|---|
| unit | a pure function, a Zod schema, a view model's shape, a transition edge, a permission decision, an error mapping, a registry agreeing with itself |
| integration | a **transaction** — an abort must actually roll back; a **real index** — uniqueness, a text search, an explain; a **cross-collection invariant**; or **tenancy scoping** — that the filter is on the query and not merely in the caller |
| neither | the list below |

If you cannot name which of those four an integration test is for, it is a unit
test wearing 129 lines of preamble. Each of the 26 integration files carries its
own copy of that preamble — `resetModules`, nine `stubEnv` calls, a unique
database name, dynamic `import()`, `connectToDatabase()`, `syncIndexes()`, and a
hand-written `afterEach` deleting its collections one by one — 3,363 lines in
total, a fifth of the suite, running before the first assertion in it. Writing
the 27th copy is the expensive decision; the test inside it is nearly free by
comparison. A shared harness and `src/test/factories/` are the structural fix and
are still absent — ticket 28 names both.

### What needs no new test

Generously meant, and not a shortcut — many of the last thirty commits shipped a
fix with zero test lines, and the ones that did add tests ran 0.2–0.47 lines of
test per line of source, not the other way round.

- **Copy, wording and content** — including error text, empty states, metadata.
- **A page that only composes existing view models.** The view models are already
  covered; asserting that the page called them is mocking our own code.
- **Plumbing a field through** repository → view model → component, when that
  field's own rules are asserted somewhere already.
- **Tailwind, spacing, layout, a token swap.** No assertion would have caught it
  and none will hold it — that is what `theme-tokens.test.ts` is for.
- **A fix an existing test already covers.** Run it red, fix, run it green, and
  say which test. That is a test, and it is one you did not have to write.
- **A rename, a move, an extraction** where `npm run typecheck` carries the
  correctness.

Where the honest answer is "no test would have caught this", write that sentence
instead of writing the test.

### The enforcement set is closed

Fourteen tests here do not check behaviour, they hold a convention that has a
copy-paste failure mode. They are the ones to **satisfy**, and they keep earning
it — `dates.enforcement.test.ts` caught a call site its own migration had missed;
`login-redirect.test.ts` exists because a redirect loop was fixed in the DAL and
survived, since `app/dashboard/layout.tsx` had its own `redirect("/login")`;
`action-guards.test.ts` caught `/api/auth/stale-session` the moment it appeared
and made its anonymity a written reason rather than an omission.

| What it holds | Tests |
|---|---|
| guards and routing | `src/lib/auth/action-guards.test.ts`, `src/lib/auth/login-redirect.test.ts`, `src/app/loading-boundaries.test.ts`, `src/lib/navigation.test.ts`, `src/app/sitemap.test.ts` |
| registries in agreement | `src/lib/db/states.test.ts`, `src/lib/events/events.test.ts`, `src/components/components.test.ts`, `src/lib/db/schema-paths.test.ts` |
| a convention with a copy-paste failure mode | `src/app/theme-tokens.test.ts`, `src/lib/dates.enforcement.test.ts`, `src/app/internal-shorthand.test.ts` |
| a screen's contract | `src/features/product/product-page.test.ts`, `src/features/requirements/openers.test.ts` |

The set is **closed at fourteen**. A change satisfies the ones that exist and does
not leave a fifteenth behind.

That is a cost decision, not a claim that prose would have done instead — the
`dates.enforcement.test.ts` docstring is the standing evidence that it would not,
since the rule it enforces was already written in this file and the codebase
disagreed with it in nineteen places. But each of these walks the filesystem on
every unit run, and each is a second copy of a convention that then has to be
kept in agreement with the first. Fourteen is worth it; a fifteenth added
unprompted, on the way past, is how a small change becomes a large one. If a
change genuinely wants one, say so and let it be decided — don't build it as a
side effect.

### The registry fan-out — one pass, not nine red tests

A new state, or a state change that emits, touches **nine** places. Discovering
them one failure at a time costs five runs, and two of the nine fail *silently* —
so a green suite is not evidence you found them all. Do them together:

| # | File | Edit | If you miss it |
|---|---|---|---|
| 1 | `src/lib/db/enums.ts` | the state, in its `*_STATUSES` array | compiler |
| 2 | `src/lib/db/states.ts` | the edges, in the `*_TRANSITIONS` map | `states.test.ts` |
| 3 | `src/lib/db/states.ts` | for product and request only: the parallel `*_TRANSITION_RULES` map — permission and actor per edge | `states.test.ts` checks the two cover each other |
| 4 | `src/components/status-badge.tsx` | a `STATUS_TONES` entry | `assertEveryStatusHasATone()` |
| 5 | `src/components/status-badge.tsx` | **the new tuple added to `ALL_STATUS_ENUMS`** | **nothing.** That list is hand-maintained ("Extend when a machine is added"), and it is what `assertEveryStatusHasATone()` iterates — so a tuple that is not in it makes the guard pass **vacuously** and every new state renders neutral grey |
| 6 | `src/lib/db/enums.ts` | `DOMAIN_EVENTS`, if the change emits | `events.test.ts` |
| 7 | `src/lib/events/index.ts` | the `DomainEventMap` entry **and** `EVENT_NAME_SET` | `events.test.ts` both directions; `EVENT_NAME_SET` is a `Record<DomainEventName, true>`, so the compiler catches that half |
| 8 | `src/services/notifications/catalog.ts` | a `CATALOG` row, if anyone should be told. Optional by design — plenty of events notify nobody | — |
| 9 | `src/services/notifications/handlers.ts` | **the event added to `GENERIC`, or given its own `on()`** | **nothing.** A `CATALOG` row on its own notifies **nobody**: `registerNotificationHandlers` only subscribes what is in `GENERIC` or explicitly registered. An event needing more than the organisation audience — a vendor, say — needs the explicit `on()` that maps its payload |

Then `npm run db:docs`, which regenerates `STATES.md` from the maps.

Rows 5 and 9 are the ones to check by eye, because no test will tell you. Both
are hand-maintained lists that a reasonable reader assumes are derived.

Nine transition maps and two parallel rules maps in 677 lines is a cost worth
collapsing one day. Until then this table is cheaper than rediscovering it.

### Done, for anything smaller than a ticket

| Run | When |
|---|---|
| `npx vitest run <path>` | the test files covering what you changed — always |
| `npm run typecheck` | always. `typedRoutes` and the `as const` enums catch most of what a test would |
| `npm run test:unit` | if you touched `lib/`, `services/` or a registry. 5.3s, so there is no excuse not to |

That is the inner loop. **`npm test` and `npm run verify` are CI's job, not
yours** — CI does lint, types, both projects and a production build in **3m11s**
wall clock and already gates the branch. Seven minutes spent locally buys a
number CI is about to produce anyway.

**No `## Live verification` block, and no test counts, for a fix.** That block is
a ticket artefact, and specifically a *probe against the running system* —
evidence a suite cannot produce, which is why `jobs:probe` and `notify-probe`
exist. Pasting `N files · M tests · Xs` into a fix's summary reads as rigour, is
stale by the next commit, and teaches the next change to produce one too.
