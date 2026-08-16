# S02 — Landing hero & suggestion pool

**Source:** ticket 30, lines 8 and 16 · **Severity:** minor
**Depends on:** — · **Blocks:** — · **Size:** S
**Spec:** §74 (search & discovery), §17 (AI assistant principles), §100 (progressive complexity)

## Why

Two separate reports, one shared cause: the two most prominent entry points on the public
site are **decorative mock-ups of themselves**. The hero looks like a search box and is
not one. The custom-build assistant offers four suggestions that are the same four for
every visitor forever.

Both are the first thing a customer touches. §99 has every journey beginning here.

## Part A — the hero "search" is not an input

`src/app/(public)/page.tsx`, `Hero()` from line 109. The whole page is a Server Component
with no `"use client"` and no form anywhere.

The search field (`:152-178`) is a styled `<div>` whose text is a **`<span>`**:

```tsx
<span className="text-subtle truncate text-[15px]">
  Search 148 products, or describe what you need
</span>
```

No `<input>`, no `<form>`, no `action`, no router push. The only working element in the
block is the "Start" `<Link href="/custom-software">` at `:171-176`.

The five chips underneath (`CRM`, `Booking`, `Property`, `Rota & timesheets`,
`Custom build`, `:179-190`) are `<button>` elements with **no `onClick` and no `type`** —
they cannot have handlers, being in a Server Component. They are inert, and lacking
`type="button"` they would submit if ever placed inside a form.

### Scope

- **Reuse `src/features/marketplace/components/search-box.tsx`.** It already exists and
  already does this properly: a client island that debounces 350ms, `router.replace`s
  `?q=`, and degrades to a real `<form action>` without JavaScript. Do not write a second
  one. The hero's version submits to `/marketplace?q=…` rather than filtering in place.
- **Honour the second half of the promise.** The copy says "or describe what you need" —
  a long, sentence-shaped query is a custom-build intent, not a keyword search. Either
  route it to `/custom-software` seeded with the text, or drop the phrase. Do not offer
  the choice and then ignore it.
- **Make the chips work** as pre-filled queries, or remove them. A chip that looks
  clickable and is not is worse than no chip.

### The number 148

Hardcoded in four places in this one file — `:169`, `:212` ("148 products across 31
industries · median quote in 4.2 days"), `:243` ("148 results"), `:446` ("Browse all 148
→") — and it has never been near the database. It came from the `/concepts` gallery, which
labels its own figures illustrative (smoke ticket 01).

Replace with the real count. The marketplace pipeline already computes it:
`src/services/marketplace/pipeline.ts:106` returns a facet `total`, surfaced through
`src/services/marketplace/index.ts:57,144`. Published products only, and cached — this is a
public page and ticket 27 settled the caching approach.

"31 industries" and "median quote in 4.2 days" are the same problem. Derive them or delete
them; a median quote time is not derivable today, so delete it.

## Part B — four suggestions, forever

`src/app/(public)/custom-software/page.tsx:106-115`:

```tsx
suggestions={
  conversation.messages.length === 0
    ? ["I need to manage staff and shifts", "I need to take bookings",
       "I need to keep track of clients", "Something else"]
    : undefined
}
```

An inline array, no module, no data file. Passed as `Assistant`'s `suggestions?: string[]`
prop (`src/features/requirements/components/assistant.tsx:31`, forwarded `:67`) and
rendered as chips in `Conversation` (`src/features/requirements/components/conversation.tsx:154-172`),
only while the conversation is empty.

### Scope

- Build a pool of ~100 openers in its own module — this is content, and it does not belong
  inline in a page component. Cover the §7 industries (healthcare, education, logistics,
  hospitality, property, finance, e-commerce, HR, CRM, booking, inventory, professional
  services, nonprofit, retail) so a visitor sees something close to their business.
- Write them in the customer's language, not ours (§100): "I run a care agency and rotas
  are a mess", never "I need a scheduling module with role-based access".
- **Sample 4 per render in the Server Component**, in `page.tsx`. The array is created
  server-side and consumed inside the `"use client"` island, so a pick made in `page.tsx`
  is serialised into the RSC payload and is hydration-stable. Sampling inside
  `Conversation` or `Assistant` instead produces a server/client mismatch unless deferred
  to an effect — do not do that.
- **Pin "Something else"** rather than letting it into the pool. It is the escape hatch,
  not a suggestion, and a random draw that omits it strands anyone whose business is not
  represented.

## Acceptance criteria

- [ ] The hero contains a real, focusable, submittable search input that works without
      JavaScript, reusing the existing `search-box.tsx`.
- [ ] Every chip either performs the search it advertises or is gone.
- [ ] No product count, industry count or timing figure on the landing page is hardcoded;
      each is derived or absent.
- [ ] The suggestion pool has ~100 entries in its own module, covering the §7 industries.
- [ ] Four are drawn per page load, they differ between loads, and "Something else" is
      always among them.
- [ ] No hydration warning in the console on `/` or `/custom-software`.

## Root cause

Both are placeholder content that outlived the placeholder stage. The hero was built from
the `/concepts` mock-ups (which is where 148 comes from) and never wired up; the four
openers were enough to exercise the chip UI when ticket 18 was written.

Worth noting the hero is the *only* place on the public site with no search — every other
surface got the real `search-box.tsx`.
