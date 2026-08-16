<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Innovatrix conventions

Established in ticket 04. These are the rules a feature screen is expected to
follow; deviating is fine when you can say why, in a comment, at the deviation.

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
