# S03 — A signed-out visitor cannot use the assistant

**Source:** ticket 30, line 9 · **Severity:** **major** — blocks journey A3
**Depends on:** — · **Blocks:** ticket 29 §A3 · **Size:** S
**Spec:** §21–25 (custom build), §104 (AI is a layer, not the platform)
**Status:** **fixed, 2026-08-17.** The diagnosis below was correct.

> ## It was nearly closed as a false alarm
>
> Guest chat *did* work when tested by hand, and this ticket was about to be
> struck out on that basis. Both things are true at once, and the reason is the
> last line of the root cause: **the cookie lasts 30 days, and any document load
> mints it.** Typing the URL, pressing refresh, opening a new tab, or clicking
> "Start over" (`assistant.tsx:85` sets `window.location.href`) fixes a browser
> permanently. Everyone who had ever developed or tested the page had already
> minted one; only a genuinely cold visitor hit the bug.
>
> The database settled it. **9 of 21 conversations were orphaned** — no `userId`,
> no `organizationId`, no `anonymousKey` — and **every one had zero messages**:
> visitors who arrived, had a conversation created for them, and could never send
> anything. All created during the smoke-test session.
>
> Worth remembering as a method: "I can't reproduce it" is a statement about the
> tester's environment. The stored data is a statement about everyone's.

## Why

A logged-out visitor opening `/custom-software` and typing a message gets:

> No such conversation. Fill in a form instead.

Guests are **explicitly allowed** here. `src/features/requirements/actions.ts:56` carries
the comment "Anonymous visitors may start (§17, §18)"; only *submission* requires an
account (`requireOrg()` at `actions.ts:232`). Ticket 29's journey A3 opens with "From
`/custom-software`, **signed out**, start a conversation" and goes on to check the
conversation survives signing up mid-flow.

So this is a bug, not a policy — and it closes one of the two front doors in §107 to
everybody who has not already signed up. Which, on a marketing site, is everybody.

## Root cause

The anonymous key that identifies a guest's conversation is **never minted** on most
routes into the page, and the code then persists a conversation nobody can read — not even
the person who just created it.

**1. The cookie is minted only in the proxy, only on a "real visit".**

`src/proxy.ts:131-138`:

```ts
if (!hasSessionCookie && ASSISTANT_PATH.test(pathname) && isRealVisit(request)
    && !request.cookies.get(CONVERSATION_COOKIE)) {
  return withConversationKey(request, id);
}
```

`isRealVisit` (`src/proxy.ts:180-191`) ends:

```ts
const destination = request.headers.get("sec-fetch-dest");
return destination === null || destination === "document";
```

A client-side navigation sends `sec-fetch-dest: empty` — the proxy's own docblock
(`:160-165`) says so. So arriving at `/custom-software` through **any in-app `<Link>`** —
the header's "Get started" (`public-header.tsx:103-108`), the footer's "Custom build",
`PUBLIC_NAV`, or the hero's "Start" (`page.tsx:171`) — mints nothing. Only a hard page load
works, which is why this survived development: reloading the page fixes it.

**2. An owner-less conversation is then created and stored.**

`src/services/ai/conversation-service.ts:147-151`:

```ts
const owner = input.userId ? { userId: … }
  : input.anonymousKey ? { anonymousKey: … }
  : null;
```

With no cookie, `owner` is `null`, the resume lookup is skipped, and `:166-178` creates a
document with **no `userId`, no `organizationId` and no `anonymousKey`** — every ownership
field spread conditionally, so all three are simply absent.

**3. Nobody but staff can read it.**

`assertCanRead` (`:85-113`) tests organization, then `anonymousKey`, then `userId`, and
falls through all three to `throw new NotFoundError` (`:112`). The page still renders the
chat UI around that conversation id, so the first message POST returns 404 from
`src/app/api/ai/[conversationId]/route.ts:58` — the string the tester saw.

The record is also **unclaimable**: `claimConversationsAction` (`actions.ts:84-92`) claims
by `anonymousKey`, and there isn't one. Signing up does not recover it.

## Scope

### Mint the key where the conversation is created

The proxy is the wrong owner for this. It was chosen because a Server Component may not set
a cookie — true, but a **Server Action and a Route Handler may**, and both already sit on
this path. Mint in `startOrResume`'s caller when no owner is present, and let the proxy's
mint stay as the fast path for a cold document load.

Keep the `isRealVisit` guard where it is. It exists so a crawler and a prefetch do not each
get a conversation, and that is still right.

### Refuse to persist an owner-less conversation

`startOrResume` (`:166-178`) should not be able to create a document that `assertCanRead`
will refuse. Today it does so silently, on every request, and each one is an orphan row.
Guard it: a conversation needs a `userId` or an `anonymousKey`, and its absence is a
programming error, not a customer's problem.

