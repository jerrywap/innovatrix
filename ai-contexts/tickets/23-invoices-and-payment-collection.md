# 23 — Invoices & Payment Collection

**Bucket:** §14.6–14.9 · **Depends on:** 13, 22 · **Blocks:** — · **Size:** M
**Spec:** §63 (invoices), §52 (quote → work conversion), §62 (payments), §61 (historical pricing)

## Why
This closes the MVP revenue loop: a customization request that was quoted and accepted becomes an invoice the
customer can actually pay, through the same verified payment path as marketplace checkout. Without it, the AI
half of the platform generates paperwork instead of revenue.

## Scope

### Invoice creation (§52)
Sources (§63): marketplace orders, custom builds, customizations. On `QuoteAccepted`:
- Full payment terms → one invoice for the total.
- Deposit terms → a **deposit invoice** now and a balance invoice raised on completion (raised manually in MVP
  since there is no project tracking yet — leave the seam and document it).
- Snapshot every line from the quote (§61) — an invoice never re-derives from a live quote.
- Reference `INV-YYYY-NNNN`, due date from payment terms.

### States (§63)
```
draft → issued → partially_paid → paid
              ↘ overdue (by the ticket-25 sweep, from issued/partially_paid)
              ↘ cancelled
              ↘ refunded
```
`amountPaid` accumulates across payments; `paid` only when `amountPaid >= total`. Partial payments are first-class
(deposits, instalments), not an edge case.

### Payment
- `/dashboard/invoices/[reference]` → **Pay Now** → the ticket-12 provider abstraction, chosen by the invoice
  currency and admin routing. Identical verification path as checkout: initiate → redirect → webhook verifies →
  ticket 13 marks paid.
- Partial payment where the invoice allows it (enter an amount ≥ minimum).
- Staff can record an offline/bank-transfer payment (ticket 13.9) with proof upload — fully audited.
- **The frontend redirect never marks an invoice paid** (§13).

### On payment received
Inside one transaction:
1. Invoice → `partially_paid` / `paid`.
2. If fully paid and it originated from a quote: request → `converted`, emit `RequestConverted`.
3. Write activity + audit; notify customer and the assigned staff member.
4. **Work-order seam**: emit `WorkReadyToStart` carrying request, quote and invoice ids. Post-MVP ticket 53
   (projects) subscribes to it. For MVP, staff see the request in a "Ready to Start" queue — do not build a
   project entity here (§52 says a simple customization may create a work order, a significant one a full
   project; both are Phase 3).

### Invoice presentation
- Customer: `/dashboard/invoices` list (status, due date, amount, outstanding) + detail with line items,
  payment history, remaining balance, download PDF.
- Staff/finance: `/staff/invoices` filterable by status and overdue; outstanding balance per customer feeds
  Customer 360 (§33).
- PDF generation and email on issue, reusing ticket 22's pipeline.

### Reminders
Scheduled job (ticket 25): due-soon (3 days before), due-today, overdue (+1, +7, +14 days). Configurable,
cancelled the moment the invoice is paid — nothing worse than dunning a customer who already paid.

## Acceptance criteria
- [x] Accepting a quote with 50% deposit terms creates one deposit invoice for exactly half the total.
- [ ] Paying an invoice through each of the three providers marks it paid **only** after webhook verification.
- [x] Two partial payments totalling the invoice amount produce `paid`, not `partially_paid`.
- [x] Overpayment is refused or flagged for review — never silently accepted.
- [x] Full payment moves the source request to `converted` and emits `WorkReadyToStart`.
- [x] Invoice line totals equal the accepted quote's, forever, even after the quote is superseded.
- [ ] An overdue invoice appears in the customer's "Needs Your Attention" and the staff overdue queue.
- [ ] Reminders stop immediately on payment.
- [x] A customer from another organization cannot view or pay the invoice.
- [x] Every payment, manual or automatic, is audited with actor and source.

## What shipped, and what did not

**Shipped.** `invoice-service.ts` (create from quote, raise balance, apply payment,
`outstanding`), the `QuoteAccepted → invoice → WorkReadyToStart` handler chain in
`handlers.ts` registered from `instrumentation.ts`, customer `/dashboard/invoices` list and
detail with Pay Now and transfer instructions, staff `/staff/invoices` queue and detail with
Record payment, the `ready-to-start` staff queue, and 16 integration tests.

Offline payment extends here exactly as planned: `recordInvoicePaymentAction` is a second
caller of Part A's evidence machinery, not a second implementation — the presigned-PUT
handshake lives in `features/payments/components/evidence-upload.tsx` and both forms use it.

**Not shipped, deliberately.**

- **Reminders** are ticket 25's sweep. `remindersSentAt` is on the model and unused.
- **Overdue is derived, not stored.** `invoice-view` computes it from `dueAt`, so a customer
  never reads "issued" on something three weeks late while waiting for a cron. The stored
  status is what the dunning job will act on.
- **PDF is the print stylesheet**, as with quotes — the page *is* the document. Email on
  issue is ticket 24.
- **Provider payment could not be verified live.** Only Paystack is enabled in dev and it does
  not take GBP, so the seeded invoices render the honest "we can't take a card payment in GBP"
  path instead of a Pay Now button. `initiatePaymentForInvoice` is exercised by tests only.
- **Webhook-verified provider payment against an invoice** is written (`settleInvoice` in
  `fulfilment.ts`, branching on `payment.subjectType`) and untested live for the same reason —
  hence the third criterion above is still unticked.

## Live verification (2026-08-16)

Against the dev server, seeded directly because the dev mongod is a standalone and
`createFromQuote` runs in a transaction:

- Customer list and detail render a part-paid deposit correctly: whole-job lines, "This
  deposit £5,400.00", "Paid −£2,000.00", "Outstanding £3,400.00", and **Overdue** derived
  from a due date 16 days past while the stored status is still `partially_paid`.
- Staff queue lists it oldest-first with the outstanding figure over the total.
- `/api/payment-evidence/[paymentId]`: 401 anonymous → 403 customer → 403 staff without
  `payment.view_all` → 307 to a 5-minute presigned GET for finance, with an audit row written
  before the redirect.
- The org-role guard refuses a `technical` contact with a real **403**.

  This was a **200** when the ticket was first written — `loading.tsx` flushed the shell before
  the guard resolved, so every `forbidden()` and `notFound()` in the app rendered the right body
  under a success status. Fixed since: the three segment-level `loading.tsx` files are gone,
  guards moved into the page components, and `loading-boundaries.test.ts` enforces the rule.
  See the Rendering section of AGENTS.md.
