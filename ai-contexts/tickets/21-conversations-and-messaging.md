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
- [x] An internal note is absent from the customer's request payload — verified by inspecting the RSC/API
      response, not the rendered page.
- [x] Switching a staff reply from "Internal" to "Customer" is deliberate and clearly indicated before sending.
- [ ] Message attachments — **not built**. The model and the DTO carry them; there is no composer upload and no download route yet. Request-level attachments (ticket 20) are done and use exactly the pattern this needs.
- [ ] System state-change entries interleaved into the thread — **not built**. Activity and messages render as two sections rather than one merged feed.
- [x] Unread counts are accurate after reading on another device — `$addToSet`, integration-tested for idempotency. **No badge renders them yet**; the count function exists and is untested in the UI.
- [x] A customer replying moves the request to "Awaiting Staff Response" and updates the queue counter.
- [x] Message bodies are sanitised — an XSS payload in a message renders as text.
- [x] A customer cannot post to a conversation belonging to another organization.


## Implementation notes

### Four layers, and each one is load-bearing

§37 says treat this as a security boundary rather than a UI preference, so:

1. **Repository** — `listForConversation` takes a **required** `audience` and,
   for a customer, puts `visibility: "customer"` *into the query*. Not a
   `.filter()` afterwards: a filter in application code is one early return away
   from being skipped, and the bug is silent. `{conversationId, visibility,
   createdAt}` was already indexed, so the safe read is also the fast one.
2. **Service** — `customerThread()` and `staffThread()` are separate exports.
   The customer-facing one **takes no audience parameter**, so there is no
   argument to get wrong.
3. **Serialisation** — `CustomerMessage` has no `visibility` field. The type
   cannot express an internal message, so one cannot be serialised even by a
   mistake that clears the first two layers. Verified structurally: the
   interface's fields are `id, senderType, senderName, body, at, attachments,
   mine`.
4. **Test** — the assertion is on the **serialised payload**, not the component.

Verified live the way the criterion is written — by grepping the customer's raw
HTTP response for a canary string planted in an internal note. Absent from the
customer's response, present in the staff one.

### Two actions, not one with a role check

A single action taking `senderType` would need a branch deciding whether the
caller may claim what they sent — and that branch *is* the boundary, sitting in
the same function as the happy path. Separated,
`replyAsCustomerAction` cannot express an internal note: it takes no
visibility, and `postMessage` coerces a customer sender to `customer`
regardless. Coercing rather than refusing because a customer has no legitimate
reason to send `internal`, and there is no case where refusing would be better.

### The staff composer starts on Internal

§37's criterion is that switching to a customer reply is *deliberate*.
Defaulting to visible and relying on the writer to notice is the opposite. The
mode is stated **in words** as well as by colour — "The customer will never see
this" — because colour alone is exactly the cue somebody misses when busy.

Getting this wrong in the safe direction costs an internal note the customer
never sees. Wrong the other way is a disclosure.

### An internal note is not a reply

`lastStaffMessageAt` is set only by a **customer-visible** staff message. The
bug that prevents: a request drops out of "awaiting staff response" because
somebody wrote a note to themselves, and the customer keeps waiting. Its own
test.

### Sanitisation is structural

Bodies render through the same `Markdown` component the AI assistant uses,
which builds React elements and never HTML. Verified live: `<img src=x
onerror=…>` and `<script>` render as text while `**bold**` still renders bold —
safe by construction rather than by a blocklist that has to keep up.

### Not built

- **Message attachments.** The model and DTO carry them; no composer upload, no
  download route. Ticket 20's request attachments are the pattern to copy.
- **Interleaved system entries.** Activity and messages are two sections rather
  than one chronological feed.
- **Unread badges.** `unreadForOrganization` works and is tested; nothing
  renders it yet.
- **Order and quote threads.** The subject check refuses them explicitly rather
  than allowing an unvalidated subject through — tickets 22 and 23 add the
  branches.
