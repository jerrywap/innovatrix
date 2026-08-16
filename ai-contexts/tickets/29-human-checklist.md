# 29 — Human test checklist

**Depends on:** everything · **Blocks:** launch

## Why this exists

Ticket 28 was going to build Playwright and four §96 journeys. It does not.
The harness — a seeded database, a mock payment provider, a mock AI provider —
is most of that work, and what it would buy is a machine repeating a script
somebody already wrote. What it would *not* catch is the thing a person catches
in the first thirty seconds: that the flow is confusing, that the wording is
wrong, that the button is where nobody looks.

So this is the coverage plan for everything a test cannot assert, plus the
handful of checks that genuinely need a browser or a public URL.

**Automated coverage is real and is not repeated here.** 805 tests cover money,
state machines, entitlement rules, permissions, tenant isolation, the audit
log's append-only guarantee, the job queue's concurrency, and every service's
database boundary. Assume those work. This is about what they cannot see.

## How to use it

```bash
npm run db:up          # or your local mongod as a replica set
npm run db:seed        # idempotent — safe to re-run
npm run dev
```

Every account's password is **`innovatrix-demo-2026`**. The accounts are in
`README.md`.

Tick a row only if you did it. A row you skipped is information; a row you
ticked without doing is worse than an untested feature, because it stops anybody
else looking.

Record what you find at the bottom, not in your head.

---

## A. The four §96 journeys

These are the ones that cross money, entitlement or contract. Do them end to
end, in one sitting, without shortcuts.

### A1 — Marketplace, as-is (§99)

Sign in as **`amara@brightpath.test`** (customer owner).

- [ ] Browse `/marketplace`, filter by category and by industry
- [ ] Search for something that exists, and something that does not
- [ ] Open a product — is it obvious what you get, and what it costs?
- [ ] Open the demo. Atlas CRM shows credentials to anyone; Tenancy needs a
      sign-in; Roster needs ownership. Check all three behave differently
- [ ] Add to cart, change the quantity, apply `LAUNCH15`
- [ ] Try `SOLDOUT` (usage exhausted) and `EXPIRED10` — is the refusal clear?
- [ ] Switch the cart currency. Do the prices re-price, or just re-label?
- [ ] Check out, paying **by card**
- [ ] Watch the processing page. Does it resolve, or sit there?
- [ ] My Software shows the product; download the package
- [ ] The licence key is visible and copyable

### A2 — Customization → quote → invoice → paid (§99)

- [ ] From a product, start "Request customization"
- [ ] Hold a real conversation with the assistant. Does it ask useful
      questions, or does it interrogate?
- [ ] Reach the summary. Are *your* requirements distinguishable from the AI's
      assumptions? (§104 — this is the one to be strict about)
- [ ] Submit. The dashboard shows the request with a reference
- [ ] As **`analyst@innovatrix.test`**, find it in the queue and triage it
- [ ] As **`sales@innovatrix.test`**, draft and issue a quote
- [ ] As the customer, read the quote. Are the exclusions as prominent as the
      price? Accept it
- [ ] An invoice appears. Pay the deposit
- [ ] As **`finance@innovatrix.test`**, confirm the payment landed
- [ ] The request has moved to work-ready

### A3 — Custom build (§99)

- [ ] From `/custom-software`, **signed out**, start a conversation
- [ ] Describe a problem in plain language — no software vocabulary
- [ ] Do the suggestions make sense? Choose one
- [ ] Sign up mid-flow. **Is the conversation still there?**
- [ ] Submit; it appears on the dashboard
- [ ] As staff, reply. The customer sees the reply
- [ ] Reply as the customer. Staff see it

### A4 — The §37 boundary

The single most important row in this document. A leak here is a breach.

- [ ] As staff, add an **internal note** to a request
- [ ] As the customer, open the same request. **The note must not be there** —
      not hidden, not collapsed, not in the page source
- [ ] View source (Cmd-U) and search for the note's text. Nothing
- [ ] Check the customer's notification bell and inbox. Nothing about it
- [ ] Now add a **customer-visible** reply. It appears for both, and the
      customer is notified

---

## B. Offline payment (ticket 23, Part A)

- [ ] As a customer, check out choosing **pay by bank transfer**
- [ ] The confirmation page carries the bank details and says plainly that
      nothing is released until payment is recorded
- [ ] My Software shows **nothing** for that order
- [ ] As `finance@`, find the order in `/admin/orders` — unpaid transfers first
- [ ] Record the payment with a receipt attached
- [ ] The customer's My Software now has it, identical to a card purchase
- [ ] Record a **wrong amount** on another order → `requires_review`, nothing
      fulfilled, and the message explains why
- [ ] Download the evidence as `finance@` → works
- [ ] Try the evidence URL as the customer → 403
- [ ] Try it signed out → 401
- [ ] Upload a `.exe` renamed `receipt.pdf` → refused on magic bytes (ticket 26)

---

## C. Per-persona sweep

For each account: sign in, open every screen the nav offers, and confirm
nothing 404s, nothing 500s, and nothing shows a control that then refuses.

| Account | Role | Should reach | Must not reach |
|---|---|---|---|
| `super@innovatrix.test` | `super_admin` | everything | — |
| `service@innovatrix.test` | `customer_service` | customers, requests, messages | pricing, refunds, publishing |
| `analyst@innovatrix.test` | `technical_analyst` | triage, draft a quote | **issuing** a quote |
| `sales@innovatrix.test` | `sales` | Customer 360, full quote lifecycle | products, refunds |
| `dev@innovatrix.test` | `developer` | products, files, project milestones | pricing, customers |
| `pm@innovatrix.test` | `project_manager` | projects, assignment, order status | pricing, refunds |
| `support@innovatrix.test` | `support_agent` | read-only + internal notes | **the whole admin area** |
| `market@innovatrix.test` | `marketplace_manager` | products, taxonomy, discounts | payments, invoices |
| `finance@innovatrix.test` | `finance` | payments, invoices, tax | discounts, publishing |
| `devops@innovatrix.test` | `devops` | `/admin/jobs`, `/admin/audit`, settings | products, customers |
| `content@innovatrix.test` | `content_manager` | product content, taxonomy | pricing, publishing |

