# 10 — Ratings & Reviews

**Bucket:** §20.10 · **Depends on:** vendor 04; tickets 09, 14 · **Blocks:** vendor 11, 12 · **Size:** L
**Spec:** §6 (marketplace experience — "ratings/reviews if introduced"), §8 (product detail), §64 (my software — where a review is prompted), §93 (SEO — structured data), §88 (input validation), §37 (visibility)

## Why
§6 lists "Ratings/reviews **if introduced**" and `01-mvp-todo.md` puts them on
the deferred post-MVP list. The brief asks for a rating system, so this ticket
**un-defers a listed item** — worth saying out loud, because the deferral was a
decision rather than an oversight. It also matters more with vendors than
without: when the platform is the only seller, a rating is feedback; when a
customer is choosing between third-party products, it is the primary signal.

## Scope

### Only somebody who bought it

A review requires an active entitlement for the product. Not a sign-in, not an
email — the entitlement, which the platform already issues on fulfilment and
already scopes by organisation.

This is the single decision that makes the rest workable. Purchase-gating
removes review spam, competitor attacks and paid-review farms as a class of
problem rather than as something moderation has to catch. The cost is fewer
reviews, and that is the right trade for a marketplace where a rating decides a
purchase.

One review per entitlement, editable by its author, with the edit visible.

### Shape

```ts
interface ReviewDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  vendorId?: Types.ObjectId;        // denormalised for the vendor aggregate
  organizationId: Types.ObjectId;
  authorUserId: Types.ObjectId;
  entitlementId: Types.ObjectId;    // unique — the purchase gate, enforced by index
  rating: 1 | 2 | 3 | 4 | 5;
  title?: string;
  body: string;
  versionAtReview?: string;         // which version they actually used
  status: "published" | "hidden" | "removed";
  vendorResponse?: { body: string; at: Date; byUserId: Types.ObjectId };
  reportCount: number;
  editedAt?: Date;
}
```

`versionAtReview` because a two-star review of a version fixed a year ago is
information about the past, and the product page can say so.

### Aggregates, computed not stored twice

> **Implemented 2026-08-17 as a sum and a count, not an average.**
> `ratingSum` and `ratingCount` are integers and the average is derived at the
> point of display, so there is no float in the database that can disagree with
> the reviews behind it — the same argument §84 makes about money. The
> distribution is five counts, one-star first, because a 4.2 made of forty fives
> and ten ones is a different product from one made of fifty fours.
>
> Recomputed by **aggregation, not by `$inc`**. An increment is cheaper and
> cannot express the cases that actually happen — a rating edited from 5 to 2, a
> review hidden, a review restored — and each would leave the cache a little
> further from the truth with nothing to detect it.
>
> A product with no published reviews has the fields **unset**, not zeroed.
> Absent is what the card and the JSON-LD read as "no rating"; a stored `0` would
> render a zero-star product and emit a fabricated `AggregateRating`.

A product's average and distribution are maintained on the product as a
**derived** cache, recomputed on every review write inside the same transaction.
The reviews remain the source of truth (§103); the cache exists because a
marketplace listing cannot aggregate per card.

A vendor's rating is the weighted average across their products, recomputed the
same way. It is a *derived* number and never editable — vendor ticket 12 shows
it beside the operational signals that are not ratings at all.

### Moderation

Published on submission, reportable after (decision **V7**). Pre-moderation
would put a staff member between every customer and their opinion, and the
volume that makes pre-moderation necessary is a long way off.

A report raises the count and, past a threshold, queues it for staff. Staff can
hide (author sees why) or remove (a policy breach). A vendor can report but
never hide — a seller who can suppress criticism of their own product makes
every remaining review worthless.

Content goes through the same validation as any other customer text, and is
rendered escaped. It is public, attacker-controlled text on a page the platform
wants indexed.

### Vendor response

One response per review, public, edit-visible. The vendor's answer to a bad
review is often more useful to the next buyer than the review, and a vendor with
no reply is left arguing in support email nobody else reads.

Responses are covered by §37's discipline in one direction: nothing internal —
no staff note, no dispute detail — ever reaches this field.

### Prompting

> **Implemented 2026-08-17 — "after use" means a recorded download.**
> `Download` rows already exist (§66), so evidence of use needed no new
> instrumentation: the prompt appears once one exists, and falls back to
> `PROMPT_AFTER_DAYS = 3` for a product whose delivery is not a download at all.
> Dismissal is a timestamp on the entitlement and is permanent — "ask me later"
> is a mechanism for asking four times.
>
> The form lives on My Software and **nowhere else**, which is how purchase-gating
> shows up in the interface: the product page has no "write a review" button for
> anybody, because a button that leads to "you cannot review this" is worse than
> no button.

