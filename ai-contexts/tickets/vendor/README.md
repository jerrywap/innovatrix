# Innovatrix Vendor Tickets

Third-party vendors: developers who onboard, list products, and take a share of
the revenue. `00-intro.md` is the brief. Read `../README.md` for the main ticket
set these build on, and `../../00-techinical.md` for product context.

## The spec does not mention vendors

Not once. `00-techinical.md` has no occurrence of vendor, third party, seller,
partner, supplier, payout, commission, revenue share or storefront in any of
those senses, and §107's vision is "one coherent operating system through which
**Innovatrix** sells software". §41 describes *an administrator* building the
catalogue; §61–63 are money-**in** only.

The platform is therefore single-vendor **by construction, not by omission** —
`Product` has no owner field, `PRODUCT_TRANSITIONS` has no approval edge, and
`json-ld.tsx` asserts Innovatrix as the seller of every product. These tickets
add a second party to a system that was designed with one.

Because there is no authoritative § to cite, each `**Spec:**` line names the
sections the ticket **displaces or extends**, with a gloss saying so. That is a
deviation from the main set's convention and is stated rather than hidden.

## Reading these alongside the main set

Numbering restarts inside this directory, so "ticket 03" is ambiguous. The
convention:

- **"vendor ticket 05"** — a sibling in this directory.
- **"ticket 06"** — the main set, `../06-admin-product-management.md`.

| # | Ticket | Depends on | Size |
|---|--------|-----------|:----:|
| 01 | [Vendor identity & onboarding](01-vendor-identity-and-onboarding.md) | tickets 03, 20 | L |
| 02 | [Vendor verification & trust](02-vendor-verification-and-trust.md) | vendor 01; ticket 05 | M |
| 03 | [Vendor team & access](03-vendor-team-and-access.md) | vendor 01 | S |
| 04 | [Product ownership & vendor authoring](04-product-ownership-and-authoring.md) | vendor 01, 03; ticket 06 | L |
| 05 | [Submission & review](05-submission-and-review.md) | vendor 04; ticket 20 | L |
| 06 | [Delivery methods](06-delivery-methods.md) | vendor 04, 05; tickets 07, 14 | L |
| 07 | [Commercial terms & commission](07-commercial-terms-and-commission.md) | vendor 01 | M |
| 08 | [Earnings ledger](08-earnings-ledger.md) | vendor 07; tickets 11, 13 | L |
| 09 | [Payouts](09-payouts.md) | vendor 02, 08; tickets 12, 25 | L |
| 10 | [Ratings & reviews](10-ratings-and-reviews.md) | vendor 04; tickets 09, 14 | L |
| 11 | [Vendor storefront](11-vendor-storefront.md) | vendor 04, 10; tickets 08, 27 | M |
| 12 | [Vendor analytics & lifecycle](12-vendor-analytics-and-lifecycle.md) | vendor 08, 09, 10 | M |
| 13 | [Vendor support & disputes](13-vendor-support-and-disputes.md) | vendor 04, 12; tickets 13, 21 | M |

Demoable milestones: **03** (a developer can apply, be verified, and sign in) →
**06** (a vendor's product is on sale and downloadable) → **09** (the vendor is
paid what they are owed) → **11** (the marketplace reads as a marketplace rather
than a catalogue).

---

## The 2026-08 simplification pass

The first draft of this set answered `00-intro.md`'s "think all features of a
modern vendor 3rd party distribution system" and was correspondingly large. It was
reviewed against a narrower intent — *signed-up users sell scripts here, a team is
optional, and nobody should be confused* — and simplified. **No feature was
removed:** verification still gates selling, payouts still pay, ratings, disputes
and storefronts all stand. What changed is the amount of structure behind them.

