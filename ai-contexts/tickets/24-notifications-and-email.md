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
- [ ] A user receives exactly one in-app notification and one email per event — no duplicates on retry.
- [ ] Email failure does not roll back or block the domain transaction.
- [ ] Unread counts are correct across devices and update on read.
- [ ] Opting out of a category stops those emails but never suppresses payment receipts or licence delivery.
- [ ] Every email renders correctly in Gmail, Outlook and Apple Mail, and has a working plain-text part.
- [ ] Links deep-link to the specific record and survive login redirection.
- [ ] No email contains internal staff notes or another customer's data.
- [ ] In dev, no email is sent to a real address.
