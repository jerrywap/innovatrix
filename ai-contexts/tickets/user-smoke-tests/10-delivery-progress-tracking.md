# S10 — Delivery progress tracking

**Source:** ticket 30, lines 23–24 · **Severity:** **major** — the journey dead-ends
**Depends on:** — · **Blocks:** — · **Size:** L
**Spec:** §91 (state machines), §70 (activity timeline), §52 (quote → work conversion), §105 (long-term lifecycle)

## Why

> `/staff/requests/REQ-2026-0002` — I don't understand how this workflow is.
> I expected at a point for the work to start and user should be able to track progress as
> staff people update the timeline.

The expectation is correct and the product does not meet it. Everything up to payment
works — AI conversation, request, triage, quote, acceptance, invoice, payment, all built and
tested. Then it stops dead.

The last thing a customer is ever told is:

> Payment received — we're getting started.

After which nothing can happen. Not "nothing happens by default" — **nothing can be made to
happen**, because there is no state to move to and no way to write a customer-visible line
that is not a state change. The customer has paid a deposit and the product goes quiet
permanently. §105 describes a platform built for the long-term relationship; today the
relationship ends at the moment money arrives.

## Root cause

### `converted` is terminal

`src/lib/db/states.ts:79-90`:

```ts
export const REQUEST_TRANSITIONS: TransitionMap<RequestStatus> = {
  draft: ["submitted", "cancelled"],
  …
  approved: ["converted", "cancelled"],
  converted: [],          // ← nothing follows
  rejected: [],
  cancelled: [],
};
```

`isTerminal():148` agrees, and the parallel `REQUEST_TRANSITION_RULES:189-290` — which
carries the permission/actor layer — has `approved → converted` (`:280-284`) as its last
edge. No `in_progress`, no `delivered`, no `completed`.

Consequence on screen: `permittedTransitions("converted", …)`
(`request-service.ts:96-108`) returns `[]`, and
`src/app/staff/requests/[reference]/page.tsx:203-206` renders *"Nothing to move from here
with your permissions."* It is not a permission problem. There is nowhere to go.

### Only a state change can write to the customer's timeline

The **sole** writer of a `visibility: "customer"` activity row for a request is
`transition()` — `src/services/requests/request-service.ts:163-181`, whose `note` becomes
the message, with the optional internal twin at `:187-203`. The other writers are
`submitFromConversation:394`, `reviseRequirements:520` (both customer-visible) and
`assign:631`, `setInternalInterpretation:562` (both internal).

So **a timeline entry requires a state change**, and there are no state changes left. The
two facts compound: no transitions *and* no way to post an update without one.

There is no free-text update action. `src/features/staff/actions.ts` exposes only
`transitionRequestAction:41`, `assignRequestAction:71`, `saveInterpretationAction:106`,
`createFollowUpAction:149`, `resolveFollowUpAction:199`, `bulkAssignAction:248`,
`assignableStaffAction:300`.

The only remaining channel is the ticket 21 message thread — a chat, not a tracked timeline.
Fine for a question; wrong for "we've finished the tenant portal and started on reporting".

### The handover queue never empties

`WorkReadyToStart` is emitted by `src/services/invoices/handlers.ts:81-87` after
`convertRequest()` transitions to `converted` (`:74-79`). It has exactly one subscriber —
`src/services/notifications/handlers.ts:35` → `catalog.ts:237-244` — which sends staff an
in-app notification.

The `ready-to-start` queue (`src/features/staff/queues.ts:121-133`) filters on
`{ status: "converted" }` and its own comment says "this list *is* the handover". Since
`converted` is terminal, **a request can never leave it**. The queue only grows, and a
count that only grows is not a queue.

## Scope

The decision taken: **extend the existing machinery, add no new entities.**

### 1. States past `converted`

Add to `REQUEST_TRANSITIONS` (`states.ts:79-90`):

```
converted → in_progress → delivered → completed
```

with `cancelled` reachable from `in_progress` and a way back from `delivered` to
`in_progress` when the customer says it is not right. `completed` is the terminal state
`converted` currently pretends to be.

Add the matching rows to `REQUEST_TRANSITION_RULES:189-290` — who may make each move.
Roughly: `project_manager` and `developer` start and deliver; `customer_service` and above
complete. **A test already enforces that the graph and the permission layer agree**
(`01-mvp-todo.md` row 11.2, "kept in agreement by a test"), so a half-done edit fails rather
than shipping.

