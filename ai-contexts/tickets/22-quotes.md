# 22 — Quotes & Estimates

**Bucket:** §14.1–14.5 · **Depends on:** 20 · **Blocks:** 23 · **Size:** L
**Spec:** §51 (quotes), §52 (quote → work), §90 (audit), §102 (customer attention)

## Why
The quote is where an AI conversation becomes a commercial commitment. It is the last purely-human judgement
step before money moves, and §73 forbids the AI from setting pricing — so this screen is deliberately staff-owned.

## Scope

### Quote builder — `/staff/requests/[reference]/quote/new`
Per §51, a quote carries: scope · deliverables · exclusions · line items · taxes · discounts · payment terms ·
timeline · expiration · notes · attachments.
- **Line items**: description, quantity, unit price (Money), line total. Item kinds: development, service,
  licence, third-party cost. Currency defaults to the customer organization's, overridable.
- **Scope / deliverables / exclusions** are structured lists, not one prose blob — exclusions are what prevent
  disputes later, so they get their own first-class field.
- **Payment terms**: full up front · deposit + balance (deposit % or fixed) · milestone schedule (recorded for
  MVP; milestone *tracking* is post-MVP).
- **Timeline**: estimated start and duration, expressed as an estimate with explicit caveat language.
- **Expiry**: default 30 days, configurable.
- Prefill from the request: customer, base product, requirements. Show the requirements alongside the builder so
  the quote is written against what was actually agreed.
- Save as draft; preview exactly as the customer will see it; issue.

### States
```
draft → issued → accepted
              ↘ rejected
              ↘ expired      (by the ticket-25 sweep)
              ↘ superseded   (when a revision is issued)
```
Revising an issued quote creates **version 2** and supersedes v1 — never edits in place. The customer sees the
current version and can view prior ones.

### Customer view — `/dashboard/quotes/[reference]`
Readable, professional presentation of everything above, plus:
- **Accept · Reject · Ask Question** (§51).
  - *Accept* → confirmation dialog restating total and terms → records acceptor, timestamp, quote version, IP →
    emits `QuoteAccepted` → creates the invoice (ticket 23) → request moves to `approved`.
  - *Reject* → optional reason → notifies staff → request returns to `under_review`.
  - *Ask Question* → posts into the ticket-21 conversation, quote stays `issued`.
- Download PDF.
- A plain-language "what happens next" for each state — never leave the customer guessing (§3).

### PDF (§14.4)
Server-side generation (React-PDF or Puppeteer via the ticket-25 job queue — pick one and note the tradeoff:
React-PDF is lighter, Puppeteer matches the web layout exactly). Branded, includes reference, dates, all terms,
and stored to object storage; the stored key is recorded on the quote so the customer always downloads the exact
document they were sent. Emailed on issue (ticket 24).

### Audit (§90, §51)
Issued, viewed-by-customer, accepted, rejected, expired and superseded are all audited with actor, timestamp
and quote version. **Acceptance is a contract event** — it must be reconstructable months later.

## Acceptance criteria
- [x] A quote cannot be issued without at least one line item, a total, and an expiry date.
- [x] Totals are exact integer money; tax and discount apply in a documented, tested order.
- [ ] Issuing sends an email — **ticket 24**. The PDF question is answered differently (below): the page *is* the document, so "matches exactly" holds by construction.
- [x] Revising an issued quote produces v2 and marks v1 superseded; the customer sees only v2 as actionable.
- [x] Accepting records user, timestamp and **version**, and creates exactly one invoice.
- [x] An expired quote cannot be accepted, and says so clearly.
- [x] A customer from another organization cannot view or accept the quote.
- [ ] "Ask Question" from the quote page — **not wired**. Ticket 21's thread exists and works on requests; the quote page does not yet host one.
- [x] Staff without `quote.issue` can draft but not issue.
- [x] The quote appears in the customer's attention list the moment it is issued — `attentionItems` already counts `status: "issued"` quotes, and issuing writes the customer-visible activity row.