- [ ] All eleven swept
- [ ] No screen offers a control the role cannot use
- [ ] A refusal is a readable page, never a stack trace or a blank pane

Customer side, all in Brightpath Care:

| Account | Org role | Check |
|---|---|---|
| `amara@brightpath.test` | `owner` | everything, including billing |
| `kwame@brightpath.test` | `admin` | everything except ownership transfer |
| `bilal@brightpath.test` | `billing` | invoices and payments |
| `tobi@brightpath.test` | `technical` | software and downloads, **not** invoices |
| `nina@brightpath.test` | `member` | the least of anyone — this is the one that exposes a mis-scoped screen |

- [ ] All five swept

---

## D. Mobile

Real device if possible; DevTools device mode otherwise. 375px wide.

- [ ] Marketplace browse and filter
- [ ] Product page — does the price stay reachable while scrolling?
- [ ] **The whole checkout**, including the card form
- [ ] The AI conversation — does the keyboard cover the input?
- [ ] Dashboard and My Software
- [ ] Staff request workspace (staff do use phones)
- [ ] No horizontal scroll anywhere
- [ ] Nothing important sits under the thumb-unreachable top corner

---

## E. Accessibility

- [ ] Tab through checkout without touching the mouse. Complete a purchase
- [ ] Tab through the AI conversation and submit
- [ ] Every focused control has **one** visible focus ring
- [ ] Focus never disappears behind a sticky header
- [ ] A modal traps focus and returns it on close
- [ ] Every image has meaningful `alt` — or empty `alt` if decorative
- [ ] Every form error is announced, not only coloured
- [ ] VoiceOver / NVDA through checkout: is it *usable*, not merely labelled?
- [ ] Zoom to 200%. Nothing overlaps or is cut off
- [ ] **Both themes**, and check contrast on `--subtle` against the muted
      surface — 9.5px text needs 4.5:1 and that pairing is the hardest

---

## F. Ticket 27's SEO checks

These need a browser or a public URL, which is why they are here.

- [ ] Lighthouse on a product page: Performance ≥ 90, SEO 100, Accessibility ≥ 95
- [ ] Product JSON-LD through Google's Rich Results test
- [ ] `Organization` + `WebSite` through the same
- [ ] `BreadcrumbList` matches the visible breadcrumb exactly
- [ ] Share a product link into Slack/WhatsApp — does the card render?
- [ ] Share the home page — same
- [ ] The carried-over goal: `/marketplace/roster` should be findable for
      *"shift scheduling and timesheets for care agencies"*. Check the title,
      description and on-page copy actually say that
- [ ] Rename a product's slug; the old URL 308s to the new one
- [ ] `robots.txt` blocks `/dashboard`, `/staff`, `/admin`, `/api`
- [ ] No CSP violations in the console on any public page

---

## G. Email

Nothing here can be asserted from code — it is about how it *looks*.

- [ ] Trigger a verification email, a quote-issued and an invoice-issued
- [ ] Read them in `.dev-emails/`
- [ ] Send one to a real Gmail, Outlook and Apple Mail account
- [ ] Renders correctly in all three, including dark mode
- [ ] The plain-text part is readable on its own
- [ ] Every link works and is absolute
- [ ] The subject line reads correctly **for its audience** — a staff queue
      notice must not say "your request"
- [ ] Nothing internal appears in any of them (§37)

---

## H. Things that only break under use

- [ ] Two browsers, same order, both press "pay" → one order, one payment
- [ ] Refresh mid-AI-answer → the turn is still saved
- [ ] Back button after checkout → no duplicate order
- [ ] Two staff record a payment on the same order at once → one fulfilment
- [ ] Leave a cart for a day → still there, correctly priced
- [ ] Sign out in one tab while another is open → the second refuses cleanly

---

## Findings

Severity: **blocker** (money, data, or a §37 leak) · **major** (a journey
cannot be completed) · **minor** (wording, spacing, polish).

### Run 1 — 2026-08-16

Raw notes: [`30-user-testing-results-v1.md`](30-user-testing-results-v1.md).
Triaged into ten tickets: [`user-smoke-tests/`](user-smoke-tests/README.md).

Twenty-one findings. Four majors, each closing a journey:

| # | Where | What | Severity | Ticket |
|---|---|---|---|---|
| 1 | `/dashboard/orders/[reference]` | Route was never built — every order 404s | major | S06 |
| 2 | `/custom-software` signed out | Conversation is created with no owner, so its creator cannot read it | major | S03 |
| 3 | Checkout | Provider's own refusal text shown verbatim; routing asks what the provider supports, not the account | major | S05 |
| 4 | `/staff/requests/[ref]` | `converted` is terminal — no progress can be recorded after payment | major | S10 |
| 5 | Various | Seventeen further findings — content, config, formatting, navigation, analytics | minor | S01–02, S04, S07–09 |

Journeys A1, A3 and B could not be completed. A2 completed to payment and
stopped there. A4 (the §37 boundary) was not reached — **it remains untested,
and it is the row this document calls the most important one.**

Note for the next run: three findings turned out to describe something other
than what they appeared to (`/staff/dashboard` and `/admin/dashboard` do not
exist; the order 404 is a missing route rather than a bad lookup; `/concepts`
is an internal gallery, not a customer page). Recording the exact URL and what
you expected — as this run did — is what made those separable.
