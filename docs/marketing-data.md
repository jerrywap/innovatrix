# Behavioural data, and what it can be used for

Written for a later phase that wants to follow up with customers — "the full
script of the template you downloaded is now available", "you saved this three
weeks ago and it is now half price".

**Nothing in this document is implemented.** It is an inventory of what the
database already holds, taken by reading the schemas rather than by assuming.
Every claim cites a file and a line so the next reader can check it. The most
important half is the second one: what is **not** captured, so the later phase
does not plan around data that does not exist.

The line this whole document has to respect is already drawn in the code, twice:

> `services/notifications/notification-service.ts:46` and
> `services/notifications/catalog.ts:263` — *a payment receipt or a licence key
> is not marketing.*

Marketing rides on its own consent, in its own category, or it does not go.

---

## 1. What is captured today

### 1.1 Downloads — the strongest signal we have

`Download` — `src/lib/db/models/commerce.ts:699`

```
{ organizationId, entitlementId, productFileId, userId, ip?, userAgent? }
index: { entitlementId: 1, createdAt: -1 }
```

Written in exactly one place, `src/app/api/downloads/[fileId]/route.ts:104`,
after the entitlement guard and before the redirect. **Append-only audit (§66)**
— the model comment says "No soft delete, no updates", so it is a reliable
history and must stay one.

**The join to worry about: there is no `productId` on a download.** Reaching the
product costs a hop, either
`productFileId → ProductFile.productId` or `entitlementId → Entitlement.productId`.
The worked example already exists — the `$lookup` in
`src/services/vendors/analytics-service.ts:257` (`downloadsByVersion`).

For an audience query prefer the **entitlement** hop: it is one indexed field on
a collection the notification system already reads, and it answers "who has this
product" rather than "who fetched this file", which is the question a campaign
actually asks.

### 1.2 Entitlements — the durable "this person has this"

`Entitlement` — `src/lib/db/models/commerce.ts:577`. Indexes
`{orderId, orderLineId}` unique and `{organizationId, productId}`.

This is the edge the notification system can already resolve (see §3), and
crucially it exists for **free** downloads too: `claimFreeProduct`
(`src/services/checkout/free-claim.ts`) mints a real zero-total order, payment,
entitlement and licence, and its docblock states that download rights come from
an entitlement and nothing else. So "everybody who downloaded this free template"
is answerable today.

Two fields added alongside this document, both relevant to segmentation:

- `acquiredFree` — set at fulfilment from `order.total.amount === 0`.
  Free-claimers and buyers are now distinguishable without joining orders.
- `hiddenAt` — the customer took it off their library shelf. **Treat as a weak
  negative signal**: they did not want it listed. Excluding hidden rows from a
  campaign audience is the respectful default.

### 1.3 Saved products — per user, and deliberately private

`SavedProduct` — `src/lib/db/models/catalog.ts:1199`

```
{ userId, productId }
unique { userId, productId } · list { userId, createdAt: -1 }
```

**User-scoped, not organisation-scoped, on purpose.** The model comment
(`catalog.ts:1201`) rejects org-scoping because "your colleagues can see what you
have been considering". Any campaign built on this inherits that stance: a saved
list is a private note, and surfacing it — even to a colleague, even in an
aggregate a colleague could de-anonymise — breaks a promise the schema already
made.

Note also that unsaving is a **hard delete** (`services/marketplace/saved.ts:29`),
so there is no "used to be interested" history and no dwell time. A save is a
current fact, not a timeline.

---

## 2. What is **not** captured

This is the important section. Each of these is a deliberate decision with a
comment behind it, not an oversight to be quietly reversed.

### 2.1 There is no per-user search history

`SearchLog` — `src/lib/db/models/catalog.ts:1237` — stores
`{ term, count, lastSeenAt, hadFilters }`, **one upserted row per term**, with a
unique index on `term` and a **180-day TTL** on `lastSeenAt`.

Three separate limits, all intentional:

