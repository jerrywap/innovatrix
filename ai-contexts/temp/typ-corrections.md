We have completed the communications review.

Do NOT independently rewrite, enhance, shorten, or reinterpret any copy.

Implement the exact copy replacements below.

CORE COPY PRINCIPLE

User-facing CoSetup communication should primarily communicate:

1. What happened
2. What it means
3. What the user should do, if anything
4. What happens next

Do not repeatedly advertise that a human/person/somebody is involved in an internal process.

Where human review is materially important to the meaning — particularly formal policy, disputes, moderation, verification, or where we explicitly distinguish a decision from automation — we can retain that fact, but express it naturally and professionally.

Prefer terms such as:
- "we'll review"
- "under review"
- "our review"
- "we'll let you know"

Avoid conversational implementation-language such as:
- "somebody reads every..."
- "a person reads..."
- "someone will pick it up..."
- "read it properly"
- "somebody is reading..."
- "nothing here is automatic"

Do not change staff-facing copy unless explicitly included below.

==================================================
1. VENDOR APPLICATION EMAIL — V1
   ==================================================

Replace the current vendor application acknowledgement with:

SUBJECT:
Thanks for applying to sell on CoSetup

PREHEADER:
Complete your identity verification while we review your application.

HEADING:
We've received your application

BODY PARAGRAPH 1:
Thanks for applying to sell on CoSetup as {displayName}. We'll review your application and email you when there's an update.

BODY PARAGRAPH 2:
While your application is being reviewed, you can complete your identity verification. Completing it now means you'll be ready to start listing products as soon as your application is approved.

ACTION:
Verify my identity

NOTE 1:
You'll need a passport, driving licence or national ID card, plus proof of address from the last three months, such as a bank statement, utility bill or council tax letter.

NOTE 2:
Payout verification is completed separately. You can start selling before it finishes, but earnings will remain in your CoSetup balance until your payout verification is complete.

Do not change the underlying application or verification workflow.

==================================================
2. PRODUCT APPROVED EMAIL — V9
   ==================================================

Keep this as a separate notification because "approved" and "published" are separate product states.

Replace with:

SUBJECT/TITLE:
{product} passed review

BODY:
Your product has passed review and is now being prepared for publication. There's nothing you need to do right now. We'll email you as soon as it's live.

ACTION:
View product

Do not describe internal "testing and readiness checks" in this email.

Do not merge ProductApproved and ProductPublished events.

==================================================
3. PRODUCT PUBLISHED EMAIL — V10
   ==================================================

Replace with:

SUBJECT/TITLE:
{product} is now live

BODY:
Your product is live on CoSetup and available for customers to buy.

ACTION:
View live product

The action must link to the public storefront/product URL, not merely a generic dashboard destination.

If productHref(p.productSlug) already resolves to the public product page, retain the URL implementation and only change the action label.

==================================================
4. CUSTOMER REQUEST SUBMITTED — C1
   ==================================================

Current:
"We'll come back to you once somebody has looked at it."

Replace with:
"We'll review your request and let you know what happens next."

==================================================
5. DISCOVERY INTRO
   ==================================================

Current:
"A person reads every request"

Replace with:
"Every request is reviewed"

Keep "Free discovery" unchanged.

==================================================
6. REQUIREMENTS REVIEW PANEL
   ==================================================

Current:
"Write down what you need, one line at a time. A person reads all of it."

Replace with:
"Write down what you need, one line at a time. Give us as much detail as you can — it helps us understand what you're looking for."

==================================================
7. SELLING APPLICATION PAGE
   ==================================================

Current:
"Tell us who you are and what you build. Somebody reads every application."

Replace with:
"Tell us who you are and what you build. We'll review your application and let you know when there's an update."

==================================================
8. SELL DATA — APPLICATION
   ==================================================

Current:
"Somebody reads every application — this is not an automatic sign-up."

Replace with:
"Applications are reviewed before a seller account is approved."

==================================================
9. SELL PAGE
   ==================================================

Current:
"Applying takes a few minutes. Nothing here is automatic — which is slower than a sign-up form, and the reason a buyer trusts what is on the shelf."

Replace with:
"Applying takes a few minutes. We review seller applications before approving them to sell on CoSetup."

==================================================
10. SELL DATA — PRODUCT REVIEW
    ==================================================

Current:
"A reviewer checks it before it goes on sale, and tells you what to change if it isn't ready."

Replace with:
"We'll review it before it goes on sale and let you know if anything needs to change."

==================================================
11. SELLING PRODUCTS PAGE
    ==================================================

