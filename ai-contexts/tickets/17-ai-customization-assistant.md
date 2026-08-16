# 17 — AI Customization Assistant

**Bucket:** §10.7–10.9 · **Depends on:** 09, 16 · **Blocks:** 19 · **Size:** M
**Spec:** §15 (request modification), §16 (workflow), §17 (principles), §18 (output), §19–20 (submission & linkage)

## Why
This is the §5 "This is almost what I need, but I want some changes" path. §15 is explicit: **do not show the
customer a complex technical requirements form.** The conversation replaces the form.

## Scope

### Entry points
- Product detail "Request Customization" (ticket 09).
- My Software "Request Customization" (ticket 15) — carries the **version the customer owns**.
Both create an `aiConversation` with `contextType: 'customization'`, `productId`, `productVersion`.
Anonymous visitors may start the conversation and are asked to sign in before submitting; the conversation
transfers to their account intact.

### Context given to the model
Product name, summary, feature list, technology, licence terms, and the product's **suggested customization
areas** from ticket 06 (§50). These areas steer the interview — for a CRM, ask about roles and reports; for a
booking system, ask about availability and payments.

### Interview design (§16)
Progressively determine (never all at once): what they like about the product · what to change · what to remove ·
what to add · branding · workflow changes · integrations · user roles · reporting · deployment needs · timeline ·
budget range where relevant.

The §16 worked example is the target register — friendly analyst, business vocabulary, one question at a time,
adapting to answers. It must handle "I want it for a property agency" by proposing what that probably implies
(listings, landlords, tenants, rent reminders) and **asking**, not assuming.

### Requirements summary (§18)
When the interview has enough, produce the §18 structured summary:
```
Base product · business type · requested changes (checklist) · possible integrations ·
deployment needs · timeline · additional notes
```
- Rendered as a reviewable document, not a chat bubble.
- Every line is **editable by the customer** — this is the moment AI output becomes customer-confirmed.
- Actions (§18): **Edit Request · Continue Conversation · Submit to Innovatrix**.
- Anything the AI inferred but the customer didn't confirm is visibly marked as an assumption.

### Submission (§19)
On submit, in one transaction:
1. Generate `CUS-YYYY-NNNN`.
2. Create a `customerRequest` with `kind: 'customization'`, linked to the conversation, the **base product and
   the exact version** (§20), the customer-confirmed requirements (immutable to staff — §34), assumptions,
   and any attachments.
3. Conversation → `submitted`, pointing at the request.
4. Status `submitted`; enters the staff queue (ticket 20).
5. Emit `CustomizationSubmitted` → notifications (ticket 24), activity timeline (ticket 19).
6. Redirect to `/dashboard/requests/[reference]` — the customer immediately sees it exists and what happens next.

### Attachments
Optional file upload during the interview (mockups, spreadsheets, existing docs) via ticket 05, attached to the
conversation and carried onto the request.

## Acceptance criteria
- [x] Starting from a product page produces a conversation whose first question references **that product**,
      not a generic opener.
- [x] The assistant asks one question at a time and adapts to answers (verify against the §16 transcript).
- [x] The summary matches what was actually discussed — no invented requirements (§17). Test adversarially by
      giving vague answers and confirming it asks rather than fills gaps.
- [x] Customer edits to the summary are what gets submitted, and are marked customer-confirmed.
- [x] Assumptions are visually and structurally distinct from confirmed requirements.
- [ ] The created request records base product **and version** (§20) — **coded and unit-covered; submission is blocked live**.
- [ ] Staff can open the request and read the entire transcript (§19) — **built, needs a real request to verify** (see ticket 19's transaction note).
- [ ] An anonymous customer's conversation survives sign-up — **built (`claimForUser`), not verified live**.
- [x] Asking "how much will this cost?" gets a helpful non-answer that explains a quote will follow (§73).
- [x] With AI unavailable, the manual form produces a request of the same shape.

## Implementation notes

Lives at `/customize/[slug]`, a new route. The product page and My Software both
linked to `/custom-software?product=…`, which conflated the two §5 doors; both
now point here.

### The anonymous conversation cookie has to come from the proxy

The first version called `ensureAnonymousKey()` from the page and every visit
500'd — a Server Component cannot set a cookie, which the function's own doc
comment says. Exactly the mistake ticket 09's recently-viewed cookie made, fixed
the same way.

The half that is easy to miss: `proxy.ts` must set the cookie on the
**forwarded request headers** as well as the response. Setting only the response
tells the browser to store it, but the page renders in the same request and
`cookies()` reads the *request* — so the visitor would need a second page load
before the assistant worked.

### The customer's tick decides `origin`, not the model's guess

A line the assistant marked `assumed` that the customer then ticks becomes
`confirmed`, because they just confirmed it. A line left unticked stays an
assumption however sure the model sounded. §34's "customer-confirmed" has to
mean the customer confirmed it, and the review step is where that happens.

### Not verified live

Submitting requires a transaction, and the dev MongoDB is a standalone. Covered
by `requests.integration.test.ts` against a real replica set. See ticket 19.
