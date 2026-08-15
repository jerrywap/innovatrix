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
- [ ] A quote cannot be issued without at least one line item, a total, and an expiry date.
- [ ] Totals are exact integer money; tax and discount apply in a documented, tested order.
- [ ] Issuing sends an email with the PDF attached or linked, and the PDF matches the on-screen quote exactly.
- [ ] Revising an issued quote produces v2 and marks v1 superseded; the customer sees only v2 as actionable.
- [ ] Accepting records user, timestamp and **version**, and creates exactly one invoice.
- [ ] An expired quote cannot be accepted, and says so clearly.
- [ ] A customer from another organization cannot view or accept the quote.
- [ ] "Ask Question" reaches staff and leaves the quote actionable.
- [ ] Staff without `quote.issue` can draft but not issue.
- [ ] The quote appears in the customer's "Needs Your Attention" (ticket 15) the moment it is issued.
