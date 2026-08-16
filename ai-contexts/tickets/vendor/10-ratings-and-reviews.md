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

## Out of scope
Review helpfulness voting, photo or video reviews, and imported reviews from
elsewhere. The last is a deliberate refusal: an imported review cannot be
purchase-gated, and admitting one unverified review undermines the guarantee
every other review rests on.

## Acceptance criteria
- [ ] A customer without an active entitlement cannot review, refused in the action and not only by a hidden form.
- [ ] One review per entitlement, enforced by a unique index rather than a read-then-write.
- [ ] An author edits their own review; nobody else can, including staff, who hide or remove instead.
- [ ] An edited review is visibly edited.
- [ ] A vendor cannot hide, remove or edit any review of their own product.
- [ ] A vendor responds once per review, publicly, and the response is edit-visible.
- [ ] Nothing internal — staff note or dispute detail — can reach a vendor response.
- [ ] Review text is escaped on render; a script tag in a review body does not execute.
- [ ] Aggregates are recomputed in the same transaction as the review write, and reviews remain the source of truth.
- [ ] Hiding a review removes it from the aggregate immediately.
- [ ] A vendor's rating is derived from their products' reviews and is not editable by anyone.
- [ ] `AggregateRating` appears in the product JSON-LD only where published reviews exist, and a product with none emits neither it nor `Review`.
- [ ] A review prompt appears once per entitlement, after use, and stays dismissed.
- [ ] `01-mvp-todo.md`'s deferred list records that ratings/reviews are un-deferred by this ticket.