## Implementation notes

### The PDF is the page

Ticket 22 offered React-PDF or Puppeteer "via the ticket-25 job queue". That
queue does not exist, so Puppeteer would have meant launching Chromium inside a
Server Action — seconds per quote, a ~300MB dependency, and a deploy target that
has to support it. React-PDF avoids that but introduces a **second layout** to
keep in step with the web page, and the drift between them is silent.

So the quote page carries a print stylesheet and the browser's own Save-as-PDF
produces the document. "The PDF matches the on-screen quote exactly" stops being
something to test and becomes something that cannot be otherwise.

What makes this safe rather than merely cheap: **a quote version is immutable.**
A revision creates v2 and supersedes v1 — it never edits in place — so
re-rendering always produces the same document. The usual reason to store a
rendered artefact ("the customer must download exactly what they were sent") is
already guaranteed by the data. `pdfStorageKey` stays on the model for the day a
branded email attachment is wanted.

The stylesheet does the three things a naive one misses: it forces a light
palette (a dark theme prints as a black page, or white-on-white once backgrounds
are dropped), it keeps `print-color-adjust` on the table header and total row so
the structure survives, and it suppresses the `(https://…)` that browsers append
to every link.

### `reference` could not be unique, and a test found it

`referenceField` carries `unique: true`, so the first v2 failed with
`E11000 ... reference_1 dup key`. A revision **keeps** the reference and bumps
`version` — deliberately, because a customer talking about "QUO-2026-0004" means
the quote, not one revision of it, and renumbering would make their emails stop
matching our records. Uniqueness moved to `{reference, version}`.

### The customer's decision is performed by the system

`decide()` originally passed a customer actor to the follow-on request
transition. `quoted → approved` happens to allow a customer, so acceptance
worked; `quoted → under_review` does not, so **rejection silently left the
request parked in `quoted`** — the `.catch()` swallowed it. Caught by a test.

Now a `system` actor, which is also the truthful reading: a customer is not
exercising `request.update_status`, they answered a question and the platform
reacted.

### Expiry is decided by the date, not the status

Ticket 25's sweep marks quotes `expired` on a schedule. Between the expiry
passing and the job running, `status` still reads `issued` — and accepting in
that window would make a contract from a lapsed quote. Both the service and the
view check the **date**, so the screen never offers a button the server would
refuse. Its own test.

### Rounding, and where the odd penny goes

Discount before tax, so tax applies to what is actually charged. Rounding once
at the end rather than per line — twenty lines at £3.33 differ by eight pence
between the two, and eight pence reconciles against nothing. The deposit rounds
**down** so it never exceeds the stated share; the balance absorbs the
remainder, and a property test checks the two always sum to the total.

### A 500 on every customer page, found while testing this

Not ticket 22's, but measured here: `super@innovatrix.test` got **HTTP 500 on
every page under `/dashboard`**. `requireOrg()` throws for a user with no
organisation on the reasoning that every customer gets one at registration — but
a staff account has none, and a thrown `ForbiddenError` from a page reaches
`error.tsx` rather than becoming a 403.

Fixed in the dashboard layout: staff are redirected to `/staff`, which is the
mirror of the `/dashboard?denied=staff` redirect that already existed in the
other direction. Two hazards handled rather than hoped past — `requireOrgOrNull`
swallows `NEXT_REDIRECT`, so the signed-out case is checked explicitly; and
redirecting *everyone* org-less to `/staff` would loop, so only staff go there
and anyone else gets an explanation.

### Not built

- **Email on issue** — ticket 24.
- **"Ask Question" on the quote page** — ticket 21's thread works on requests;
  the quote page does not host one yet. The subject check in the messaging
  action refuses `quote` explicitly rather than allowing an unvalidated subject.
- **Quote attachments** (§51 lists them).
- **Milestone schedules** are recorded as a payment term; tracking is post-MVP,
  and the builder says so rather than implying a schedule will appear.
