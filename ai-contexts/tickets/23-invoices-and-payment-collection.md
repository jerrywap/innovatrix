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
- [ ] Accepting a quote with 50% deposit terms creates one deposit invoice for exactly half the total.
- [ ] Paying an invoice through each of the three providers marks it paid **only** after webhook verification.
- [ ] Two partial payments totalling the invoice amount produce `paid`, not `partially_paid`.
- [ ] Overpayment is refused or flagged for review — never silently accepted.
- [ ] Full payment moves the source request to `converted` and emits `WorkReadyToStart`.
- [ ] Invoice line totals equal the accepted quote's, forever, even after the quote is superseded.
- [ ] An overdue invoice appears in the customer's "Needs Your Attention" and the staff overdue queue.
- [ ] Reminders stop immediately on payment.
- [ ] A customer from another organization cannot view or pay the invoice.
- [ ] Every payment, manual or automatic, is audited with actor and source.
