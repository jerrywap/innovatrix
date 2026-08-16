# 19 — Requests, State Machines, Events & Activity

**Bucket:** §11 · **Depends on:** 17, 18 · **Blocks:** 20, 22 · **Size:** M
**Spec:** §91 (state machines), §92 (events), §70 (timeline), §34 (requirements management), §101 (never lose context)

## Why
Both AI doors converge here. §91 requires explicit, server-validated transitions; §92 requires canonical business
events; §70 requires the timeline be *generated from* those events rather than hand-written; §101 requires the
full originating context to travel with the request.

## Scope

### Unified request model
One `customerRequests` collection with `kind: 'customization' | 'custom_build'`. Shared fields: reference,
organization, submitter, status, assignments, requirements (customer-confirmed), assumptions, attachments,
conversation id, quote ids, activity. Customization additionally carries `baseProductId` + `baseProductVersion`.

### State machine (§91)
```
draft → submitted → under_review → waiting_for_customer ⇄ under_review
                              ↓
                        technical_review
                              ↓
                           quoted → approved → converted
                              ↓        ↓
                          rejected  cancelled
```
- Declared as a single `TRANSITIONS` map (from ticket 02's `STATES.md`), each entry naming the permission
  required and whether the actor may be the customer.
- `RequestService.transition(id, to, actor)` is the **only** way status changes. It validates the transition,
  writes the activity event, writes the audit entry, and emits the domain event — atomically.
- An invalid transition throws `StateTransitionError`; the UI never offers an action the machine would refuse.

### Domain events (§92)
In-process event bus (`src/lib/events/`) — synchronous dispatch, handlers enqueue background work rather than
doing it inline. **No distributed event infrastructure** (§92 says avoid it).
Events: `RequestSubmitted` · `CustomizationSubmitted` · `RequestAssigned` · `CustomerActionRequested` ·
`QuoteIssued` · `QuoteAccepted` · `QuoteRejected` · `PaymentReceived` · `OrderCompleted` · `LicenceIssued` ·
`ProductPublished` · `ProductVersionReleased`.
Each event handler may: write an activity record, create notifications (ticket 24), enqueue a job (ticket 25),
update a staff queue counter.

### Activity timeline (§70)
- `activityEvents` written from the event bus — never by UI code.
- Rendered chronologically on requests, orders and quotes, in plain language:
  *"14 Aug 10:31 — Customization submitted" / "14 Aug 11:15 — Assigned to Sarah"*.
- Two visibilities: customer-visible narrative and internal-only detail. The customer timeline must never leak
  internal notes or staff deliberation (§37).

### Requirements integrity (§34)
- `customerRequirements` are **immutable to staff**. Staff who need a change ask the customer, who edits and
  re-confirms — producing a new version with history.
- `internalInterpretation` is a separate staff-owned field. Both are shown side by side in the staff workspace
  (ticket 20) so they stay distinguishable.
- Requirement edits are versioned: who changed what, when.

### Context preservation (§101)
The request detail — on both sides — always surfaces: base product + version (with a link), the AI transcript,
the structured requirements, product demo access and technical information. Staff must never receive
"customer wants CRM" with nothing attached.

### Customer request views
`/dashboard/requests` (list, filterable by status) and `/dashboard/requests/[reference]`: status with a plain
explanation of what it means and what happens next, requirements (with edit while `waiting_for_customer`),
timeline, messages (ticket 21), quotes (ticket 22).

## Acceptance criteria
- [x] An invalid transition (e.g. `submitted → converted`) is rejected server-side even when called directly.
- [x] A customer cannot trigger a staff-only transition.
- [x] Every status change produces exactly one activity event and one audit entry.
- [x] The customer timeline contains no internal notes; the staff timeline contains both.
- [x] Staff editing customer-confirmed requirements is impossible through the API, not merely absent from the UI.
- [ ] Opening a request as staff shows base product, version, transcript and requirements without extra clicks (§101) — **the workspace renders all four; not verified against a real submitted request**.
- [x] Requirement edit history is complete and attributable.
- [x] Event handlers failing (e.g. email down) do not roll back the state transition.

## Implementation notes

### The permission layer is a second map, with a test tying it to the first

`REQUEST_TRANSITIONS` already existed and matched §91. Ticket 19 wants each edge
to name a permission and whether the customer may take it — but `STATES.md` is
generated from `states.ts` and the generator iterates every machine as
`Record<S, readonly S[]>`. Enriching the map in place would break it for all
seven.

So `REQUEST_TRANSITION_RULES` is keyed `"from->to"`, and `states.test.ts`
asserts the two agree **in both directions**: every edge has a rule, no rule
invents an edge, and no rule names a permission that does not exist. A missing
rule is a button that does nothing; a rule for a non-existent edge reads as
coverage and is not.

Corrected while implementing: the plan used `quote.create`, which does not
exist. The real permissions are `quote.draft` / `quote.issue`.

### A failing handler cannot undo what happened

Dispatch is after commit, and each handler is individually isolated. Both are
load-bearing: inside the transaction, a throwing handler aborts it and the
transition silently disappears; without per-handler isolation, registration
order becomes an undocumented priority list. Both are tested.

### Verified — 25 integration tests against a real replica set

`submitted → converted` refused server-side · a customer refused a staff-only
edge · a staff member without the named permission refused · another
organisation's request invisible · exactly one activity event and one audit
entry per transition · the internal note absent from the customer's timeline ·
plain-language narrative rather than the enum · a throwing handler not rolling
back · handlers after a failing one still running · **staff refused write access
to `customerRequirements` through the service** · requirement history keeping
the version it replaced · assignment history surviving reassignment.

### Not verified live — the dev database is a standalone

`submitFromConversation` runs in one transaction so a rolled-back submission
cannot burn a reference number, and a standalone mongod cannot start one.
`docker-compose.yml` exists for this; `npm run db:up` provides the replica set.
Checkout and payment fulfilment are blocked by the same thing, so this is
environmental and pre-existing rather than introduced here.