Extend `customerNarrative()` and the `STATUS_COPY` table
(`src/features/requests/request-view.ts:87-126`) with plain-language `what`/`next` for each
new state — §100, and the existing entries are the model ("We've got it.", "Someone is going
through it.").

Add `<StatusBadge>` tones for the new states; a state without a tone fails the suite
(AGENTS.md).

### 2. A staff "post an update" action

The heart of the ticket. Staff must be able to write a customer-visible timeline entry
**without** a state change — most progress is not a state change.

- New action in `src/features/staff/actions.ts`, permission-gated, writing an
  `ActivityEvent` with `subjectType: "request"` and `visibility: "customer"`, actor
  recorded.
- Reuse `transition()`'s existing activity-writing shape (`request-service.ts:163-181`) —
  same collection, same fields, same actor handling. Business logic in the service, not the
  action (§82).
- Offer the internal twin in the same form, exactly as `input.internalNote` does at `:187-203`.
  **Two rows, never one field with an audience flag** — the comment there says it: "one
  field controlling two audiences is how deliberation leaks."
- Sanitise the body as ticket 21 does for messages.
- This is the §37 boundary again, on a new writer. Ticket 29's A4 is the most important row
  in that document; extend it to cover progress updates, and extend ticket 21's
  payload-level test to the new event type.

### 3. Fix the queue

`ready-to-start` should filter on `converted` **only** — which becomes true once
`in_progress` exists, since starting work moves the request out. Add an `in-progress` queue
beside it so work under way is visible. Update the comment at `queues.ts:122-127`, which
describes the old arrangement.

### 4. The customer's view

`src/app/dashboard/requests/[reference]/page.tsx` already renders status,
`statusExplanation` and the "What's happened" timeline — it needs no structural change,
only the new states and the new events flowing into it. Combined with smoke ticket 07 the
entries finally carry a time, which matters once several land on one day.

Remove the stale line at `:162` ("Viewing quotes here is coming shortly") — quotes shipped.

### 5. Notifications

Add rows to `src/services/notifications/catalog.ts` for work started, work delivered and
work completed — the catalog is a data table, so this is data. Delivery is the one that
needs the customer's attention; ticket 24's preference categories apply.

## Explicitly not in scope

**No new entities.** `WorkOrder`, `Project`, `Milestone`, `Task` and `Deliverable` stay
deferred (§53–54, Phase 3), and `WorkReadyToStart` remains the seam ticket 53 subscribes to.

Recorded here so the next reader does not reopen it: this ticket gives a customer a truthful
answer to "what is happening with my request?" (§3, question 4) using the machinery that
exists. It does **not** attempt project management. If milestones, task boards and
deliverables are wanted, that is Phase 3 arriving on purpose, not this ticket growing.

`src/lib/navigation.ts:409-411` keeps those modules out of the navigation, and
`instrumentation.ts:31` and `src/services/invoices/handlers.ts:22` both already note project
creation as ticket 53's. Leave all three as they are.

## Acceptance criteria

- [ ] A paid request can be moved through start → deliver → complete by staff with the right
      permissions, and refused for those without.
- [ ] The graph and the permission table agree; the existing test proves it.
- [ ] Staff can post a progress update with no state change, and the customer sees it on the
      request timeline within one refresh.
- [ ] An internal update is invisible to the customer — not hidden, **absent**: not in the
      DOM, not in the RSC payload, not in a notification. Asserted by a test on the payload.
- [ ] Every new state has customer-facing copy in plain language and a `<StatusBadge>` tone.
- [ ] `ready-to-start` empties when work starts; in-progress work is visible in its own queue.
- [ ] A customer opening a request that has been running for weeks can read what happened and
      when, in order.
- [ ] The customer is notified when work starts and when it is delivered, honouring their
      preferences.
- [ ] No `Project`, `WorkOrder`, `Milestone` or `Task` collection was added.

## Notes

Everything up to the dead end is genuinely finished:
`quoted → accepted → QuoteAccepted → createFromQuote → invoice → paid → InvoicePaid →
converted + WorkReadyToStart → staff notification → ready-to-start queue`, with
convert-once-only covered at `src/services/invoices/invoices.integration.test.ts:392-432`.
This ticket does not revisit any of it; it continues past the last arrow.

Note also that the customer-facing request and quote pages **do** exist and work, contrary
to `01-mvp-todo.md` rows 9.5 and 9.6, which still show them unstarted. Those rows are
corrected as part of this set.