A review is asked for from My Software, after a download and a decent interval,
once per entitlement, dismissible for good. Never before use: a review written
before the software has run is a review of the buying experience.

### SEO — this is what unlocks `AggregateRating`

Ticket 27 deliberately omitted `AggregateRating` from the product JSON-LD:
"there are no reviews in the MVP; emitting a fabricated rating is a
structured-data policy violation with a manual-action penalty attached". That
reasoning expires here.

`AggregateRating` and individual `Review` entries are emitted **only** where real
published reviews exist, and a product with none emits neither — the same rule,
now satisfiable.

> **Implemented 2026-08-17.** `product.rating` is absent rather than zeroed for an
> unreviewed product precisely so this stays a presence check rather than a `> 0`
> test somebody can get wrong later. Five `Review` entries at most: the aggregate
> is what a search engine uses, and forty serialised reviews in a script tag is
> page weight for nothing. The author name in the structured data is the same
> shortened form the visible page shows — publishing more in JSON-LD than on the
> page would be the wrong way round.

## Out of scope
Review helpfulness voting, photo or video reviews, and imported reviews from
elsewhere. The last is a deliberate refusal: an imported review cannot be
purchase-gated, and admitting one unverified review undermines the guarantee
every other review rests on.

## Acceptance criteria
- [x] A customer without an active entitlement cannot review, refused in the action and not only by a hidden form.
- [x] One review per entitlement, enforced by a unique index rather than a read-then-write.
- [x] An author edits their own review; nobody else can, including staff, who hide or remove instead.
- [x] An edited review is visibly edited.
- [x] A vendor cannot hide, remove or edit any review of their own product.
- [x] A vendor responds once per review, publicly, and the response is edit-visible.
- [x] Nothing internal — staff note or dispute detail — can reach a vendor response.
- [x] Review text is escaped on render; a script tag in a review body does not execute.
- [x] Aggregates are recomputed in the same transaction as the review write, and reviews remain the source of truth.
- [x] Hiding a review removes it from the aggregate immediately.
- [x] A vendor's rating is derived from their products' reviews and is not editable by anyone.
- [x] `AggregateRating` appears in the product JSON-LD only where published reviews exist, and a product with none emits neither it nor `Review`.
- [x] A review prompt appears once per entitlement, after use, and stays dismissed.
- [x] `01-mvp-todo.md`'s deferred list records that ratings/reviews are un-deferred by this ticket.

## Implementation notes — 2026-08-17

**The entitlement is the gate *and* the subject.** A review's form carries an entitlement id and
nothing else about what is being reviewed: the entitlement names the product, the organisation
and the version bought. There is no `productId` field to lie in, which is stronger than
validating one.

**`active` only.** A suspended entitlement is a refunded or disputed purchase, and a review from
one is the shape of a "refund me or I review you" campaign.

**A second purchase may leave a second review.** The unique index is on `entitlementId`, not on
`(productId, userId)` — somebody who bought two licences a year apart has two experiences worth
recording, and the gate is still one review per purchase.

**The author's name is shortened to "Ada L."** on the page *and* in the structured data. A
public page carrying somebody's full name because they bought software is a privacy decision
nobody took, and the initial does the only job the name has here.

**Reporting is a row per person, not an increment.** `reportCount` is recomputed from
`reviewReports` with a unique `(reviewId, reportedByUserId)` index, so a refreshed page cannot
inflate it — and the rows answer the question a counter cannot: whether one account reported
forty reviews in an hour.

**`ProductReviewFlagged` fires once, on crossing the threshold.** A notification per report on a
brigaded review is how a moderation queue becomes noise nobody reads.

**Staff hide, remove or restore. Nobody edits.** There is no action, permission or code path
that lets one person change another's words — staff editing a review would publish an opinion
attributed to somebody who did not express it. `assertNotVendorModeration` exists so a future
caller that tries to add a vendor-facing hide path fails loudly rather than quietly working.

**A vendor's rating is the mean of the reviews, not of the products' means.** Two products —
one with two fives, one with a single one-star — average 3.0 by product and 3.7 by review. The
second is what a buyer assumes a seller rating means, and the first lets one review of an
unpopular product cancel out many of a popular one.

**A review write invalidates the catalogue cache.** The rating on the product page comes from
`getProductDetail`, a `"use cache"` read, while the review list is loaded outside it — so
without `catalogChanged()` a new review would appear in the list while the stars above it still
showed the old number.