Current:
"Create your first product. A reviewer checks it before it goes on sale."

Replace with:
"Create your first product and submit it for review. We'll let you know when it's ready to go live."

==================================================
12. PRODUCT SUBMIT PANEL
    ==================================================

Current:
"Somebody will read it and either put it on sale or tell you what to change. You can pull it back until a reviewer starts."

Replace with:
"We'll review your submission and either approve it or let you know what needs to change. You can withdraw it before the review begins."

==================================================
13. PRODUCT SUBMIT PANEL — INCOMPLETE ITEMS
    ==================================================

Current:
"Finish the items above first — a reviewer checks the same list."

Replace with:
"Finish the items above before submitting your product for review."

==================================================
14. REPORTED REVIEW
    ==================================================

Current:
"Reported. Somebody will read it."

Replace with:
"Reported. We'll review it and take action if it breaks our rules."

==================================================
15. REQUEST STATUS — SUBMITTED
    ==================================================

Current WHAT:
"We've got it."

Keep.

Current NEXT:
"Someone will pick it up and read it properly. Nothing needed from you."

Replace NEXT with:
"We'll review your request and let you know what happens next. Nothing needed from you."

==================================================
16. REQUEST STATUS — UNDER REVIEW
    ==================================================

Current WHAT:
"Someone is going through it."

Replace WHAT with:
"Your request is under review."

Current NEXT:
"We'll come back with questions or a quote."

Replace NEXT with:
"We'll come back to you with any questions or a quote."

==================================================
17. REQUEST STATUS — TECHNICAL REVIEW
    ==================================================

Current WHAT:
"Our technical team is scoping it."

Replace with:
"We're working out what your request will involve."

Current NEXT:
"They're working out what it takes. A quote follows."

Replace with:
"We'll send you a quote once the scope is ready."

==================================================
18. REQUEST STATUS — CONVERTED
    ==================================================

Current WHAT:
"Payment received — this is with our team."

Replace with:
"Payment received."

Current NEXT:
"We'll confirm when someone picks it up."

Replace with:
"We'll let you know when work starts."

==================================================
19. VENDOR APPLICATION — IN REVIEW STATUS
    ==================================================

Current:
"Somebody is reading your application now. Carry on with verification while they do — the two run side by side, and if we need anything else we'll ask by email."

Replace with:
"Your application is under review. You can continue with identity verification while you wait — the two run side by side. If we need anything else, we'll email you."

==================================================
20. PRODUCT WIZARD — APPROVED / PRE-PUBLICATION
    ==================================================

Current:
"In our hands — This has passed review and is going through our readiness checks. We will tell you when it is on sale."

Replace with:

TITLE/STATUS:
"Passed review"

DESCRIPTION:
"Your product has been approved and is being prepared for publication. We'll let you know when it's live."

==================================================
21. VENDOR VERIFICATION APPROVED EMAIL — V2
    ==================================================

Current:
"Somebody has checked the documents… and they are fine."

Replace the human-process sentence with:
"Your documents have been approved."

Keep the existing copy explaining what that verification level unlocks.

==================================================
22. DISPUTE EMAIL — V14
    ==================================================

Current:
"CoSetup will decide it. Add anything you want considered to the conversation — it is read before a decision is made."

Replace with:
"CoSetup will review the dispute and decide the outcome. Add anything you want us to consider to the conversation before a decision is made."

Human involvement remains implicit because CoSetup itself is taking responsibility for the decision.

==================================================
23. VENDOR SUPPORT THREAD — V13
    ==================================================

Current:
"You answer this one first — we are watching the thread rather than running it."

Replace with:
"This question is for you to answer. CoSetup can step in if support or escalation is needed."

==================================================
24. VERIFICATION PAGE
    ==================================================

Current:
"Somebody checks usually within a working day, and we'll email you as soon as there's an answer — whichever way it goes. If we need anything else, we'll ask in that email."

Replace with:
"Verification is usually completed within one working day. We'll email you as soon as there's an update, including if we need anything else from you."

Keep the separate:
"Usually decided within a working day."
where it functions as concise timing/status copy.

==================================================
25. FORMAL VENDOR AGREEMENT
    ==================================================

Do NOT broadly rewrite the vendor agreement using the marketing-copy rules above.

The agreement is formal product/legal policy and some statements about human review are materially meaningful.

However, make these specific wording replacements:

Current:
"Somebody reads every application. Being accepted is not automatic and we do not have to explain a rejection, though we will tell you plainly that it is one."

