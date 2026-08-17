# 05 — Submission & Review

**Bucket:** §20.5 · **Depends on:** vendor 04; ticket 20 · **Blocks:** vendor 06, 11 · **Size:** L
**Spec:** §46 (product publishing lifecycle — extended with an external submitter), §47 (internal product testing), §91 (state machines), §92 (events), §90 (audit)

## Why
`PRODUCT_TRANSITIONS` today is `draft → internal_review → testing → ready →
published`, and every edge is taken by staff. There is no submission from an
outside party, no rejection, and **no field anywhere to hold a reason** — because
until now the person who wrote the product and the person who approved it worked
for the same company. A vendor marketplace without a review gate is a
distribution channel for whatever anybody uploads.

## Read first
`REQUEST_TRANSITION_RULES` in `src/lib/db/states.ts`. It is the only place in the
codebase where "who may take this edge" is **data rather than code** — each
transition carries `{ permission, customerMay, label }`. That pattern is what
this ticket copies, because a product review flow has the same property: two
different kinds of principal moving the same record through different edges.

## Scope

### New states and edges

```
draft ──submit──→ submitted ──approve──→ internal_review → testing → ready → published
  ↑                    │
  └──── changes_requested ←──request-changes──┘
```

`submitted` and `changes_requested` are new. The existing staff path from
`internal_review` onwards is untouched — a vendor product joins the pipeline the
platform already uses for its own, which is the point: the same testing
checklist and the same readiness gate apply to both.

`changes_requested` returns to the vendor. It is distinct from `draft` because
it carries a reason and a history, and because a vendor's list needs to
distinguish "not finished" from "sent back".

### Who may take which edge

A `PRODUCT_TRANSITION_RULES` map beside the existing request one:

| Edge | Who | Requires |
|---|---|---|
| `draft → submitted` | any active vendor member | readiness clean, attestation given |
| `submitted → draft` | vendor | withdraw, before review starts |
| `submitted → internal_review` | staff `product.review` | claiming it |
| `submitted → changes_requested` | staff `product.review` | a reason |
| `internal_review → changes_requested` | staff `product.review` | a reason |
| `changes_requested → submitted` | vendor | readiness clean |
| `ready → published` | staff `product.publish` | unchanged from ticket 06 |

Expressing this as data rather than branches is what lets one function enforce
it and one test iterate it.

**And it removed a real duplication.** The permission for a product transition was
computed from the target state by an ad-hoc ternary that existed in
`transitionProductAction` **and** in `bulkTransitionAction` — two copies of an
authorisation rule, which is one too many. Both now call
`productPermissionsForTarget()`, derived from the map. A `product.review` permission
is new and deliberately separate from `product.publish`: reading somebody else's
submission is review work, and putting a product on sale is a commercial call.

The staff permission stays in the action and the `vendorMay` / `requiresReason` half
moves to the service, because the exact rule is keyed by `(from, to)` and an action
does not know `from` without a read — while the guard must run before the work. The
service has the document, so it enforces the precise rule.

### A rejection carries a reason, structured

No field exists for this today. Rejections need to be answerable, so a reason is
a category plus prose plus optionally the step it concerns:

```ts
interface ProductReviewNote {
  at: Date;
  byUserId: Types.ObjectId;
  outcome: "changes_requested" | "approved" | "rejected";
  reasons: ReviewReasonCode[];   // quality | security | licensing | metadata | pricing | demo | duplicate | policy
  detail: string;                // shown to the vendor verbatim
  internalNote?: string;         // §37 — never reaches the vendor
}
```

Appended, never overwritten: the third submission of a product is only
comprehensible next to what was said about the first two.

`internalNote` follows §37's rule exactly as request messaging does. The
reviewer's private assessment must not reach the vendor, and the way that is
guaranteed is that the vendor-facing loader never selects the field — not that a
component hides it.

### Readiness is the gate on submission, unchanged

`computeReadiness()` is pure, already shared between the publish button and the
list column, and already returns the nine gaps that matter (`no_price`,
`no_package_file`, `testing_incomplete`, and the rest). It is the submission gate
too. A vendor sees the same checklist a staff member does, which is the cheapest
possible way to make "why can't I submit" answerable without a support thread.

