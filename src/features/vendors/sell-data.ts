/**
 * The copy for `/sell`.
 *
 * ## Every claim here is traceable, and the ones that are not are absent
 *
 * A vendor page is the easiest place on a marketplace to write something flattering
 * and untrue, so this module is deliberately conservative. Three rules held while
 * writing it:
 *
 * 1. **No figure that is not in the code.** No vendor count, no storefront count, no
 *    total paid out, no rating, no uptime, no "join N developers". The storefront
 *    service refuses to publish even one vendor's commercial data; a platform-wide
 *    aggregate would be a stronger version of the same disclosure.
 * 2. **No revenue share.** The agreement says "a percentage", and it says the standard
 *    rate "may be varied for an individual vendor". The platform default is a settings
 *    row an admin can change, and there is a per-vendor override on top of it — so a
 *    number printed here is a number with no link back to the thing that changes it.
 *    The vendor's own effective rate, and where it came from, is on their earnings
 *    screen, which is the only place it can be resolved.
 * 3. **No claim the platform does not implement.** In particular: not invoices (a
 *    marketplace sale produces an order, entitlements and licences — `invoice-service`
 *    only ever writes quote-sourced invoices), not VAT (not modelled at all), and not
 *    automatic payouts (`manual` is the only driver, and draft-to-approved is a human
 *    transition on purpose).
 *
 * The two numbers that *are* safe are the clearance and refund windows, because
 * `ledger-service.ts` asserts their relationship at module load — the process would
 * fail to boot before they could drift apart.
 */

/** The commercial half of a sale, which is what a vendor is actually buying here. */
export const WE_HANDLE = [
  {
    icon: "card",
    title: "Checkout and payment",
    body: "We are the seller of record. The customer buys from us and pays us, which is why you never hold their money and never chase it.",
  },
  {
    icon: "receipt",
    title: "Tax, worked out at checkout",
    body: "The rate is decided by where the customer is and what they bought. You price your software; the tax is not your problem and not our revenue.",
  },
  {
    icon: "key",
    title: "Licence keys",
    body: "Issued on payment, with a check character built in — so a key read down a phone line is caught before it fails. Activation limits come from the package you set.",
  },
  {
    icon: "download",
    title: "Delivery, from our storage",
    body: "We mirror every release and serve the customer from our own copy. Your uptime is never their problem, and a release whose bytes have not arrived is not released.",
  },
  {
    icon: "shield",
    title: "Refunds and chargebacks",
    body: "Ours to answer, because the customer bought from us. A refund claws the earning back rather than leaving your balance wrong.",
  },
  {
    icon: "globe",
    title: "A storefront of your own",
    body: "A public page at your own address, with your products, your rating and how long you have been selling. Indexable, and in the sitemap.",
  },
] as const;

/**
 * The four steps, unchanged from the page they came from.
 *
 * These were already specific and honest — "Somebody reads every application" and "A
 * government ID and a proof of address" are the two sentences an applicant most needs
 * — so they are moved rather than rewritten. Only the presentation changes.
 */
export const STEPS = [
  {
    title: "Apply",
    body: "Tell us who you are and what you build. Somebody reads every application — this is not an automatic sign-up.",
  },
  {
    title: "Verify your identity",
    body: "A government ID and a proof of address. This is what lets you list a product. Business details come later, and only matter when we pay you.",
  },
  {
    title: "List your first product",
    body: "The same tools our own catalogue is built with. A reviewer checks it before it goes on sale, and tells you what to change if it isn't ready.",
  },
  {
    title: "Get paid",
    body: "Earnings accrue as customers buy. Once they clear, they're paid out on a schedule you can see.",
  },
] as const;

/**
 * What happens after the first sale — the page's signature argument.
 *
 * The brand guide sets out what a vendor should understand, in order: that they can
 * sell software here, then that customers can ask for modifications and services
 * around their products, then that there is commercial life beyond the original sale.
 * Only the first was on the page before this.
 *
 * ## Three of these are revenue and one is not, and they are separated for that reason
 *
 * Customisation, plugins and setup work are all things a vendor is *paid* for — the
 * first through a routed brief they quote, the other two through add-ons they price on
 * their own product and earn on at their licence rate. Support and reviews are the
 * relationship rather than the revenue: a vendor answers questions about their own
 * software because they wrote it, and that is an obligation in the agreement, not an
 * income stream. Presenting all four as "more ways to earn" would be the kind of
 * quiet overclaim this page is trying not to make.
 */
export const PAID_AFTER_SALE = [
  {
    icon: "wrench",
    title: "Get paid for customisation",
    body: "When a customer wants your product adapted, the request comes to you to scope and price. You quote the work; we route it and handle the money.",
  },
  {
    icon: "plug",
    title: "Sell plugins alongside it",
    body: "Package extra functionality as a paid add-on instead of folding every request into the original product. You set the price and earn at your licence rate.",
  },
  {
    icon: "settings",
    title: "Charge for setup and integration",
    body: "Getting it running inside somebody else's business is work. Price it as an add-on on your own listing rather than giving it away with the licence.",
  },
] as const;