Replace:
"We review every application. Acceptance is not automatic, and we may decline an application without providing a detailed reason. We will always tell you when an application has been declined."

Current:
"The documents you upload are read by a person, and what they decided is recorded along with a checksum of what they read."

Replace:
"The documents you upload are reviewed as part of our verification process. We record the decision along with a checksum of the documents reviewed."

Current:
"A reviewer checks a product before it goes on sale."

Replace:
"Products are reviewed before they go on sale."

Keep the remainder explaining what the product review does and does not cover.

Current:
"a person will read it."

in the review-reporting provision:

Replace with:
"we will review it."

Current:
"You can say what you think in the thread and we read it before deciding"

Replace with:
"You can add anything you want us to consider to the thread before we decide."

Do not alter the substantive rights, responsibilities, refund rules, dispute rules, review moderation rules or limitations contained in the agreement.

==================================================
26. COPY THAT SHOULD NOT BE CHANGED
    ==================================================

Do not blindly remove references to people/humans everywhere.

Leave staff-facing operational terminology such as:
"Waiting for a reviewer"

Leave reviewer-facing instructions such as:
"The applicant reads this verbatim."
"The vendor reads this word for word."
"Approving is not publishing..."

These are internal operational instructions and are not part of the customer-facing tone problem.

Also leave intentional AI-vs-human controls alone for now, including copy such as:
"Off sends the customer straight to a human."

Those communicate an actual product behaviour rather than advertising the existence of human review.

==================================================
27. GENERIC EMAIL ACTION LABELS
    ==================================================

Do not perform a blind global replacement of "Open in CoSetup".

Change action labels when the event has an obvious action.

Examples:

ProductPublished:
"View live product"

ProductApproved:
"View product"

ProductChangesRequested:
"Review requested changes"

QuoteIssued:
"View quote"

InvoiceIssued:
"View invoice"

InvoiceDueSoon:
"View invoice"

InvoiceOverdue:
"View invoice"

ProductVersionReleased:
"View purchase"

CustomizationRoutedToVendor:
"View request"

VendorSupportThreadOpened:
"View message"

DisputeRaised:
"View dispute"

DisputeResolved:
"View dispute"

VendorPayoutPaid:
"View payout"

VendorPayoutFailed:
"Review payout"

For other notifications, inspect the existing destination and choose a short action label describing what the destination actually is. Do not change URLs unless the existing URL is incorrect.

==================================================
28. FALSE EMAIL PROMISES / MISSING EMAILS
    ==================================================

Do NOT delete these promises:

"A receipt lands in your inbox."

and:

"We'll email you when that happens."

Instead, implement the missing customer transactional communication.

At minimum:

ORDER COMPLETED / PURCHASE CONFIRMATION

Subject:
Your CoSetup order {ref} is confirmed

Heading:
Your order is confirmed

Body:
We've received your payment for {product/order description}. Your purchase is ready in CoSetup.

Action:
View my purchase

If downloadable items are immediately available, the destination should take the customer to the purchase/download area.

LICENCE ISSUED

Subject:
Your licence for {product} is ready

Heading:
Your licence is ready

Body:
Your licence for {product} is now available in CoSetup.

Action:
View licence

Do not expose licence keys directly in email unless the existing security/product requirements explicitly permit this. Link to the authenticated location containing the licence.

If OrderCompleted and LicenceIssued can occur together and would produce redundant emails within seconds of one another, inspect the fulfilment flow before implementation and avoid sending duplicate customer communication. Prefer the order confirmation to explain that downloads/licences are ready when fulfilment is synchronous.

==================================================
IMPLEMENTATION REQUIREMENTS
==================================================

Before changing code:

1. Map every replacement above to its exact current source location.
2. Confirm placeholders such as {displayName}, {product}, {vendor}, {ref}, etc. against the actual event payload. Do not invent unavailable data.
3. Preserve notification categories and preference behaviour.
4. Preserve essential/security notification behaviour.
5. Preserve event semantics.
6. Do not merge ProductApproved and ProductPublished.
7. Do not change application/review/verification business logic merely to accommodate copy.
8. Add/update tests for changed email copy where tests currently assert these strings.
9. Add appropriate tests for any newly wired OrderCompleted/LicenceIssued customer notifications.
10. Search the repository again after implementation for the OLD EXACT STRINGS listed above and report any remaining occurrences.

When finished, report:

- files changed
- replacements completed
- old strings that still exist and why
- new notification handlers/events added
- tests added/updated
- test results
- any replacement that could not be implemented exactly because the required data or destination does not exist

Do not make additional copy changes outside this specification.