### Attestation

Submitting requires an explicit statement that the vendor owns or is licensed to
distribute everything in the package, that it contains no third-party code they
cannot relicense, and that it contains no malware. Recorded with the version and
the user — it is the record that matters in a takedown (vendor ticket 13), and a
tick box with a timestamp is the difference between a claim and a defence.

### The review queue

`/staff/vendor-submissions`, ordered oldest-first — a vendor waiting on a review
has a product earning nothing, and the fairest order is the obvious one.

> **Corrected during implementation**, the same correction vendor ticket 01 needed:
> `QUEUES` is a registry of **`CustomerRequest`** queues, not a generic one.
> `staffCounts` counts that collection for every entry and `QueueRow` carries a
> `RequestStatus`. So this is a dedicated route modelled on `/staff/follow-ups`,
> with a `vendorSubmissions` field on `StaffCounts` so the number still reaches
> `/staff`.

The reviewer sees what changed since the last approved version, because a
resubmission is usually a small change and reviewing the whole product again is how
a queue falls behind.

> **Section-level, and derived.** A field-level diff needs a snapshot per submission,
> and a snapshot of a product carries every price *and every `passwordCipher`* —
> exactly what the audit log refuses to store, for that reason. So
> `sectionsChangedSinceApproval()` reads rows that already exist:
> `product.section_updated` records changed field *names* per save, never values. The
> answer is a list of section names, which is what a reviewer needs to know where to
> look. Recorded on the submission note and shown in the queue.

### Notifications

`ProductSubmitted` to reviewers (a *permission* audience, so a new staff role that
can review is not silently left out), `ProductChangesRequested` and `ProductApproved`
to the vendor through a new `{ kind: "vendor_member" }` audience — resolved by query
from a `vendorId` on the payload, never a list of user ids in the event.

`ProductPublished` now exists. It was in `DOMAIN_EVENTS` from ticket 02 and in no
other file — no map entry, no `emit`, no catalogue row — so "tell the vendor their
product is live" had nothing to attach to.

**The two drifted lists now have a test.** `events.test.ts` compares `DomainEventMap`
against `DOMAIN_EVENTS` in both directions, which found ten disagreements including
four this ticket set had itself introduced (vendor ticket 01's events were named in
the enum and never wired up). Six live-but-undescribed events were added to the enum;
three declared-but-unemittable ones are ticket 13's and are allowlisted with the
reason, in the `ANONYMOUS_BY_DESIGN` idiom — plus a second test that fails when an
allowlist entry goes stale.

`ProductApproved`'s wording is careful: approved is **not** on sale. Telling a vendor
"it's live" and then having it sit in testing for a week is how they stop believing
us.

## Out of scope
Automated code scanning. Vendor ticket 06 covers artefact-level checks at
upload; a static analysis pass over a vendor's source is a different discipline
and is not pretended at here.

## Acceptance criteria
- [x] A vendor submits, and cannot submit again while a submission is open.
- [x] Submission is refused while `computeReadiness()` reports any gap, and the vendor sees the same gaps a staff member does.
- [x] Submission is refused without the attestation, and the attestation is stored against the version and the user.
- [x] A vendor cannot move a product past `submitted`; the publish edge is refused in the action, not just absent from the screen.
- [x] A staff member without `product.review` cannot claim or decide a submission.
- [x] Requesting changes without a reason is refused.
- [x] Review notes accumulate; a third submission shows what was said about the first two.
- [x] An internal note never reaches the vendor — not in the page, not in the payload, not in a notification.
- [~] A resubmission shows the reviewer what changed since the last approved version — **section-level**, derived from audit rows rather than a stored diff. See above.
- [x] Every transition writes an audit row naming the actor and the reason where there is one.
- [x] `PRODUCT_TRANSITION_RULES` is data, and a test iterates every edge asserting who may take it.
- [x] Publishing emits `ProductPublished`, and the vendor is told their product is live.
