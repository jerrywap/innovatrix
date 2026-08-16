# 20 — Staff Portal: Queues, Request Workspace & Customer 360

**Bucket:** §12 · **Depends on:** 19 · **Blocks:** 22 · **Size:** L
**Spec:** §30–34 (customer service portal), §39 (follow-ups), §40 (assignment), §102 (action-oriented)

## Why
§30 is explicit: this "should not simply be a generic admin table." §32 sets the bar — the portal must be
**operational, not merely informational**. Staff should arrive at a queue of work, not a database browser.

## Scope

### `/staff` — dashboard (§31)
Counters, each a link into a pre-filtered queue:
New Requests · Awaiting Staff Response · Waiting for Customer · Quotes Awaiting Approval ·
Customization Requests · Customers Needing Follow-Up · Overdue Follow-ups · Unassigned.
(Open/Urgent Tickets from §31 are post-MVP — omit.)
Counts come from indexed aggregations (ticket 02), scoped by the staff member's role where relevant.

### Work queues (§32) — `/staff/queue/[key]`
`new-custom-build` · `new-customization` · `waiting-for-innovatrix` · `waiting-for-customer` ·
`quotes-awaiting-response` · `payments-awaiting-customer` · `overdue-followups` · `unassigned` · `mine`.
Each is a `DataTable` with reference, customer, subject, age, assignee, status, last activity, and bulk assign.
Sort defaults to oldest-first — the thing waiting longest is the thing most at risk.

### Request workspace — `/staff/requests/[reference]`
The core screen. Single view, no hunting (§101):
- **Left**: customer-confirmed requirements, assumptions, attachments, base product + version with a link to the
  product and its demo/technical info.
- **Centre**: conversation with the customer (ticket 21) and internal notes, clearly separated.
- **Right**: status + permitted transitions (from ticket 19), assignment, follow-ups, related quotes, timeline.
- **AI transcript** in a collapsible panel — the full §19 conversation, read-only.
- **Internal interpretation** editor (§34), stored separately from customer requirements and never shown to
  the customer.
- Actions: assign · request customer action (moves to `waiting_for_customer` and prompts the customer) ·
  escalate · move to technical review · create quote (ticket 22).

### Assignment (§40)
- Assign to a staff member and/or a team; `assignments[]` keeps the full history with who reassigned and why.
- Typical routes documented in-app: Custom Build → Customer Service → Technical Analyst; Customization →
  Customer Service → Product Specialist.
- Reassignment notifies the new assignee (ticket 24).

### Customer 360 — `/staff/customers/[organizationId]` (§33)
Everything about one customer on one page: organization + primary contact + customer-since; counters (active
requests, owned products, pending quotes, outstanding balance); owned products with versions and licence status;
orders; requests; quotes; invoices; download history; and a **unified chronological timeline** across all of it.
Quick actions: create quote · start follow-up · message customer.

### Follow-ups (§39)
`{ owner, dueAt, subjectType, subjectId, organizationId, status, notes }`.
Create from any request or customer page ("follow up with customer tomorrow", "check payment Monday").
`/staff/followups` — mine / team / overdue. **Overdue is surfaced prominently** (§39) on the dashboard and in nav.

## Acceptance criteria
- [ ] Dashboard counters match their queue lengths exactly — **same `QUEUES` entry drives both, so true by construction; not verified with populated queues**.
- [x] Queue queries use indexes — `explain()` shows no `COLLSCAN` with 10k seeded requests.
- [ ] Role-scoped actions — **`permittedTransitions` filters by permission and is unit-tested; not verified live per role**.
- [x] The request workspace shows base product, version, AI transcript and requirements without navigation.
- [x] Internal notes are never present in any customer-facing response payload — the customer view object has no such key at all.
- [x] "Request customer action" moves the request and emits `CustomerActionRequested` (integration-tested). The customer-side **prompt** is the timeline entry; a notification is ticket 24.
- [x] Assignment history survives reassignment and shows who did it and when.
- [ ] Customer 360 timeline interleaves everything chronologically — **built on one indexed `activityEvents` query; not verified with a populated customer**.
- [x] An overdue follow-up is visible from the dashboard within one click — verified live: the counter read `1` and the Overdue tab showed exactly that row.
- [x] Every staff action on a request is audited (§90). Customer-record actions beyond requests arrive with ticket 21+.

## Implementation notes

Pulled into this batch at the user's request, minus two cross-ticket
dependencies.

### Counters and queues cannot disagree, because they read the same object

Each queue is one entry in `QUEUES` — label, filter, sort. The dashboard counts
it and the page lists it from that entry. "Dashboard counters match their queue
lengths exactly" holds by construction rather than by being tested into
agreement.