1. **Only zero-result searches are recorded.** `logZeroResultSearch`
   (`services/marketplace/saved.ts:102`) is called from one place,
   `features/marketplace/results-section.tsx:93`, and only when
   `query.q && result.total === 0`. Successful searches — the ones that would
   tell you what somebody wanted and found — are not stored at all.
2. **No user id, and the comment refuses one** (`catalog.ts:1250`): *"tying it to
   a person turns a roadmap input into a profile. The count is what matters; who
   typed it is not."*
3. **It is not a demand signal.** `features/search/data.ts:4` warns the
   collection "must not be used" for suggestions, because surfacing these terms
   "would route visitors straight into guaranteed-empty result sets".

**Consequence:** "customers who searched for X" is not answerable, today or
retrospectively. Closing it means a new collection and a new consent position,
not a query.

### 2.2 There are no page views, funnels or conversion rates

`features/reporting/admin-analytics.ts:40` states it outright: *"Nothing on this
platform counts a page view. No funnel, no conversion rate, no traffic."*
`services/vendors/analytics-service.ts` returns `traffic: null` rather than a
fabricated number.

So "viewed but did not buy" is not answerable. The nearest real signals are a
save (§1.3) and a demo open.

### 2.3 Recently-viewed is a cookie, not a row

`services/marketplace/recently-viewed.ts` — slugs in a 30-day, non-`httpOnly`
cookie. Client-side only, per-device, untrusted, and invisible to the server for
audience purposes.

### 2.4 There is no `marketing` notification category

`NOTIFICATION_CATEGORIES` — `src/lib/db/enums.ts:880` — is closed at six:
`requests, quotes, billing, products, messages, security`. Preferences store only
the **muted** `${category}:${channel}` pairs
(`models/communication.ts:438`), and `billing` and `security` bypass them
entirely as essential.

A campaign must not ride under `products`. That category means "new versions of
what you own" (`lib/notification-categories.ts`), somebody who muted it did not
mute marketing, and somebody who left it on did not consent to marketing.

### 2.5 There is no consent or unsubscribe field anywhere

`features/legal/privacy-policy.ts:413` already promises marketing opt-out and
unsubscribe. No model implements it.

**This is the blocker.** Everything else in this document is a query; this is a
schema, a preference screen, an unsubscribe link with a signed token, and a
suppression check in the send path. It should be built first, because a campaign
that ships before it is a promise already broken.

---

## 3. The delivery machinery that already exists

Worth reusing rather than rebuilding — but see §2.4 before sending anything
through it.

- **Event bus** — `src/lib/events/index.ts`. In-process, synchronous, dispatched
  **after** the transaction commits. `DomainEventMap` plus `EVENT_NAME_SET`, a
  `Record<DomainEventName, true>`, so adding an event and forgetting the set is a
  compile error.
- **Catalogue** — `src/services/notifications/catalog.ts`. A rule carries
  `audience`, `category`, `title`, `body`, `href`, `actionLabel`, optional
  bespoke `email`.
- **The audience we want already exists.** `entitled_owners`:
  1. a rule declares `audience: { kind: "entitled_owners" }` (`catalog.ts:385`);
  2. the handler passes only product ids as context (`handlers.ts:96`);
  3. `entitledOwners` (`recipients.ts:171`) queries
     `Entitlement.find({ productId: { $in: … }, status: "active" })`, dedupes to
     distinct organisations, then resolves org members.

  Two limits to design around: **500 organisations** (`MAX_ENTITLED_ORGANIZATIONS`)
  and **100 product ids** per call. And it is *"a query, never a claim in the
  payload"* — lapsed and revoked entitlements are excluded deliberately.
- **Nine places a new notifying event touches** — the fan-out table in
  `AGENTS.md`. Rows 5 and 9 fail silently.

---

## 4. Scenario: "the full script of your template is now available"

The example that prompted this document, and the one that is nearly buildable.

### 4.1 How a template is linked to its script

