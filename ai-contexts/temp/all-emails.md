# Every email CoSetup sends, and every promise it makes about people

An inventory, written to be *edited against*. Two halves:

- **Part 1 — Emails.** Every message that can leave the building, where its copy
  lives, and who receives it.
- **Part 2 — "A person does this" copy.** Everywhere in the product we tell
  somebody that a human reads, checks, decides or replies — and everywhere we
  put a time on it. These are the claims we are on the hook for, so they are the
  ones worth getting right.

Both halves are generated from the code as it stands on `improvetaxonomy`, not
from the spec. Where the code and the promise disagree, that is noted as a
**gap** rather than smoothed over.

---

## Part 0 — How an email is built

Three layers, and knowing which one a change belongs in saves rewriting it twice.

| Layer | File | What it owns |
|---|---|---|
| Shell | `src/emails/layout.ts` | The wordmark, the orange rule, the card, the footer, and the plain-text rendering. `composeEmail()` returns `{ text, html }`. |
| Template | `src/emails/notification.ts` | The **generic** notification email: greeting, heading, one body paragraph, "Open in CoSetup", one footnote. |
| Copy | `src/services/notifications/catalog.ts`, `src/services/email/index.ts` | The actual words, per event or per auth message. |

`EmailContent` (`layout.ts:121`) is the whole contract a template can fill:

```
preheader   required — the inbox preview line
greeting?   "Hi Jerry," — notification + security emails only
heading     the <h1>
body[]      one string per paragraph
action?     { label, url, showUrl }
notes[]?    small print under the button
```

Footer on every message: `CoSetup is a trading name of Perfect Gateway LTD.` +
`cosetup.net` (`BRAND_LEGAL_IDENTITY`, `src/config/brand.ts:41`).

Sender: `info@cosetup.net`. Delivery is queued, never inline — `send-email`
(`src/services/jobs/handlers/email.ts`) with 5 attempts and a 6-hour backoff cap,
plus a `retry-notification-emails` sweep for notifications whose job was never
enqueued.

### Subject-line grammar

Notification emails are prefixed with the **category subject**, not the label
(`src/lib/notification-categories.ts:42`):

| Category | Label (settings screen) | Subject prefix | Can be turned off? |
|---|---|---|---|
| `requests` | Requests | `Request` | yes |
| `quotes` | Quotes | `Quote` | yes |
| `billing` | Billing | `Billing` | **no** — "We have to tell you about money." |
| `products` | Software | `Software` | yes |
| `messages` | Messages | `Message` | yes |
| `security` | Security | `Security` | **no** — "Always on, so you hear if somebody gets in." |

So the screenshot subject `Software: Ejenxy Creative Digital Agency is on sale`
is `products` → `Software` + the row's `title`.

### The two footnotes

Every generic notification ends with exactly one of:

- `Change what we email you about in your notification settings.` (optional categories)
- `You receive this because it concerns money or your account security.` (essential)

Security emails override this entirely with their own two notes — see §1.4.

---

## Part 1 — The emails

48 domain events exist. **43 are wired** to a notification handler; every
`CATALOG` row has a subscriber (verified). 5 events produce no notification at
all — see §1.7.

Legend: **G** = generic template, **W** = written (bespoke) email.

### 1.1 Auth and invitation emails

Not events — sent directly by Better Auth hooks or a server action.
Copy in `src/services/email/index.ts`.

| # | Email | Trigger | Subject | Notes shown |
|---|---|---|---|---|
| A1 | Confirm your email address | Sign-up (`sendOnSignUp`) and resend | `Confirm your email address` | Expires in 1 hour · ignore if you didn't sign up |
| A2 | Reset your password | Forgot-password | `Reset your password` | One use, 1 hour · "your password hasn't changed" |
| A3 | Organization invitation | Inviting a colleague | `{inviter} invited you to {org}` | Expires in 48 hours |
| A4 | Vendor team invitation | Inviting a seller teammate | `{inviter} invited you to sell as {vendor}` | Expires in 48 hours |

**Deliberate constraint:** none of these state whether an account exists. A2 says
"this address", never "your account" (§88).

### 1.2 Customer emails — requests, quotes, billing