| Change | Ticket | Why |
|---|---|---|
| **Two vendor roles** — `owner`, `member` — not four | 03 | Only one separation is load-bearing: who may change the payout account. The other three multiplied the (role × action) cases for a principal that is usually one person. Size M → S |
| **One vendor per user**, enforced by index | 01, 03 | No vendor switcher. The customer shell already carries an `OrgSwitcher`; a second one makes every screen answer "as whom am I acting" first |
| **`/dashboard/selling`, not a fourth `/vendor` shell** | 01, and paths throughout | Every vendor is a signed-up user, so they already have that shell. A vendor is still a third *principal* — `requireVendor()` is unchanged — but a new principal does not require a new portal. Reversible with a redirect |
| **Applying is authenticated** | 01 | The applicant already has a verified email and a user id to hang the owner membership off. A public `/sell` page in front of it is content, not a form |
| **Owner membership created with the vendor**, in one transaction | 01, 03 | A solo vendor is a vendor with one member, so no code downstream branches on "has a team" — and onboarding never mentions one |
| **Commission resolves in two levels**, not three | 07 | A per-product rate is the level with the least demand and the most explaining. `resolveCommission()` still takes a third if V1 asks for one |
| **Archive delivery ships first**, mirror and pull second | 06 | Archive already works. The other two share an SSRF-hardened fetcher and a retrying job that should not be built under "no vendor can list anything yet" pressure. All three stay in scope |
| **Disputes are raisable by either party**, explicitly | 13 | Was implicit in the escalation rules. Named because it is a stated requirement: a customer *or* a vendor raises it, and raising it is what pulls staff in |

---

## Decisions still needed from the business

The main set's twelve decisions all still apply; several change meaning once
there is a second party, and are re-opened here. None blocks vendor tickets
01–03.

| # | Question | Bites at | Default if unanswered |
|---|----------|----------|----------------------|
| V1 | Default **commission rate**, and whether it varies by product type | vendor 07 | 30% platform / 70% vendor, overridable per vendor |
| V2 | **Clearance period** before an earning becomes payable | vendor 08 | 30 days from payment — must exceed the refund window (main decision #5) |
| V3 | **Minimum payout threshold** and cadence | vendor 09 | £50, monthly on the 1st |
| V4 | Whose name is on the **customer's invoice** — platform or vendor? | vendor 07, 08 | The platform. It is merchant of record; the vendor's document is a self-billed statement |
| V5 | Vendor **tax treatment** — self-billing, VAT status, withholding for non-UK vendors | vendor 09 | Self-billed statement, vendor responsible for their own tax, no withholding |
| V6 | **Exclusivity** — may a vendor sell the same product elsewhere? | vendor 07 | Non-exclusive |
| V7 | Review moderation **before or after** publication | vendor 10 | After, with reporting and takedown |
| V8 | What happens to a customer's **entitlement when a vendor is offboarded** | vendor 12 | Entitlements are permanent; downloads keep working because the platform holds the artefact |
| V9 | Does the **vendor set the price**, or propose one for approval? | vendor 04, 05 | Vendor sets it; the review gate covers it |
| V10 | Does the vendor set **licence terms**, or take the platform's? | vendor 04 | Platform's defaults (main decision #4); no per-vendor licence text at launch |
| V11 | Is vendor onboarding **open or invite-only** at launch? | vendor 01 | Invite-only, with an application form behind it |

## What these tickets deliberately leave out

Named here rather than discovered later. Each is discussed in the ticket it
would have belonged to.

- **Forge collaborator provisioning** — inviting a customer to a GitHub or
  GitLab repository on purchase. Vendor ticket 06 pulls a release tarball
  instead, so every delivery method ends at the same download path.
- **Automated payout transfers.** Vendor ticket 09 defines a `PayoutProvider`
  interface and ships one `manual` driver.
- **A vendor-facing API or webhooks.** Nothing in the brief needs one.
- **Vendor-run promotions and discount codes.** Discounts stay platform-owned
  (ticket 06) because a vendor-funded discount changes the commission
  arithmetic, which is vendor ticket 07's decision to reopen, not to pre-empt.
- **Multi-currency payouts.** Earnings accrue in the order's currency because
  `money.ts` refuses cross-currency arithmetic; converting at payout is an FX
  decision nobody has taken.