Oldest first, deliberately. Newest-first is the conventional table sort and it
is wrong for a work queue: it buries the request that has been sitting nine days
under this morning's arrivals.

### Index work, measured rather than assumed

`npm run db:explain:queues` seeds 10,000 requests and explains every queue,
failing on any `COLLSCAN` — and failing loudly when a plan cannot be read, which
is the correction `explain-marketplace.ts` needed.

First run: all seven on an index, but `unassigned` sorted **5,000 documents in
memory** to return 100 (84ms). Added
`{status, currentAssigneeUserId, createdAt}`; it now examines 100 via
SORT_MERGE. `technical-review` still sorts in memory (1,667 examined, 68ms) —
inside budget, left alone, and the comment says `{status, updatedAt}` is the fix
if the collection grows an order of magnitude.

`createdAt` rather than `updatedAt` for `unassigned` is deliberate: "nobody has
picked this up" is about how long it has waited, and `updatedAt` moves whenever
anything touches the row, resetting the age of the thing most at risk.

### `/staff/requests` redirects rather than listing everything

§30: *"should not simply be a generic admin table."* A flat list of every
request answers "what exists", which nobody needs. It redirects to the
unassigned queue. Kept as a route because `/staff/requests/[reference]` lives
underneath it.

### Two things are disabled rather than missing

Customer messaging is ticket 21 and quote creation is ticket 22. Both appear
where §30 puts them, greyed, saying which ticket. An absence reads as an
oversight; a disabled control with a reason reads as a plan.

### Staff see what the assistant tried to say

The transcript panel renders `withheldContent` alongside the substitution. A
record showing only a polite deflection would hide that the assistant tried to
name a figure, which is the one thing a reviewer would want to know.

### Not built

- **Bulk assign** on queue rows. Single assignment works through the service
  with full history; the multi-select UI is not there.
- **Follow-up creation.** `/staff/follow-ups` remains ticket 20's stub; the
  overdue counter on the dashboard is live and counts real rows.


## Part B — the gaps, closed

### Follow-ups (§39)

`/staff/follow-ups` with four scopes, and **Overdue is the default tab**. A
follow-up exists because somebody judged this would otherwise fall through the
cracks; the one that already has is what should greet you. Landing on "mine"
would put a personal list ahead of a problem.

Created from the request workspace and Customer 360 by a control that stays
collapsed until asked for — both screens are already dense, and a permanently
open form on a page you visit to read something else is noise. The date offers
"Tomorrow / In 3 days / Next week", because that is how a reminder gets
described out loud and making somebody drive a date picker to say "tomorrow" is
the friction that stops them bothering.

**Deliberately not audited and producing no activity event.** A reminder is not
a change to a customer's record; auditing every "check this Monday" would bury
the entries that matter under a stream of private notes.

Verified live: overdue tab shows only the overdue row, "everyone's" shows both
open ones and not the closed one, and the dashboard counter reads the same
number the tab does.

### Bulk assign (§32)

Selection reveals the assign bar rather than a permanently-disabled one, and
the staff list is fetched on demand so a screen that is mostly read does not
carry every staff member's name in its payload.

**Partial success is the normal outcome, not an error.** Someone triages ten
rows; one has been picked up in the meantime. Failing the batch because of it
would make the feature useless exactly when it is busiest — so each is attempted
independently and the result says "assigned 9 · 1 had already moved". Every one
still goes through `assign()`, so the history, the audit row and the permission
check are unchanged: this is a loop, not a second implementation.

One thing the linter caught and was right about: clearing the selection in a
`useEffect` watching the action result is a cascading render, and the visible
symptom is the bar flashing before it clears. Replaced with React's documented
adjust-during-render pattern.

### Attachments (§19)

Both halves, because a reader with no writer is dead code. The **customer**
uploads — it is their document, and staff attaching files on their behalf would
blur whose evidence is whose, which is the distinction §34 exists to protect.
Both sides read.

Every file links to `/api/request-files/[requestId]/[index]`, never to the
object: the bucket serves any known key unsigned, and these are specs, price
lists and spreadsheets of staff names. The **array position is the handle**
precisely because the storage key must not reach the browser — which means a
caller can send `999` or `-1`, and both land as a plain 404.

Caught while writing it: the first version validated the returned key with
`assertKeyBelongsTo`, which checks the `products/{id}/versions/{id}/` layout.
An attachment key is `attachments/{org}/{subject}/`, so it would have rejected
every legitimate upload. `assertAttachmentKey` now checks the right shape.

### Still not built

- **Request attachments during the AI interview** (ticket 17's scope). The
  customer can attach a file to a *submitted* request; attaching one mid-
  conversation is not wired.
- **Team scoping on follow-ups** is "everyone's" rather than a real team model —
  there are no teams yet.
