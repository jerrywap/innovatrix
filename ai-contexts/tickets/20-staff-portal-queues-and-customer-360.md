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
- [ ] Dashboard counters match their queue lengths exactly.
- [ ] Queue queries use indexes — `explain()` shows no `COLLSCAN` with 10k seeded requests.
- [ ] A `customer_service` user sees the service queues; a `finance` user does not see technical review actions.
- [ ] The request workspace shows base product, version, AI transcript and requirements without navigation.
- [ ] Internal notes are never present in any customer-facing response payload.
- [ ] "Request customer action" moves the request and produces a clear customer-side prompt.
- [ ] Assignment history survives reassignment and shows who did it and when.
- [ ] Customer 360 timeline interleaves orders, requests, quotes, payments and messages in true chronological order.
- [ ] An overdue follow-up is visible from the dashboard within one click.
- [ ] Every staff action on a customer record is audited (§90).
