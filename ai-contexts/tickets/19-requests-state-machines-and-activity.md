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
- [ ] An invalid transition (e.g. `submitted → converted`) is rejected server-side even when called directly.
- [ ] A customer cannot trigger a staff-only transition.
- [ ] Every status change produces exactly one activity event and one audit entry.
- [ ] The customer timeline contains no internal notes; the staff timeline contains both.
- [ ] Staff editing customer-confirmed requirements is impossible through the API, not merely absent from the UI.
- [ ] Opening a request as staff shows base product, version, transcript and requirements without extra clicks (§101).
- [ ] Requirement edit history is complete and attributable.
- [ ] Event handlers failing (e.g. email down) do not roll back the state transition.