| # | Event | Subject | Body | Cat | Tpl |
|---|---|---|---|---|---|
| C1 | `RequestSubmitted` | `Request: We've got your request {ref}` | "We'll come back to you once somebody has looked at it." | requests | G |
| C2 | `CustomizationSubmitted` | `Request: We've got your customization request {ref}` | — | requests | G |
| C3 | `CustomerActionRequested` | `Request: {ref} needs you` | the staff-written note, verbatim | requests | G |
| C4 | `RequestProgressPosted` | `Request: Update on {ref}` | the update message | requests | G |
| C5 | `MessagePosted` | `Message: New message on {ref}` | — | messages | G |
| C6 | `QuoteIssued` | `Quote: Your quote {ref} is ready` | "Have a read, then accept it or tell us what to change." | quotes | G |
| C7 | `QuoteAccepted` | `Quote: You accepted quote {ref}` | "We'll raise the invoice and get the work scheduled." | quotes | G |
| C8 | `InvoiceIssued` | `Billing: Invoice {ref} is ready to pay` | — | billing | G · **essential** |
| C9 | `InvoicePaid` | `Billing: Payment received for {ref}` | "Thank you — nothing more to do." | billing | G · **essential** |
| C10 | `InvoiceDueSoon` | `Billing: Invoice {ref} is due today` / `in N days` | — | billing | G · **essential** |
| C11 | `InvoiceOverdue` | `Billing: Invoice {ref} is overdue` | "If you have already paid, ignore this — payments can take a day to land." | billing | G · **essential** |
| C12 | `AddonProvisioned` | `Billing: {addon} is ready` | "The details are in the messages on your order." | billing | G |
| C13 | `ProductVersionReleased` | `Software: {product} {version} is available` | "You can download it from My purchases." | products | G |
| C14 | `VendorOffboarded` | `Software: {vendor} has left CoSetup` | Leads with what survives: licence valid, downloads work, support moves to CoSetup | products | G |

### 1.3 Vendor emails

| # | Event | Subject | Body | Cat | Tpl |
|---|---|---|---|---|---|
| V1 | `VendorApplied` | `Thanks for applying to sell on CoSetup` | **screenshot img_5** — see §1.5 | products | **W** |
| V2 | `VendorVerificationDecided` (approved) | `{level} approved — {vendor}` | "Somebody has checked the documents… and they are fine." + what it unlocks | products | **W** |
| V3 | `VendorVerificationDecided` (rejected) | `{level}: we need something else — {vendor}` | reviewer's note verbatim + "Replacing a document does not start the whole application again." | products | **W** |
| V4 | `VendorVerified` | `Software: You can start listing` | "Your vendor account is verified. Create your first product whenever you are ready." | products | G |
| V5 | `VendorRejected` | `Software: We can't take your application forward` | the reason, verbatim | products | G |
| V6 | `VendorSuspended` | `Security: Your vendor account is suspended` | reason + "New sales are paused. Customers who already bought from you keep their software and their downloads." | security | G |
| V7 | `ProductSubmitted` → staff | `Software: {vendor} submitted {product}` | "Waiting for a reviewer." / resubmission variant | products | G |
| V8 | `ProductChangesRequested` | `Software: {product} needs changes before it can go on sale` | reviewer's words, truncated at 200 chars | products | G |
| V9 | `ProductApproved` | `Software: {product} passed review` | **screenshot img_7** — "It has gone into our own testing and readiness checks. We will tell you when it is on sale." | products | G |
| V10 | `ProductPublished` | `Software: {product} is on sale` | **screenshot img_6** — "Customers can buy it now." | products | G |
| V11 | `ProductReviewPublished` | `Software: {rating}★ review of {product}` | "You can reply publicly. A vendor's answer is often more useful to the next buyer than the review itself." | products | G |
| V12 | `CustomizationRoutedToVendor` | `Request: A customer wants changes to {product}` | "We have passed on what they asked for. Take a look and tell us what it would cost." | requests | G |
| V13 | `VendorSupportThreadOpened` | `Message: A question about {product}` | "You answer this one first — we are watching the thread rather than running it." | messages | G |
| V14 | `DisputeRaised` → vendor | `Message: A dispute has been opened on one of your threads` | "CoSetup will decide it. Add anything you want considered to the conversation — it is read before a decision is made." | messages | G |
| V15 | `DisputeResolved` | `Message: A dispute has been decided` | the reason, verbatim | messages | G |
| V16 | `VendorPayoutPaid` | `Billing: We've paid you {ref}` | "Payout {ref} has been sent. Quote that reference if you need to ask us about it." | billing | G |
| V17 | `VendorPayoutFailed` | `Billing: A payout to you didn't go through` | reason + "Check your payout account details; we will try again on the next run." | billing | G |
| V18 | `AddonProvisioningRequested` | `Billing: {addon} was bought and needs handing over` | "Send them what it needs — a key, a licence code, an account — and mark it provided." | billing | G |

### 1.4 Account security emails — all four bespoke, none optional

