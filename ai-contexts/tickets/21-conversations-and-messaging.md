# 21 — Conversations & Messaging

**Bucket:** §13 · **Depends on:** 19, 20 · **Blocks:** — · **Size:** M
**Spec:** §38 (unified communication), §37 (ticket communication pattern), §34 (clarification), §69 (notifications)

## Why
§38 asks for one reusable conversation model rather than a bespoke thread per record type. The single hardest
requirement here is §37: **internal messages must never be exposed to customers.** Treat that as a security
boundary, not a UI preference.

## Scope

### Model (§38)
- `conversations`: `{ subjectType: 'request' | 'order' | 'quote', subjectId, organizationId, participants[], lastMessageAt }`.
  Created lazily on first message. One conversation per subject in MVP.
- `messages`: `{ conversationId, senderType: 'customer' | 'staff' | 'system', senderId, body, attachments[], visibility: 'customer' | 'internal', createdAt, readBy[] }`.

### The visibility boundary (§37)
Defence in depth — all four layers, not one:
1. **Repository**: `listMessages({ conversationId, audience })` — when `audience === 'customer'` the
   `visibility: 'internal'` filter is applied in the query itself, not in application code afterwards.
2. **Service**: customer-facing services can only call the customer-audience method.
3. **Serialization**: the customer DTO type has no field that can carry an internal message.
4. **Test**: an explicit test asserts internal messages are absent from every customer-facing payload.
The staff UI marks internal notes with an unmistakable visual treatment (distinct background + "Internal only"
label) so nobody posts one by accident, and composing defaults to whichever mode the staff member last used —
with the current mode always visible.

### Threaded UI
Following §37's shape: sender, timestamp, body, attachments, interleaved with system state-change entries from
the ticket-19 activity stream ("Status changed to Technical Review"). Rendered on:
- Customer: request detail, quote detail, order detail.
- Staff: request workspace centre column, Customer 360.

### Composing
- Markdown-lite (bold, italics, lists, links) rendered sanitised.
- Attachments via ticket 05 presigned uploads; images preview inline, other types show as files.
- Staff toggle: **Reply to customer** / **Internal note**.
- On send: persist, emit an event, mark the request's `waiting_on` side, notify the counterpart (ticket 24).

### Read state & unread counts
`readBy[]` per message; unread badges on the dashboard, the request list and the staff queues. Staff-side
unread drives the "Awaiting Staff Response" counter (§31).

### Email notification (§13.5 in the todo)
New counterpart message → templated email with a snippet and a deep link. **Reply-by-email is not in MVP**;
the email says so and links back into the app.

## Acceptance criteria
- [ ] An internal note is absent from the customer's request payload — verified by inspecting the RSC/API
      response, not the rendered page.
- [ ] Switching a staff reply from "Internal" to "Customer" is deliberate and clearly indicated before sending.
- [ ] Attachments are only downloadable by conversation participants (entitlement-style check, ticket 05/14 pattern).
- [ ] System state-change entries appear in the thread in correct chronological position.
- [ ] Unread counts are accurate after reading on another device.
- [ ] A customer replying moves the request to "Awaiting Staff Response" and updates the queue counter.
- [ ] Message bodies are sanitised — an XSS payload in a message renders as text.
- [ ] A customer cannot post to a conversation belonging to another organization.