**One edge, stored on the template, pointing at the script.**

`Product.scriptListingId` — `src/lib/db/models/catalog.ts:559`, schema line 667,
with a **partial unique index** (lines 762-768) so at most one template points at
any given script. There is no `templateListingId` on the script; the reverse
lookup is a query, `products.findTemplateSiblingOf`
(`src/repositories/product.repository.ts:315`).

`services/catalog/template-sibling.ts:42` explains why both creation paths
converge on the same edge: *"because that edge already runs in the direction both
need."*

```
Template ──scriptListingId──▶ Script
   ▲                            │
   └──── findTemplateSiblingOf ──┘   (a query, not a field)
```

### 4.2 The trigger

The moment a template gains a `scriptListingId`:

- `createScriptSibling(templateProductId, …)` — `template-sibling.ts:404`, which
  calls `products.linkScriptListing` — a conditional update filtered on
  `scriptListingId: { $exists: false }`, so it fires once and only once; or
- `createTemplateSibling(scriptProductId, …)` — `template-sibling.ts:294`, which
  sets the edge via `saveSection(…, "template_link", …)`.

But note **the script is created as a `draft`**. The customer-useful moment is
not the link, it is the script reaching `published` — which already emits
`ProductPublished` (`services/catalog/product-service.ts:706`). So the honest
trigger is: *on `ProductPublished`, ask whether any template points at this
product*, i.e. `findTemplateSiblingOf(productId)`.

### 4.3 The audience

Everyone holding an active entitlement to **the template**:

```
findTemplateSiblingOf(publishedScriptId) → template
  → entitledOwners(template._id)      # recipients.ts:171, already written
  → exclude entitlement.hiddenAt      # they took it off their shelf
  → exclude anyone already entitled to the script itself
```

All three steps are queries against existing indexes
(`{organizationId, productId}` on Entitlement). **No new capture is needed for
this scenario** — which is why it is the one to build first.

People who merely **saved** the template are *not* reachable: a `SavedProduct`
row is user-scoped and no audience kind resolves it (§1.3, §2.1). That is the one
addition this scenario would want, and it is a new `Audience` variant plus a
resolver, not a schema change.

### 4.4 The copy already exists

`features/product/complete-application-banner.tsx` is the on-page version of this
same offer, shown on a template's detail page when its script sibling is
published. Any email must agree with it — and with its framing, which leads on
**scope disclosure** ("this is the front-end only") rather than on an upsell.

---

## 5. Two more scenarios, mapped the same way

### 5.1 "You downloaded this free — here is the paid version / an upgrade"

**Answerable now.** `Entitlement` where `acquiredFree: true`, joined to products,
excluding anyone with a paid entitlement to the same product or its sibling.
Exclude `hiddenAt`. Same `entitled_owners` shape as §4.

The judgement call is frequency, not feasibility: somebody who takes five free
templates should not get five emails.

### 5.2 "You saved this and never took it"

**Not answerable without a decision.** The data exists — `SavedProduct` minus any
`Entitlement` for the same product — but §1.3's privacy stance and §2.5's missing
consent both apply, and a save is the most explicitly *private* signal on the
platform. If this is ever built it should be the most conservative of the three:
opt-in, low frequency, and never naming what somebody saved in a subject line
that a colleague might see over their shoulder.

---

## 6. If the later phase asks "what should we add first?"

In order, and the order matters:

1. **Consent and unsubscribe** (§2.5). Nothing may send before this exists.
2. **A `marketing` notification category** (§2.4), so preferences can express it
   and the existing muting machinery applies.
3. **The §4 campaign**, which needs no new capture at all.
4. **A `saved_product` audience kind** (§4.3) — a resolver beside
   `entitledOwners`, respecting §1.3.
5. **Per-user search capture** (§2.1) — the largest change, and the one that
   needs the clearest answer to the question `catalog.ts:1250` already asked:
   what turns a roadmap input into a profile, and are we willing to.