`PasswordChanged`, `PasswordSet`, `SocialAccountLinked`, `SocialAccountUnlinked`.
Shared writer `securityEmail()` (`catalog.ts`), action `Review your security
settings` with **`showUrl: true`** (the only emails that print the raw URL).

Both notes are fixed:

1. "If you did not make this change, reset your password immediately and sign out of every device from your security settings."
2. "You receive this because it concerns your account security. These messages cannot be turned off."

They are written out precisely *because* the generic footnote ("change what we
email you about…") would be wrong here.

### 1.5 Staff / queue emails

| # | Event | Subject | Audience |
|---|---|---|---|
| S1 | `VendorApplied` → staff | `New vendor application — {name}` (**W**) | `vendor.review` |
| S2 | `ProductSubmitted` | `Software: {vendor} submitted {product}` | `product.review` |
| S3 | `RequestSubmitted` / `CustomizationSubmitted` | `Request: New {kind} — {ref}` | `request.view_all` |
| S4 | `RequestAssigned` | `Request: {ref} is yours` | the assignee |
| S5 | `FollowUpDue` | `Request: Due today: {title}` / `Overdue: {title}` | the assignee only — a private note-to-self |
| S6 | `WorkReadyToStart` | `Request: {ref} is paid and ready to start` | `request.view_all` |
| S7 | `QuoteAccepted` / `QuoteRejected` | `Quote: {ref} accepted` / `was declined` | `quote.view_all` |
| S8 | `InvoicePaid` / `InvoiceOverdue` | `Billing: {ref} paid in full` / `is N days overdue` | `invoice.view_all` |
| S9 | `VendorBriefAnswered` / `VendorBriefDeclined` | `Request: {product} — the vendor has priced it` / `declined` | `request.view_all` |
| S10 | `DisputeRaised` | `Message: Dispute raised by the {side}` | `vendor.review` |
| S11 | `ProductReviewFlagged` | `Software: A review needs a look` | `review.moderate` |
| S12 | `ProductEmergencyDelisted` | `Security: {product} was pulled from sale` | `product.publish` |

### 1.6 The three screenshots, verbatim

**img_5 — V1, the vendor application acknowledgement.** The most-written email we
have, and the one a new vendor judges us by.

> **Subject:** Thanks for applying to sell on CoSetup
> **Preheader:** Your next step: verify your identity, and you can list as soon as you are approved.
> **Heading:** Thanks for showing interest
>
> We have your application for {displayName}, and somebody reads every one of them properly — you will hear from us either way.
>
> You do not have to wait for that. Verifying your identity is a separate check, it runs alongside the application, and it is the step that unlocks listing a product. Getting it in now means there is nothing left to do on the day you are approved.
>
> **[ Verify my identity ]**
>
> *You will need a passport, driving licence or national ID card, and something showing your address from the last three months — a bank statement, a utility bill or a council tax letter.*
> *Being paid needs one more check after that, and you can sell before it finishes: earnings wait in your balance until it clears.*

**img_7 — V9, product approved.** Generic template.

> **Subject:** Software: Ejenxy Creative Digital Agency passed review
> Hi Cozy Scripts,
> **Ejenxy Creative Digital Agency passed review**
> It has gone into our own testing and readiness checks. We will tell you when it is on sale.
> **[ Open in CoSetup ]**
> *Change what we email you about in your notification settings.*

**img_6 — V10, product on sale.** Generic template.

> **Subject:** Software: Ejenxy Creative Digital Agency is on sale
> Hi Cozy Scripts,
> **Ejenxy Creative Digital Agency is on sale**
> Customers can buy it now.
> **[ Open in CoSetup ]**
> *Change what we email you about in your notification settings.*

Observations for the rewrite:

- V9 and V10 are near-identical in shape, arrive minutes apart (19:14 and 19:15
  in the screenshots), and the second makes the first look redundant. If approval
  and publication normally happen within the same minute, the sequence is the
  problem, not the wording.
- V10 — the single best moment in a vendor's life on the platform — is four
  words long and links to the dashboard, not to the live product page. (`href` is
  `productHref(p.productSlug)`, so the link *is* the public page; the button
  label "Open in CoSetup" hides that.)
- Neither carries the storefront URL, a "share this" nudge, or what to do next.
- "Open in CoSetup" is the same label on ~40 different emails.

### 1.7 Gaps — events that email nobody

Five events exist and produce **no notification and no email**:

| Event | Why it matters |
|---|---|
| `PaymentReceived` | — |
| `OrderCompleted` | **A customer who buys software gets no order confirmation.** |
| `LicenceIssued` | **A customer who buys a licence is never sent the key or told where it is.** |
| `RequestStatusChanged` | Status moves silently unless a separate event fires. |
| `RequirementsRevised` | — |

These three are `ActivityEvent` rows (an on-screen timeline), not domain events —
`src/services/payments/fulfilment.ts:249`, `src/services/invoices/invoice-service.ts:351`.

**Two places in the product promise an email that does not exist:**

1. `src/app/(public)/orders/[reference]/confirmation/page.tsx:194`
   > "3. A receipt lands in your inbox."
2. `src/features/checkout/components/transfer-instructions.tsx:61`
   > "Your downloads and licence keys are released once we've received the payment and matched it to this order — usually the next working day. **We'll email you when that happens.**"

Whatever else changes, these two should either gain the email or lose the
sentence.

---

## Part 2 — Every "a person does this" claim

The second brief: everywhere CoSetup tells somebody that a human is involved, or
puts a time on it. Grouped by surface. **Each of these is a promise we can be
held to**, which is why they are worth enhancing together rather than one screen
at a time.

### 2.1 The core human-review claims

| Where | Exact text |
|---|---|
| `features/requirements/components/discovery-intro.tsx:45` | **"A person reads every request"** (a trust chip beside "Free discovery") |
| `features/requirements/components/review-panel.tsx:168` | "Write down what you need, one line at a time. **A person reads all of it.**" |
| `app/dashboard/selling/apply/page.tsx:84` | "Tell us who you are and what you build. **Somebody reads every application.**" |
| `features/vendors/sell-data.ts:75` | "**Somebody reads every application — this is not an automatic sign-up.**" |
| `features/vendors/components/sell/sell-sections.tsx:247` | "Applying takes a few minutes. **Nothing here is automatic** — which is slower than a sign-up form, and the reason a buyer trusts what is on the shelf." |
| `features/vendors/sell-data.ts:83` | "**A reviewer checks it before it goes on sale**, and tells you what to change if it isn't ready." |
| `app/dashboard/selling/products/page.tsx:116` | "Create your first product. **A reviewer checks it before it goes on sale.**" |
| `features/vendors/components/submit-panel.tsx:89` | "**Somebody will read it** and either put it on sale or tell you what to change. You can pull it back until a reviewer starts." |
| `features/vendors/components/submit-panel.tsx:159` | "Finish the items above first — **a reviewer checks the same list.**" |
| `features/reviews/components/vendor-review-panel.tsx:151` | "Reported. **Somebody will read it.**" |
| `app/staff/vendor-submissions/page.tsx:48` | "**Waiting for a reviewer** (N)" |
| `app/staff/reviews/page.tsx:165` | "Reviews **somebody asked us to look at.** Hiding is reversible; removing is for a policy breach." |

### 2.2 Timing promises

| Where | Exact text |
|---|---|
| `app/dashboard/selling/verification/page.tsx:117` | "Unlocks listing a product. **Usually decided within a working day.**" |
| `app/dashboard/selling/verification/page.tsx:409` | "**Somebody checks usually within a working day**, and we'll email you as soon as there's an answer — whichever way it goes. If we need anything else, we'll ask in that email." |
| `features/vendors/sell-data.ts:206` | "**Usually decided within a working day**, and it runs alongside your application rather than after it." |
| `app/dashboard/selling/page.tsx:117` | "A government ID and proof of your address. **It usually takes a few minutes to send** and it is what unlocks listing a product." |
| `app/(public)/orders/…/confirmation/page.tsx:189` | "2. We match it against your order — **usually the next working day.**" |
| `app/(public)/orders/…/confirmation/page.tsx:193` | "1. We confirm your payment with the provider — **usually seconds.**" |
| `features/checkout/components/transfer-instructions.tsx:61` | "…**usually the next working day.** We'll email you when that happens." |
| `features/checkout/components/processing.tsx:112` | "We're waiting for your payment provider to confirm. **This usually takes a few seconds** — please don't close this page." |
| `features/payouts/payout-view.ts:67` | "The transfer is with the bank. **It usually lands within a few working days.**" |
| `features/vendors/agreement.ts:96` | "There is a **first-response target — one working day** if your business verification is complete, **two otherwise**. Customers are shown it before they open a thread, so it is a promise rather than a guideline. **We measure it.**" |
| `services/vendors/support-service.ts:42` | (enforcement) an identity-only vendor is expected to answer within two working days; measured in hours, not working days — no holiday calendar |

### 2.3 Status copy that says whose move it is

`src/features/requests/status-copy.ts` — `what` / `next` for all 13 request states.
The human-involvement ones:

| Status | What | Next |
|---|---|---|
| `submitted` | "We've got it." | "**Someone will pick it up and read it properly.** Nothing needed from you." |
| `under_review` | "**Someone is going through it.**" | "We'll come back with questions or a quote." |
| `waiting_for_customer` | "We've asked you something." | "Have a look below — we can't go further until you answer." |
| `technical_review` | "**Our technical team is scoping it.**" | "They're working out what it takes. A quote follows." |
| `converted` | "Payment received — this is with our team." | "**We'll confirm when someone picks it up.**" |
| `in_progress` | "Work has started." | "We'll post updates here as it moves." |
| `rejected` | "We couldn't take this one on." | "Get in touch if you'd like to talk about it." |

Vendor account states — `app/dashboard/selling/page.tsx:214`:

> `in_review` → "**Somebody is reading your application now.** Carry on with verification while they do — the two run side by side, and if we need anything else we'll ask by email."

Product wizard — `features/vendors/components/submit-panel.tsx:120`:

> "In our hands — This has passed review and is **going through our readiness checks.** We will tell you when it is on sale."

### 2.4 The vendor agreement — the formal version of the same promises

`src/features/vendors/agreement.ts`. These are the binding wording behind the
marketing copy, so any rewrite above has to stay consistent with them.

- "**Somebody reads every application.** Being accepted is not automatic and we do not have to explain a rejection, though we will tell you plainly that it is one."
- "**The documents you upload are read by a person**, and what they decided is recorded along with a checksum of what they read. We keep the decision; we do not need to keep the document indefinitely."
- "**A reviewer checks a product before it goes on sale.** If it is not ready you are told what to change, in specific terms, and you resubmit — the history of what was said is kept so a third submission makes sense next to the first two."
- "**We do not review your source code for correctness** and we are not warranting your software to the customer. The review checks that what the listing claims matches what is delivered."
- "We may decline to list something without that being a judgement on its quality."
- "You cannot hide, remove or edit a review, and neither can we do it on request. What you can do is report one that breaks our rules, and **a person will read it.**"
- "We decide refunds, because we took the payment. **You can say what you think in the thread and we read it before deciding**; you cannot approve or refuse one."
- "Either you or a customer can raise a dispute, and raising one **brings us in immediately** rather than waiting for somebody to notice an escalation is due."
- "We decide it, and we record an outcome and a reason. Both of you are told what was decided, **in the same words.** A dispute that simply goes quiet is not an outcome we allow."

### 2.5 Where a human explicitly is *not* involved

Worth listing, because the rewrite must not blur the line.

| Where | Text |
|---|---|
| `features/requirements/components/listing-panel.tsx:129` | the assistant is not a person — "ask, and a person will tell you" |
| `features/requirements/actions.ts:163` | "**The assistant is unavailable.** Use the form to describe what you need." |
| `features/requirements/actions.ts:168` | "**The assistant is switched off.** Use the form to describe what you need." |
| `features/products/components/options-form.tsx:93` | "Off sends the customer **straight to a human.**" |
| `features/products/ai-authoring.ts:79` | "…or keep going **by hand**, which is what it was drafting from anyway." |
| `features/vendors/agreement.ts` | "Your rating is worked out from the reviews of everything you sell. **Nobody adjusts it — not you, not us.**" |

### 2.6 Reviewer-facing warnings that the customer reads it verbatim

These control the *quality* of the human-written text that reaches an inbox, so
they belong with the rest.

| Where | Text |
|---|---|
| `features/vendors/components/review-panel.tsx` | "**The applicant reads this verbatim.**" / "What was wrong, in words the vendor can act on." |
| `features/products/components/review-decision.tsx` | "**The vendor reads this word for word.** Required." / "Optional. The vendor reads this." |
| `features/products/components/review-decision.tsx` | "**Approving is not publishing** — it still has to pass the readiness gate, exactly like a first-party product." |
| `features/vendors/schemas.ts:214` | "Say why. **Somebody will read this a year from now.**" |

---

## Suggested order of work

1. **Close the two false promises** (§1.7) — either send an order/licence email
   or delete the sentences. This is the only item that is currently untrue.
2. **Rewrite V9/V10** (the two screenshots) as one arrival rather than two, and
   give "on sale" the storefront link and a share prompt.
3. **Replace the single "Open in CoSetup" label** with a per-row action label;
   the field already exists on every written email.
4. **Normalise the human-review vocabulary.** Today we say "somebody", "a
   person", "a reviewer" and "someone" across §2.1 for the same act. Pick one.
5. **Normalise the timing vocabulary** (§2.2): "usually within a working day"
   appears three times with three different framings, and the support target is
   enforced in hours while described in working days.