/** The half of the relationship that is not revenue, and is not dressed up as it. */
export const RELATIONSHIP_AFTER_SALE = [
  {
    title: "Support stays with you",
    body: "You answer questions about your own software first — you wrote it. We watch the thread rather than running it, and customers see a first-response target before they open one.",
  },
  {
    title: "Reviews you can reply to",
    body: "Only customers who actually bought can leave one, and your public answer is often more useful to the next buyer than the review itself.",
  },
] as const;

/**
 * The payout timeline, as four beats.
 *
 * A vendor's first question about any marketplace is when the money actually
 * arrives, and the honest answer has a shape: the sale, the wait, the point it
 * becomes payable, the run that pays it. Shown as a strip rather than prose because
 * the shape *is* the answer.
 *
 * Thirty days is safe to print. `ledger-service` asserts at module load that the
 * clearance window exceeds the refund window, so the process would fail to boot
 * before those two could drift apart.
 */
export const PAYOUT_TIMELINE = [
  {
    label: "Sale",
    when: "Day 0",
    body: "The earning is recorded the moment the customer's payment succeeds.",
  },
  {
    label: "Clearing",
    when: "30 days",
    body: "Held deliberately longer than the refund window, so nothing refundable is paid out.",
  },
  {
    label: "Payable",
    when: "Cleared",
    body: "It joins your available balance and is counted for the next run.",
  },
  {
    label: "Payout",
    when: "Next run",
    body: "Sent to your account, with a statement naming every earning in it.",
  },
] as const;

/** The three facts a vendor most needs to trust, kept short enough to scan. */
export const MONEY = [
  {
    title: "Your rate is fixed at the sale",
    body: "The commission is written onto the order when the customer buys and never read again. A change can only ever apply to future orders.",
  },
  {
    title: "Payouts run on a schedule you can see",
    body: "Once cleared and over the minimum, earnings go out on a regular run. If a run passes you over, your payouts screen says which and why.",
  },
  {
    title: "Every payout has a statement",
    body: "It names exactly which earnings it settles. We issue it on your behalf, because you never invoiced the customer. No tax is withheld — that part is yours.",
  },
] as const;

/**
 * The two checks, named for what each one unlocks.
 *
 * This replaced "Two checks, and only one of them holds you up" — which was true,
 * and made the reader work out which one. The thing an applicant actually needs is
 * the mapping: identity gates *listing*, payout details gate *money*, and the second
 * can be outstanding while you are already selling.
 */
export const CHECKS = [
  {
    title: "Identity verification",
    unlocks: "Before you can list",
    items: [
      "A photo ID — passport, driving licence or national ID card",
      "Proof of address from the last three months",
    ],
    body: "Usually decided within a working day, and it runs alongside your application rather than after it.",
  },
  {
    title: "Payout details",
    unlocks: "Before you can be paid",
    items: [
      "Your payout account, and a bank document naming it",
      "A tax reference, where you have one",
      "Company registration, if you sell as a company",
    ],
    body: "This one can wait. You can list, sell and earn while it is still being checked — the money waits in your balance.",
  },
] as const;

/** What a listing itself needs before a reviewer will pass it. */
export const LISTING_NEEDS = [
  "Screenshots and a description",
  "At least one licence package and price",
  "A released version with the application package uploaded",
] as const;

/**
 * The vendor account in the hero illustration.
 *
 * **Illustrative, and deliberately kept inside the mock.** These figures are not a
 * claim about what anyone earns — no vendor's earnings have been measured and a
 * page-level statistic would be invention. They sit inside a drawn dashboard panel
 * that is `aria-hidden`, which is what makes them a picture of *how being paid works*
 * rather than a number the page is asserting.
 *
 * The earlier version of this panel used grey skeleton bars for exactly that worry,
 * and it read as unfinished SaaS chrome instead of a vendor account. A believable
 * figure inside an obvious mock is the better trade.
 *
 * Product names are generic enough not to impersonate a real listing; the category
 * labels are real terms from the taxonomy, so nothing here names a shelf the
 * catalogue does not have.
 */
export const MOCK_ACCOUNT = {
  available: 184_260,
  clearing: 42_600,
  nextPayout: "04 Sep",
  currency: "GBP",
  products: [
    {
      name: "Hotel Management System",
      category: "Hospitality",
      price: 14_900,
      shot: "/brand/preview-client-manager.png",
    },
    {
      name: "Restaurant POS",
      category: "Retail",
      price: 7_900,
      shot: "/brand/preview-storefront.png",
    },
    {
      name: "Booking Platform",
      category: "Booking",
      price: 9_900,
      shot: "/brand/preview-shift-planner.png",
    },
  ],
} as const;

/** The vendor's journey, as the pills floating over the illustration. */
export const JOURNEY = ["Published", "Sold", "Paid"] as const;
