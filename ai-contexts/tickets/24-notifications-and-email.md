# 24 — Notifications & Transactional Email

**Bucket:** §15 · **Depends on:** 19, 25 · **Blocks:** — · **Size:** M
**Spec:** §69 (notifications), §92 (events), §102 (attention)

## Why
§69 requires centralised notifications with in-app and email as the initial channels. Every "needs your
attention" item in §102 and every staff queue transition depends on the customer or staff member actually
finding out. Build it once, driven by the ticket-19 event bus, rather than sprinkling `sendEmail` calls
through services.

## Scope

### Architecture
```
domain event → NotificationService.dispatch(event)
                 → resolve recipients (role/ownership/preferences)
                 → write in-app notification
                 → enqueue email job (ticket 25)
```
Services **never** send email directly. Adding a channel later touches one module.

### In-app (§69)
- `notifications` collection (ticket 02), `/dashboard/notifications` and `/staff/notifications`.
- Bell with unread count in every authenticated shell; mark-read, mark-all-read; filter All / Unread.
- Each notification links straight to the record it concerns.
- Retention: archive read notifications after 90 days.

### Email
- **React Email** for templates + **Resend** (or SES) for delivery. Templates live in `src/emails/`.
- Every email: plain-text alternative, unsubscribe where legally applicable (transactional email is exempt but
  preference-driven notifications are not), correct `From`/`Reply-To`, and a deep link back into the app.
- Delivery is a background job with retries; failures are logged and visible in the ticket-25 admin monitor.
- Dev mode writes emails to disk / a preview route instead of sending.

### Event → notification map (§69)
| Event | Customer | Staff |
|---|---|---|
| `RequestSubmitted` / `CustomizationSubmitted` | confirmation + reference | new item in queue |
| `RequestAssigned` | — | assignee |
| `CustomerActionRequested` | **action required** | — |
| new message (ticket 21) | counterpart | counterpart |
| `QuoteIssued` | **quote ready to review** | — |
| `QuoteAccepted` / `QuoteRejected` | receipt | issuer + assignee |
| `InvoiceIssued` / invoice due / overdue | **payment required** | finance on overdue |
| `PaymentReceived` | receipt | assignee |
| `OrderCompleted` / `LicenceIssued` | **your software is ready** | — |
| `ProductVersionReleased` | entitled owners: update available | — |
| follow-up due / overdue | — | owner |

### Preferences
Per-user, per-category (requests · quotes · billing · products · messages), per-channel. Transactional
essentials (payment receipts, licence delivery, security) are **not** opt-outable — mark them clearly in the UI.

### Future channels (§69)
Define the `NotificationChannel` interface and register `inApp` and `email`. Leave SMS/push/WhatsApp
unimplemented — the interface is the deliverable, not a stub that pretends to send.

## Acceptance criteria
- [ ] Every event in the table above produces the listed notifications, verified by an integration test per row.
- [x] A user receives exactly one in-app notification and one email per event — no duplicates on retry.
- [x] Email failure does not roll back or block the domain transaction.
- [x] Unread counts are correct across devices and update on read.
- [x] Opting out of a category stops those emails but never suppresses payment receipts or licence delivery.
- [ ] Every email renders correctly in Gmail, Outlook and Apple Mail, and has a working plain-text part.
- [x] Links deep-link to the specific record and survive login redirection.
- [x] No email contains internal staff notes or another customer's data.
- [x] In dev, no email is sent to a real address.

## What shipped, and what did not

**The architecture is the deliverable.** `catalog.ts` holds §69's table *as data* — audience,
category, title, href, essential — so the mapping can be read beside the spec and iterated by a
test. `recipients.ts` resolves an audience to people by querying memberships, entitlements and
staff permissions; nothing accepts a recipient list from a payload. `notification-service.ts`
writes the in-app row, then hands it to each enabled channel. `channels.ts` is the interface
§69 asks for, with `in_app` and `email` registered and **nothing else** — SMS and WhatsApp are
absent rather than stubbed, because a stub makes a preferences screen offer something that
silently does nothing.

**Rows covered** (13 integration tests): `RequestSubmitted`, `CustomizationSubmitted`,
`RequestAssigned`, `CustomerActionRequested`, `QuoteIssued`, `QuoteAccepted`, `QuoteRejected`,
`InvoiceIssued`, `InvoicePaid`, `WorkReadyToStart`, `MessagePosted`, `ProductVersionReleased`.

**Three events had to be added to the bus** to make their rows real: `InvoiceIssued` (emitted
by `createFromQuote`/`raiseBalance`, guarded so the idempotent path does not re-announce),
`MessagePosted` (emitted by `postMessage`, carrying the **audience** and no body — §37) and
`ProductVersionReleased` (emitted by `releaseVersion`, fanning out to active entitlements).

**Not shipped, deliberately.**

- **`OrderCompleted` / `LicenceIssued` have no notification.** Marketplace fulfilment does not
  emit on the bus at all, and adding a bus event inside `processPaymentSucceeded`'s transaction
  is the one place §92 says not to. It needs the emit moved after the commit — a change to
  ticket 13's code, not this one's, and worth doing deliberately.
- **Invoice due / overdue reminders and follow-up-due notices** are ticket 25's sweep. Nothing
  here polls a date.
- **Retries are not implemented.** A failed send leaves `emailSentAt` unset, which is the query
  ticket 25's retry will run. That is the seam, and it is honest about being one.
- **Delivery is inline, not queued.** Ticket 24 depends on 25 and 25 does not exist. Dispatch
  runs in the request that emitted the event, after the transaction, isolated per recipient.
  Ten staff members means ten sends on one request — fine at this scale, and the wrong shape at
  ten thousand.
- **No React Email.** One template — a heading, a sentence and a button — did not justify a
  dependency and a render step. The reasoning is written at the top of `src/emails/notification.ts`,
  and that file is the seam where the trade flips.
- **Gmail/Outlook/Apple Mail rendering is unverified.** The template avoids everything that
  breaks in Word's rendering engine (no floats, no flex, no external CSS, inline styles, a
  single column), but nobody has opened it in Outlook. Criterion left unticked.
- **The first criterion is unticked** because two of §69's rows have no event to hang off yet
  (above), so "every event in the table" is not literally true.

## Live verification (2026-08-16)

`scripts/notify-probe.ts` against the dev database:

- `InvoiceIssued` → **1** recipient: the owner. The technical contact got nothing (§89 — billing
  notices go to billing roles).
- `WorkReadyToStart` → **3** recipients: exactly the staff holding `request.view_all`
  (super_admin, customer_service, technical_analyst). Marketing and finance were not told, which
  is the permission query doing its job rather than a role list somebody maintained.
- Re-firing `InvoiceIssued` → **0 written, 1 skipped**. The unique index on
  `(recipientUserId, dedupeKey)` is what makes a retry a no-op.
- Emails written to `.dev-emails/` with absolute links; `emailSentAt` stamped on every row.
- The customer bell reads "Notifications, 1 unread" and the staff bell the same for the three
  who were told; `/dashboard/account` renders the five toggles with billing and security shown,
  locked and explained.

The probe found one real bug: the subject prefix read "Your request: …" on a staff queue
notice. Categories are now audience-neutral.

## One thing to know about the isolation

`dispatch` swallows per-recipient failures on purpose — a notification must not undo the thing
it is about. The cost showed up as an intermittent test failure under load: a slow query inside
a handler became "no email sent" with no exception anywhere, and the assertion that failed was
three lines away from the cause. `DispatchResult` now carries `failed`, so a degraded dispatch
is visible to its caller and nameable by a test. The swallowing is unchanged; only the silence
is.
