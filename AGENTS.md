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
- `loading.tsx` per protected segment. Those routes read `headers()` via the
  DAL, so they are dynamic and there is a real gap before first paint.
- Suspense around anything doing uncached I/O, so the static shell still renders.

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
