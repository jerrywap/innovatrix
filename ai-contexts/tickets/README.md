# Innovatrix MVP Tickets

Read `../00-techinical.md` for product context and `../01-mvp-todo.md` for the bucket list, ordering and
architectural rules. Every ticket maps back to a section of that todo.

**`## Live verification` is a ticket artefact.** Six tickets (23–28) carry one and it is always
the same thing: a probe driven against the real dev database, printing what actually happened —
the evidence a suite cannot give. It is not a place to paste test counts, and a change smaller
than a ticket does not get one. What "done" means for those is `## Testing` in `AGENTS.md`.

| # | Ticket | Depends on | Size |
|---|--------|-----------|:----:|
| 00 | [Project foundation & conventions](00-project-foundation.md) | — | M |
| 01 | [MongoDB connection & data-layer conventions](01-mongodb-connection-and-conventions.md) | 00 | M |
| 02 | [Domain model & collections](02-domain-model-and-collections.md) | 01 | L |
| 03 | [Authentication, organizations & permissions](03-auth-organizations-permissions.md) | 02 | L |
| 04 | [Application shells & design system](04-app-shells-and-design-system.md) | 03 | M |
| 05 | [Object storage & file service](05-object-storage-and-file-service.md) | 03 | M |
| 06 | [Admin product management](06-admin-product-management.md) | 02, 04, 05 | L |
| 07 | [Product versions, files & demos](07-product-versions-files-and-demos.md) | 05, 06 | M |
| 08 | [Marketplace browse & search](08-marketplace-browse-and-search.md) | 06 | L |
| 09 | [Product detail page](09-product-detail-page.md) | 07, 08 | M |
| 10 | [Shopping cart](10-cart.md) | 09 | M |
| 11 | [Checkout & orders](11-checkout-and-orders.md) | 10 | L |
| 12 | [Payment providers (Paystack · Stripe · PayPal)](12-payment-providers.md) | 11 | L |
| 13 | [Payment webhooks & fulfilment](13-payment-webhooks-and-fulfilment.md) | 12 | L |
| 14 | [Entitlements, licences & downloads](14-entitlements-licences-downloads.md) | 07, 13 | L |
| 15 | [Customer dashboard & My Software](15-customer-dashboard-and-my-software.md) | 14 | M |
| 16 | [AI foundation & conversation engine](16-ai-foundation-and-conversation-engine.md) | 03 | L |
| 17 | [AI customization assistant](17-ai-customization-assistant.md) | 09, 16 | M |
| 18 | [AI custom-build assistant](18-ai-custom-build-assistant.md) | 16, 08 | M |
| 19 | [Requests, state machines & activity](19-requests-state-machines-and-activity.md) | 17, 18 | M |
| 20 | [Staff portal, queues & Customer 360](20-staff-portal-queues-and-customer-360.md) | 19 | L |
| 21 | [Conversations & messaging](21-conversations-and-messaging.md) | 19, 20 | M |
| 22 | [Quotes & estimates](22-quotes.md) | 20 | L |
| 23 | [Invoices & payment collection](23-invoices-and-payment-collection.md) | 13, 22 | M |
| 24 | [Notifications & transactional email](24-notifications-and-email.md) | 19, 25 | M |
| 25 | [Background jobs & scheduling](25-background-jobs-and-scheduling.md) | 01 | M |
| 26 | [Security hardening & audit trail](26-security-hardening-and-audit.md) | all | L |
| 27 | [SEO, performance & observability](27-seo-performance-and-observability.md) | 08, 09 | M |
| 28 | [Testing strategy & CI/CD](28-testing-and-ci-cd.md) | 00, then all | L |

Demoable milestones: **09** (a real product, publicly evaluable) → **15** (money in, software delivered) →
**19** (both AI doors produce tracked requests) → **23** (the revenue loop closes on custom work).

Two more sit outside that table because they are not implementation tickets:
**29** [Human test checklist](29-human-checklist.md) — the coverage plan for what a test cannot assert — and
**30** [User testing results v1](30-user-testing-results-v1.md), the raw notes from the first run against it.

## Ticket sets

| Set | What it covers |
|---|---|
| `NN-*.md` (this directory) | The MVP, tickets 00–28, plus the checklist and its results |
| [`user-smoke-tests/`](user-smoke-tests/README.md) | Ten follow-ups triaged from ticket 30 — four of them close a journey that currently cannot be completed |
| [`vendor/`](vendor/README.md) | Third-party vendors. Post-MVP, and outside the spec |

Both sub-directories restart their numbering, so cite them as "smoke ticket 05" and
"vendor ticket 05"; a bare "ticket 05" always means this directory.

---

## Decisions still needed from the business

These are the §106.31 "architectural decisions requiring stakeholder input". None block ticket 00–05; each is
flagged in the ticket where it first bites.

| # | Question | Bites at | Default if unanswered |
|---|----------|----------|----------------------|
| 1 | Which **currencies** does the storefront sell in at launch? | 06, 10, 12 | GBP + NGN + USD |
| 2 | Is pricing **set per currency by hand**, or is one base currency converted? | 06 | Per currency, set by hand (no FX surprises) |
| 3 | **Tax/VAT** treatment for digital goods and services, per customer country | 10, 11 | Flat rule by billing country; needs accountant sign-off before launch |
| 4 | Default **licence terms**: support months, update months, activation limits per licence type | 06, 14 | 12 months support, 12 months updates, 1 activation for single-project |
| 5 | **Refund policy** — window, who approves, does it revoke the licence? | 13, 14 | 14 days, staff-approved, entitlement suspended |
| 6 | **Deposit percentage** for quoted work, and whether balance is due on delivery | 22, 23 | 50% deposit, balance on delivery |
| 7 | **Quote expiry** default | 22 | 30 days |
| 8 | Do customers **self-serve organizations**, or does Innovatrix create them? | 03 | Self-serve, personal org auto-created at signup |
| 9 | **AI spend cap** per conversation / per customer / per month | 16 | Per-user hourly turn cap + monthly org budget alert |
| 10 | **Hosting target** (Vercel vs container host) — decides the job-runner choice | 25, 28 | Container host with a long-lived worker |
| 11 | **Support SLA** language shown to customers on requests and quotes | 19, 22 | "We respond within 1 business day" |
| 12 | Legal: **licence agreement** and **terms of service** text | 09, 11 | Blocks launch, not development |
