# 15 — Customer Dashboard & My Software

**Bucket:** §9.1–9.4, 9.8 · **Depends on:** 14 · **Blocks:** — · **Size:** M
**Spec:** §27 (dashboard), §28 (navigation), §29 (My Software), §102 (action-oriented), §105 (lifecycle)

## Why
§27 says the dashboard must answer two questions immediately: *what is happening* and *what needs my attention*.
§102 adds: prioritise actions, not decorative statistics. §29 makes My Software the long-term relationship
between a customer and what they bought — the anchor for every future upsell in §105.

## Scope

### `/dashboard` (§27)
- **Needs Your Attention** first and visually dominant — only genuine actions, each a link straight to the thing:
  quotes awaiting approval, unpaid invoices, requests waiting on customer input, unread staff messages,
  product updates available. When there is nothing, say so plainly rather than showing empty cards.
- **At a glance** counts: Open Requests · My Software · Orders · Quotes · Invoices.
  (Active Projects, Support Tickets and Upcoming Renewals from §27 are post-MVP — omit, don't stub.)
- **Recent activity** — the last 10 `activityEvents` for the organization (ticket 19), plain language.
- New customers with no purchases get a genuine onboarding state: browse the marketplace, or start a custom
  build — the two §107 doors.

### `/dashboard/software` (§29)
Grid/list of entitlements:
- Product name, thumbnail, purchased version, current version, licence status, support-until, updates-until.
- **Update available** badge when a newer version is within the update window.
- Per-item actions (§29): Download · View Licence · View Changelog · Documentation · Open Demo ·
  Request Installation · **Request Customization** · Request Support.
  *Request Customization* starts the ticket-17 assistant pre-loaded with this product **and the version the
  customer actually owns** (§101 — context must flow). *Request Support* opens a request/conversation.
  *Request Installation* adds the installation add-on to the cart.

### `/dashboard/software/[entitlementId]`
Detail: all downloadable artefacts for the entitled versions with checksums, version history with changelog,
licence panel (ticket 14), support/update windows explained in plain language, and the history of customization
requests made against this product.

### Orders & organization
- `/dashboard/orders` and `/dashboard/orders/[reference]` (from ticket 11).
- `/dashboard/organization` — details, billing address, tax id, members with roles, invite/revoke (ticket 03).
- `/dashboard/account` — profile, email, password, notification preferences (ticket 24).

## Acceptance criteria
- [ ] A customer with two pending quotes and one unpaid invoice sees exactly three attention items, each linking
      to the right record.
- [ ] A customer with nothing outstanding sees a calm, honest empty state — not fabricated urgency.
- [ ] My Software shows only entitlements for the **active organization**; switching orgs changes the list.
- [ ] "Update available" appears only when the newer version is genuinely within the update window.
- [ ] Request Customization from My Software arrives at the AI assistant with product **and owned version**
      already in context (verified in the created conversation record).
- [ ] Dashboard first paint under 1.5s with 50 entitlements — counts come from indexed aggregations, not
      loading every document.
- [ ] No post-MVP module appears as a dead link.
- [ ] Every count on the dashboard reconciles with its underlying list page.
