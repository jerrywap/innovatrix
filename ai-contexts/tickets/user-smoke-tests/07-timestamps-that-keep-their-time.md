# S07 — Timestamps that keep their time

**Source:** ticket 30, line 20 · **Severity:** minor
**Depends on:** — · **Blocks:** — · **Size:** S
**Spec:** §70 (activity timeline), §90 (audit trail)

## Why

> Under "what happened" it shows only date no time (in fact most of the places in the user
> dashboard it shows only date not time)

The tester is right about the scope — it is most places — and the cause is not that anyone
chose date-only. It is that a four-line helper was copy-pasted into six modules, and it
truncates.

§70's example timeline is explicitly `14 Aug 10:31 / 14 Aug 11:15 / 14 Aug 13:42` — three
events on one day. Rendered as days, they collapse into three identical labels in an
arbitrary order. An audit trail that cannot order its own entries is not one (§90).

## Root cause

### The right formatter exists and is used by nothing

`src/components/timeline.tsx:93-102`:

```ts
function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }).format(date);
}
```

Absolute, fixed-locale, hydration-stable, wrapped in a `<time dateTime={ISO}>` (`:76`), with
a docblock (`:86-92`) explaining exactly the AGENTS.md rule it implements. It is the only
`Intl.DateTimeFormat` in the codebase.

**And `src/components/timeline.tsx` is imported by zero files.** No `<Timeline` appears
anywhere. Ticket 04 shipped it as a shared primitive; both request pages then hand-rolled a
`<ul>` instead.

### What is actually used: `isoDay`, which throws the time away

```ts
function isoDay(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
```

Duplicated privately in **six** modules — `src/features/requests/request-view.ts:318`,
`invoices/invoice-view.ts:344`, `quotes/quote-view.ts:236`, `dashboard/overview.ts:230`,
`staff/customer-360.ts:192`, `versions/view.ts:122` — plus inline uses in
`staff/queues.ts:247`, `staff/follow-ups.ts:93`, `notifications/notification-view.ts:66`,
`payments/orders-view.ts:66,148,149,164`, `services/invoices/invoice-service.ts:181`,
`services/marketplace/detail.ts:382`, `services/entitlements/entitlement-service.ts:364`,
and two components. **~19 non-test call sites.**

The reported one is `request-view.ts:293` — `at: isoDay(event.createdAt)` — rendered raw at
`src/app/dashboard/requests/[reference]/page.tsx:142` and mirrored for staff at
`src/app/staff/requests/[reference]/page.tsx:233`. "Most places in the user dashboard" is
`features/dashboard/overview.ts` (`:152`, `:172-173`, `:225`), the recent-activity feed.

Two stragglers use `toLocaleDateString("en-GB")` — `admin/discounts/page.tsx:93`,
`dashboard/software/[entitlementId]/licence/page.tsx:120`, `versions/view.ts:113` — date-only
too, and the browser-rendered one is locale-dependent, so it can disagree between server and
client.

### The shape problem

`isoDay` is applied in the **view/service layer**, so a preformatted `string` reaches the
component. By the time anything could render a time, the time is gone. This is why the fix
is not "change the component".

## Scope

### Add `src/lib/dates.ts`

The move `money.ts` + `<MoneyDisplay>` already made for currency: one module owning the
rules, so a call site cannot get it subtly wrong.

- `formatDay(date)` — `14 Aug 2026`, for things that genuinely are days.
- `formatDateTime(date)` — `14 Aug 2026, 10:31`, for moments.
- Absolute only. No relative time — it differs between server and client and flickers at
  hydration (AGENTS.md).
- Fixed locale and an explicit `timeZone`, matching `formatWhen`.
- Unit tests beside it, as `money.ts` has.

Note the timezone decision this forces into the open: `isoDay` and `formatWhen` both work in
UTC, so a customer in Lagos sees UTC timestamps. Fine for now, but say so in the module
rather than leaving it implicit, and keep the `<time dateTime={ISO}>` wrapper so the machine
reading is unambiguous whatever we display.

### Classify every call site

The point of the ticket. Each of the ~19 is one or the other:

**Days — keep as days.** `dueAt` and `expiresAt` on invoices and quotes, licence expiry,
support-until, release dates. A due date is a date; rendering `2026-09-01, 00:00` implies a
precision that does not exist and a deadline that is wrong by a day.

**Moments — must keep their time.** `timeline[].at`, `submittedAt`, `paidAt`, `uploadedAt`,
`checkedAt`, notification and activity timestamps, download log entries, audit rows.

When in doubt: if two of them could happen in the same day and the order matters, it is a
moment.

### Adopt the orphaned `Timeline`

Replace the hand-rolled `<ul>`s at `dashboard/requests/[reference]/page.tsx:133-146` and
`staff/requests/[reference]/page.tsx:225-240` with `src/components/timeline.tsx`. It already
renders hour and minute and already emits `<time>`; this is deleting code, not writing it.

That requires `RequestTimelineEntry.at` (`request-view.ts:34`) to carry a `Date` or an ISO
string rather than a pre-truncated day — the shape change that makes all of this possible.

### Finish the job

Replace the `toLocaleDateString("en-GB")` stragglers too, so there is exactly one way to
render a date. Consider a lint rule banning `toISOString().slice(0, 10)` and bare
`toLocaleDateString` outside `lib/dates.ts` — this pattern spread by copy-paste and will do
so again.

## Acceptance criteria

- [ ] `src/lib/dates.ts` exists with both formatters and tests; no private `isoDay` remains.
- [ ] The request timeline shows date **and** time on both the customer and staff pages.
- [ ] Three events on one day render in an order the reader can verify.
- [ ] Due dates and expiry dates are still days.
- [ ] Both request pages use `src/components/timeline.tsx`; the file is no longer orphaned.
- [ ] Every rendered timestamp is wrapped in `<time dateTime>`.
- [ ] No hydration mismatch on any dashboard page.

## Notes

Ticket 04 shipped `Timeline` and AGENTS.md documented the rule; the rule was then followed
in the component nobody imported and broken in the helper everybody copied. The lesson is
the enforcement, not the formatter: `theme-tokens.test.ts` and `loading-boundaries.test.ts`
both exist because a convention that is only written down does not hold.