This is the durable half of the fix. Route into it however you like; it cannot go wrong
twice.

### Fix the fallback that the error offers

`conversation.tsx:138-150` appends "Fill in a form instead" to any error, pointing at
`#manual-form`. That element is `review-panel.tsx:126`, inside a panel that only mounts
once there is ≥1 user message (`assistant.tsx:59,70-76`) **and** only after clicking
"Write it out myself" (`review-panel.tsx:110-118`).

On this error path there are no messages, so the anchor points at nothing and clicking it
does nothing. §104 requires a working degradation path, and an anchor to a non-existent
element is not one. Either render the manual form on the error, or stop offering it.

Note that even when reached the form calls `submitRequirementsAction` → `requireOrg()`, so
a guest still has to sign in to submit. That is correct and should stay — but the copy
should say so rather than implying the form is a way around signing in.

### While in here

`secure` disagrees between the two minting paths: `proxy.ts:222` uses
`request.nextUrl.protocol === "https:"`, `conversation-service.ts:59` uses
`usesSecureCookies()`. One cookie, one rule.

## Acceptance criteria

- [ ] Signed out, reaching `/custom-software` **via an in-app link** and sending a message
      gets a reply — no 404.
- [ ] The same via a hard load, a refresh mid-conversation, and a new tab.
- [ ] Journey A3 passes end to end: converse signed out → sign up mid-flow → **the
      conversation is still there** → submit.
- [ ] `startOrResume` cannot create a conversation with no owner; a test asserts it.
- [ ] No conversation exists in the database with all three ownership fields absent.
- [ ] A crawler and a prefetch still do not mint a conversation.
- [ ] The degradation link either reaches a real form or is not shown.
- [ ] Both cookie writes agree on `secure`.

## What shipped

| Fix | Where |
|---|---|
| Mint on any real visit, not only `sec-fetch-dest: document` — a new `isAssistantVisit()` distinct from `isRealVisit()` | `src/proxy.ts` |
| `startOrResume` throws rather than persisting an owner-less conversation | `services/ai/conversation-service.ts` |
| Both assistant pages render a conversation-less variant instead of 500ing when there is no owner | `custom-software/page.tsx`, `customize/[slug]/page.tsx` |
| One `conversationCookie()` shape shared by both writers; proxy honours `x-forwarded-proto` | `services/ai/conversation-cookie.ts`, `proxy.ts` |
| The `#manual-form` anchor becomes a callback that actually opens the form | `conversation.tsx`, `assistant.tsx`, `review-panel.tsx` |
| 9 orphaned rows deleted | data |
| Regression test: an owner-less create is refused, an `anonymousKey`-only create still works | `tenant-isolation.integration.test.ts` |

### Two things the ticket got wrong

**Prefetch cannot be excluded.** The fix originally tested `next-router-prefetch`;
sending that header showed the cookie minted anyway, because Next strips its own
routing headers before the proxy sees them — which `isRealVisit`'s own docblock
says. The check was removed rather than left as a guarantee that does not hold.

It does not matter, and the contrast with recently-viewed is why. A speculative
*entry* in a list is wrong — it claims the visitor read something they hovered. A
speculative *key* claims nothing: `startOrResume` resumes on it, so a prefetch
plus the click after it produce one conversation. Verified — three requests
sharing a key, one row.

**Excluding crawlers broke them.** With the write guard in place, a bot — which
is excluded from minting on purpose, since it discards cookies and would
otherwise leave a row per crawled page forever — hit the guard and got a **500**
on an indexable marketing page. Both assistant pages now branch: no owner, no
conversation, and the copy still renders.

### Verified live

Against the dev server, cold with no cookies:

| Request | Before | After |
|---|---|---|
| client-side nav (`sec-fetch-dest: empty`) | no cookie, orphan created | **cookie minted**, 200 |
| document load | cookie minted | cookie minted, 200 |
| crawler | orphan created | **no cookie, 200** (was 500 mid-fix) |
| `purpose: prefetch` | no cookie | no cookie, 200 |
| `/customize/[slug]` client-side nav | no cookie, orphan | **cookie minted**, 200 |

End to end: arriving exactly as a cold visitor clicking "Get started", then
posting a first message, streams a real reply. That request returned
"No such conversation." before. Orphan count across every test: **0**.

## Notes

Every other caller degrades identically — `summariseConversationAction`
(`actions.ts:136`), `abandonConversationAction` (`:101`) and
`recordRecommendationChoiceAction` (`:355`) all resolve the same viewer and will 404 the
same way. Fixing ownership fixes all four; there is nothing to change at those call sites.

`/customize/[slug]` (ticket 17) shares `ASSISTANT_PATH` and this machinery, so it has the
same defect for a signed-out visitor. Check it in the same pass.
