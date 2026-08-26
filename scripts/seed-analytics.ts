/**
 * Thirteen months of plausible trading history, so the dashboards have a shape.
 *
 *   npm run db:seed:analytics
 *   npm run db:seed:analytics -- --purge
 *   npm run db:seed:analytics -- --force      # a non-local database, deliberately
 *
 * ## Why this exists
 *
 * Every transactional collection on a dev machine holds single digits inside one
 * week — ten orders, three quotes, three invoices, no payouts. A revenue chart
 * over that is a dot, an ageing histogram is one bar, and a period-on-period
 * delta is a division by zero. None of the reporting work is *visible* without
 * history, and none of it can be judged on a screen that shows a dot.
 *
 * ## What keeps it honest
 *
 * - **Inserts only.** Not one existing document is modified, so `--purge` is a
 *   complete undo rather than a best effort. That is also why the "top products"
 *   panel derives from order lines instead of reading `Product.orderCount`: the
 *   derived figure is the correct one anyway (§103 — a stored counter is a second
 *   source of truth that drifts) and it means this script never has to touch the
 *   catalogue.
 * - **A manifest, not a naming convention.** Every inserted `_id` is recorded in
 *   `seedManifests`, and `--purge` deletes exactly those. Tagging by reference
 *   prefix or by an `idempotencyKey` pattern only works on the collections that
 *   happen to have such a field, and gets a collection wrong the moment one is
 *   added.
 * - **No `auditLogs`.** The audit trail is append-only precisely because its
 *   value is being trustworthy, and forging one is a different kind of act from
 *   generating demo revenue. The audit panel therefore shows real history only,
 *   which is about a week of it — correct, and visibly so.
 * - **Validated before it is written.** Each document goes through
 *   `new Model(doc).validateSync()` and is then inserted with the raw driver.
 *   That is the only way to back-date `createdAt` — Mongoose's `timestamps: true`
 *   overwrites it — without giving up the enum and required checks. `seed-bulk.ts`
 *   records what skipping them costs: a `"single_site"` licence type wrote
 *   cleanly through `bulkWrite` and only surfaced at checkout.
 * - **Deterministic.** A fixed PRNG seed, so two runs produce the same history
 *   and a chart that looks wrong can be looked at twice.
 *
 * ## Why the distribution has a shape
 *
 * Uniform noise makes every chart look like the same grey band, which tests
 * nothing: a trend line, a period-on-period delta and a seasonality read all
 * need there to be a trend and a season. So volume grows over the window and
 * dips at weekends, and statuses are weighted the way a real funnel narrows.
 */
import "dotenv/config";
import mongoose from "mongoose";
// The barrel, for its side effect: it registers every model, which is what
// `mongoose.model(name)` looks up in `insert()` below.
import "../src/lib/db/models/index";
import { MongoCounterStore } from "../src/lib/db/counter-store";
import { generateReference, type ReferencePrefix } from "../src/lib/references";

const PURGE = process.argv.includes("--purge");
const FORCE = process.argv.includes("--force");

/** The window. Thirteen so a twelve-month chart has a full previous period to compare against. */
const MONTHS = 13;

const MANIFEST_ID = "analytics";
const MANIFEST_COLLECTION = "seedManifests";

/** How many customer organizations arrive across the window. */
const NEW_ORGS = 46;

/* ────────────────────────────────────────────── determinism */

/**
 * mulberry32 — small, fast, and good enough for demo data.
 *
 * Not `Math.random()`: a seed whose output changes every run cannot be reviewed.
 * When a panel looks wrong, the first question is whether the data or the chart
 * is at fault, and that question needs the data to hold still.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260826);

const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const between = (min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));

/** A weighted draw: `[["paid", 6], ["cancelled", 1]]`. */
function weighted<T extends string>(options: ReadonlyArray<readonly [T, number]>): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1]![0];
}

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

/* ────────────────────────────────────────────── the run */

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");
  assertLocal(uri);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connecting.");
  const manifests = db.collection(MANIFEST_COLLECTION);

  if (PURGE) {
    const existing = await manifests.findOne({ _id: MANIFEST_ID as never });
    if (!existing) {
      console.log("Nothing to purge — no analytics seed manifest found.");
      await mongoose.disconnect();
      return;
    }

    const ids = existing.ids as Record<string, mongoose.Types.ObjectId[]>;
    let removed = 0;
    for (const [collection, list] of Object.entries(ids)) {
      if (list.length === 0) continue;
      const result = await db.collection(collection).deleteMany({ _id: { $in: list } });
      console.log(`  ${collection.padEnd(18)} -${result.deletedCount}`);
      removed += result.deletedCount;
    }
    await manifests.deleteOne({ _id: MANIFEST_ID as never });
    console.log(`\nPurged ${removed} seeded documents. Nothing else was touched.`);
    await mongoose.disconnect();
    return;
  }

  if (await manifests.findOne({ _id: MANIFEST_ID as never })) {
    console.log(
      "Already seeded — nothing to do.\n" +
        "Run with `-- --purge` first if you want a fresh history.",
    );
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));

  const catalogue = await loadCatalogue();
  if (catalogue.length === 0) {
    throw new Error(
      "No published products with prices — run `npm run db:seed` (and optionally " +
        "`db:seed:bulk`) before seeding analytics history.",
    );
  }
  const staffIds = await loadStaffIds();

  console.log(
    `Seeding ${MONTHS} months from ${from.toISOString().slice(0, 10)} ` +
      `over ${catalogue.length} products and ${staffIds.length} staff.\n`,
  );

  // Opened empty, so `insert()` has somewhere to record each batch before it
  // writes it. A crash then leaves a purgeable manifest rather than orphans.
  await manifests.insertOne({
    _id: MANIFEST_ID as never,
    seededAt: new Date(),
    months: MONTHS,
    ids: {},
  });

  const customers = buildCustomers(from, now);
  const orders = buildOrders(customers, catalogue, from, now);
  const payments = buildPayments(orders);
  const requests = buildRequests(customers, catalogue, staffIds, from, now);
  const quotes = buildQuotes(requests, now);
  const invoices = buildInvoices(quotes, now);

  await assignReferences(orders, "ORD");
  await assignReferences(payments, "PAY");
  await assignReferences(requests, null); // REQ or CUS, per kind
  await assignReferences(quotes, "QUO");
  await assignReferences(invoices, "INV");

  await insert("Organization", "organizations", customers.orgs);
  await insert("User", "users", customers.users);
  await insert("OrganizationMember", "organizationMembers", customers.members);
  await insert("Order", "orders", orders);
  await insert("Payment", "payments", payments);
  await insert("CustomerRequest", "customerRequests", requests);
  await insert("Quote", "quotes", quotes);
  await insert("Invoice", "invoices", invoices);

  const written = await manifests.findOne({ _id: MANIFEST_ID as never });
  const total = Object.values((written?.ids ?? {}) as Record<string, unknown[]>).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  console.log(
    `\n${total} documents inserted. Run with \`-- --purge\` to remove exactly these.`,
  );

  await mongoose.disconnect();
}

/* ────────────────────────────────────────────── guards */

/**
 * Refuse a database that is not obviously local.
 *
 * The one mistake here that cannot be undone is pointing a revenue generator at
 * something real, and the cost of the guard is one flag when somebody genuinely
 * means it. `--force` is deliberately not a short option.
 */
function assertLocal(uri: string): void {
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb\+srv:/, "mongodb:")).hostname;
    } catch {
      return "";
    }
  })();

  const local = host === "localhost" || host === "127.0.0.1" || host === "mongo" || host === "";
  if (local || FORCE) return;

  console.error(
    `Refusing to write demo history to "${host}".\n` +
      "This inserts hundreds of fabricated orders, payments and invoices. If that " +
      "is genuinely what you want here, re-run with --force.",
  );
  process.exit(1);
}

/* ────────────────────────────────────────────── existing data */

interface CatalogueEntry {
  productId: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  vendorId?: mongoose.Types.ObjectId;
  pkg: {
    key: string;
    name: string;
    licenceType: string;
    activationLimit?: number;
    supportMonths?: number;
    updateMonths?: number;
  };
  prices: Array<{ currency: string; amount: number }>;
}

async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const db = mongoose.connection.db!;
  const rows = await db
    .collection("products")
    .find(
      { status: "published", deletedAt: null, "licencePackages.0": { $exists: true } },
      { projection: { name: 1, slug: 1, vendorId: 1, licencePackages: 1 } },
    )
    // Enough variety for a "top products" ranking to mean something, few enough
    // that the same names recur and a ranking is possible at all.
    .limit(60)
    .toArray();

  const entries: CatalogueEntry[] = [];
  for (const row of rows) {
    for (const pkg of (row.licencePackages ?? []) as CatalogueEntry["pkg"][] &
      Array<{ prices?: Array<{ currency: string; amount: number }> }>) {
      const prices = (pkg.prices ?? []).filter(
        (price) =>
          price.currency === "GBP" || price.currency === "USD" || price.currency === "EUR",
      );
      if (prices.length === 0 || !pkg.licenceType) continue;
      entries.push({
        productId: row._id as mongoose.Types.ObjectId,
        name: String(row.name),
        slug: String(row.slug),
        ...(row.vendorId ? { vendorId: row.vendorId as mongoose.Types.ObjectId } : {}),
        pkg,
        prices,
      });
    }
  }
  return entries;
}

async function loadStaffIds(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await mongoose.connection
    .db!.collection("users")
    .find({ isStaff: true }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((row) => row._id as mongoose.Types.ObjectId);
}

/* ────────────────────────────────────────────── customers */

const FIRST = [
  "Amara",
  "Tobias",
  "Ruth",
  "Diego",
  "Mei",
  "Kwame",
  "Sofia",
  "Owen",
  "Nadia",
  "Ivan",
  "Priya",
  "Louis",
];
const LAST = [
  "Nwosu",
  "Halvorsen",
  "Adeyemi",
  "Marquez",
  "Chen",
  "Boateng",
  "Rossi",
  "Fletcher",
  "Karimi",
  "Petrov",
  "Menon",
  "Dubois",
];
const COMPANY = [
  "Northwind",
  "Kestrel",
  "Harbour",
  "Lantern",
  "Copperfield",
  "Meridian Bay",
  "Ashgrove",
  "Silverbrook",
  "Tidewater",
  "Fernbank",
  "Oakhurst",
  "Cobalt",
  "Pinegate",
  "Larkspur",
  "Ravensworth",
  "Halcyon",
];
const SUFFIX = [
  "Group",
  "Logistics",
  "Clinics",
  "Studios",
  "Partners",
  "Foods",
  "Rail",
  "Care",
  "Works",
  "Supply",
];

interface Customers {
  orgs: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  /** `(organizationId, userId)` pairs with the date the organization existed from. */
  pairs: Array<{
    organizationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    since: Date;
  }>;
}

/**
 * Organizations arriving steadily across the window, each with one contact.
 *
 * An order needs both an `organizationId` and a `userId`, and "new customers over
 * time" needs the organization's own `createdAt` to be spread — so the two are
 * built together rather than borrowing the three organizations that already
 * exist, which would put every signup in the same fortnight.
 */
function buildCustomers(from: Date, now: Date): Customers {
  const span = now.getTime() - from.getTime();
  const orgs: Customers["orgs"] = [];
  const users: Customers["users"] = [];
  const members: Customers["members"] = [];
  const pairs: Customers["pairs"] = [];

  for (let index = 0; index < NEW_ORGS; index += 1) {
    // Skewed towards the recent end: a growing platform signs up more customers
    // this quarter than it did a year ago, and a flat signup line would make the
    // growth in every other chart look unexplained.
    const position = Math.pow(random(), 0.65);
    const createdAt = new Date(from.getTime() + position * span);

    const name = `${pick(COMPANY)} ${pick(SUFFIX)}`;
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`;
    const orgId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const person = `${pick(FIRST)} ${pick(LAST)}`;

    orgs.push({
      _id: orgId,
      name,
      slug,
      billingEmail: `accounts@${slug}.example`,
      defaultCurrency: weighted([
        ["GBP", 6],
        ["USD", 3],
        ["EUR", 2],
      ]),
      isPersonal: false,
      customerSince: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    users.push({
      _id: userId,
      // `.example` is reserved by RFC 2606, so a stray notification cannot reach
      // a real inbox even if one were ever sent.
      email: `${person.toLowerCase().replace(/[^a-z]+/g, ".")}.${index + 1}@${slug}.example`,
      name: person,
      emailVerified: true,
      isStaff: false,
      locale: "en-GB",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    });

    members.push({
      _id: new mongoose.Types.ObjectId(),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt,
      updatedAt: createdAt,
    });

    pairs.push({ organizationId: orgId, userId, since: createdAt });
  }

  return { orgs, users, members, pairs };
}

/* ────────────────────────────────────────────── orders */

/**
 * Weekday seasonality. Business software is bought on working days, and a chart
 * with no weekly rhythm is one nobody can sanity-check against a calendar.
 */
const WEEKDAY = [0.35, 1.15, 1.2, 1.15, 1.1, 0.95, 0.5];

function buildOrders(
  customers: Customers,
  catalogue: CatalogueEntry[],
  from: Date,
  now: Date,
): Array<Record<string, unknown>> {
  const orders: Array<Record<string, unknown>> = [];
  const days = Math.round((now.getTime() - from.getTime()) / DAY);

  for (let day = 0; day < days; day += 1) {
    const date = addDays(from, day);
    // Linear growth across the window, so a period-on-period delta has something
    // to report and the twelve-month view has a direction.
    const trend = 0.9 + (day / days) * 2.6;
    const expected = trend * WEEKDAY[date.getUTCDay()]!;
    const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);

    for (let n = 0; n < count; n += 1) {
      const eligible = customers.pairs.filter((pair) => pair.since <= date);
      if (eligible.length === 0) continue;
      const customer = pick(eligible);
      const entry = pick(catalogue);
      const price = pick(entry.prices);
      const quantity = weighted([
        ["1", 8],
        ["2", 2],
        ["3", 1],
      ]);
      const units = Number(quantity);

      const createdAt = addMinutes(date, between(8 * 60, 19 * 60));
      const lineTotal = price.amount * units;

      /*
       * Weighted the way a funnel narrows, and time-aware: `awaiting_payment` is
       * only plausible for a recent order. A year-old order still awaiting a bank
       * transfer would be a real operational problem, and seeding one puts a
       * permanent false alarm at the top of the dashboard.
       */
      const recent = now.getTime() - createdAt.getTime() < 21 * DAY;
      const status = recent
        ? weighted([
            ["paid", 5],
            ["fulfilled", 4],
            ["awaiting_payment", 4],
            ["cancelled", 1],
          ])
        : weighted([
            ["fulfilled", 12],
            ["paid", 3],
            ["cancelled", 1],
            ["refunded", 1],
          ]);

      const paid = status === "paid" || status === "fulfilled" || status === "refunded";
      const paidAt = paid ? addMinutes(createdAt, between(2, 720)) : undefined;

      orders.push({
        _id: new mongoose.Types.ObjectId(),
        organizationId: customer.organizationId,
        userId: customer.userId,
        currency: price.currency,
        items: [
          {
            lineId: `sl-${orders.length}-1`,
            kind: "product_licence",
            productId: entry.productId,
            productName: entry.name,
            productSlug: entry.slug,
            licencePackageKey: entry.pkg.key,
            licencePackageName: entry.pkg.name,
            licenceType: entry.pkg.licenceType,
            ...(entry.pkg.activationLimit
              ? { activationLimit: entry.pkg.activationLimit }
              : {}),
            ...(entry.pkg.supportMonths ? { supportMonths: entry.pkg.supportMonths } : {}),
            ...(entry.pkg.updateMonths ? { updateMonths: entry.pkg.updateMonths } : {}),
            ...(entry.vendorId ? { vendorId: entry.vendorId } : {}),
            quantity: units,
            unitPrice: { amount: price.amount, currency: price.currency },
            lineTotal: { amount: lineTotal, currency: price.currency },
          },
        ],
        subtotal: { amount: lineTotal, currency: price.currency },
        total: { amount: lineTotal, currency: price.currency },
        status,
        paymentMethod: weighted([
          ["online", 8],
          ["offline", 2],
        ]),
        ...(paidAt ? { paidAt } : {}),
        ...(status === "fulfilled" && paidAt
          ? { fulfilledAt: addMinutes(paidAt, between(1, 90)) }
          : {}),
        idempotencyKey: `seed-analytics:order:${orders.length}`,
        createdAt,
        updatedAt: paidAt ?? createdAt,
      });
    }
  }

  return orders;
}

/**
 * One payment per order that got as far as needing one.
 *
 * A cancelled order never had a payment attempt in this history — modelling a
 * failed attempt *and* a cancellation would be two facts where one will do, and
 * the payment-outcomes panel already gets its failures from the recent
 * `awaiting_payment` band.
 */
function buildPayments(orders: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const payments: Array<Record<string, unknown>> = [];

  for (const order of orders) {
    const status = order.status as string;
    if (status === "cancelled") continue;

    const total = order.total as { amount: number; currency: string };
    const createdAt = (order.paidAt ?? order.createdAt) as Date;

    const paymentStatus =
      status === "refunded"
        ? "refunded"
        : status === "awaiting_payment"
          ? weighted([
              ["pending", 6],
              ["failed", 2],
              ["requires_review", 1],
            ])
          : "succeeded";

    payments.push({
      _id: new mongoose.Types.ObjectId(),
      organizationId: order.organizationId,
      subjectType: "order",
      subjectId: order._id,
      amount: { amount: total.amount, currency: total.currency },
      provider:
        order.paymentMethod === "offline"
          ? "manual"
          : weighted([
              ["stripe", 6],
              ["paystack", 2],
              ["paypal", 1],
            ]),
      providerRef: `seed-analytics-${payments.length}`,
      status: paymentStatus,
      ...(paymentStatus === "succeeded" || paymentStatus === "refunded"
        ? { paidAt: createdAt, verifiedAt: createdAt }
        : {}),
      createdAt,
      updatedAt: createdAt,
    });
  }

  return payments;
}

/* ────────────────────────────────────────────── requests, quotes, invoices */

const PROBLEMS = [
  "Bookings arrive by WhatsApp and nothing reconciles at month end",
  "Two people re-key the same delivery notes into different spreadsheets",
  "Nobody can tell which snags on a site are actually closed",
  "Parents chase us for statements we produce by hand",
  "Returns are logged on paper and the warehouse never sees them",
  "Expenses come in as photos and finance retypes every one",
  "Our rota is a spreadsheet and shift swaps get lost",
  "Stock counts disagree between the shop and the store room",
  "Every quote is rebuilt from scratch in Word",
  "Case notes live in six inboxes",
];

const CHANGES = [
  "We need it in our own branding before staff will use it",
  "The reports do not show the one number our board asks for",
  "It needs to talk to the accounting package we already pay for",
  "We need a second approval step before anything is sent out",
  "The payment methods it offers are not the ones our customers use",
  "We need per-site permissions rather than one shared login",
];

function buildRequests(
  customers: Customers,
  catalogue: CatalogueEntry[],
  staffIds: mongoose.Types.ObjectId[],
  from: Date,
  now: Date,
): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [];
  const span = now.getTime() - from.getTime();

  for (let index = 0; index < 210; index += 1) {
    const position = Math.pow(random(), 0.7);
    const submittedAt = new Date(from.getTime() + position * span);
    const eligible = customers.pairs.filter((pair) => pair.since <= submittedAt);
    if (eligible.length === 0) continue;
    const customer = pick(eligible);

    const kind = weighted([
      ["custom_build", 6],
      ["customization", 4],
    ]);
    const ageDays = (now.getTime() - submittedAt.getTime()) / DAY;

    /*
     * Old requests have resolved; recent ones are still moving. Without the age
     * split, the ageing histogram fills its 15+ band with work that closed
     * months ago and the queue looks permanently on fire.
     */
    const status =
      ageDays > 60
        ? weighted([
            ["completed", 8],
            ["delivered", 2],
            ["converted", 2],
            ["rejected", 2],
            ["cancelled", 1],
          ])
        : ageDays > 21
          ? weighted([
              ["in_progress", 5],
              ["converted", 3],
              ["approved", 2],
              ["quoted", 2],
              ["rejected", 1],
            ])
          : weighted([
              ["submitted", 5],
              ["under_review", 3],
              ["technical_review", 2],
              ["waiting_for_customer", 3],
              ["quoted", 2],
            ]);

    const open = [
      "submitted",
      "under_review",
      "waiting_for_customer",
      "technical_review",
      "quoted",
    ].includes(status);
    // A brand-new arrival has not been picked up yet, which is what fills the
    // "nobody has these yet" queue the staff dashboard leads with.
    const assigned = status !== "submitted" && random() < 0.82;
    const base = kind === "customization" ? pick(catalogue) : undefined;
    const title = kind === "custom_build" ? pick(PROBLEMS) : pick(CHANGES);
    const updatedAt = open
      ? new Date(submittedAt.getTime() + random() * Math.min(ageDays, 30) * DAY)
      : addDays(submittedAt, between(10, 60));

    requests.push({
      _id: new mongoose.Types.ObjectId(),
      kind,
      organizationId: customer.organizationId,
      userId: customer.userId,
      title,
      ...(base ? { baseProductId: base.productId } : {}),
      customerRequirements: [
        { key: `req-${index}-1`, label: title, origin: "confirmed", acceptedByCustomer: true },
      ],
      assumptions: [],
      requirementsVersion: 1,
      requirementsHistory: [],
      attachments: [],
      status,
      submittedAt,
      ...(open
        ? { waitingOn: status === "waiting_for_customer" ? "customer" : "innovatrix" }
        : {}),
      ...(assigned && staffIds.length > 0
        ? { currentAssigneeUserId: pick(staffIds), assignments: [] }
        : { assignments: [] }),
      quoteIds: [],
      createdAt: addMinutes(submittedAt, -between(4, 90)),
      updatedAt: updatedAt > now ? now : updatedAt,
    });
  }

  return requests;
}

/**
 * A quote for the requests that got that far.
 *
 * `issuedAt` is what the "how long from request to quote" figure measures
 * against `submittedAt`, so the gap is drawn with a long tail rather than a flat
 * spread — a median and a p90 that sit on top of each other say nothing.
 */
function buildQuotes(
  requests: Array<Record<string, unknown>>,
  now: Date,
): Array<Record<string, unknown>> {
  const quotes: Array<Record<string, unknown>> = [];
  const quotable = [
    "quoted",
    "approved",
    "converted",
    "in_progress",
    "delivered",
    "completed",
    "rejected",
  ];

  for (const request of requests) {
    if (!quotable.includes(request.status as string)) continue;
    if (random() > 0.86) continue;

    const submittedAt = request.submittedAt as Date;
    // Long-tailed: most within a week, a few dragging past a month.
    const lag = Math.max(1, Math.round(Math.pow(random(), 2.2) * 34) + 1);
    const issuedAt = addDays(submittedAt, lag);
    if (issuedAt > now) continue;

    const currency = weighted([
      ["GBP", 6],
      ["USD", 3],
      ["EUR", 2],
    ]);
    const amount = between(18, 240) * 25_000;
    const drawn = weighted([
      ["accepted", 5],
      ["issued", 2],
      ["rejected", 2],
      ["expired", 1],
      ["superseded", 1],
    ]);
    const wouldAcceptAt = drawn === "accepted" ? addDays(issuedAt, between(1, 21)) : undefined;
    /*
     * A quote drawn as accepted whose acceptance would fall in the future is
     * still out, not accepted. Letting the status through without the timestamp
     * is what produced an `accepted` quote with no `acceptedAt` — a shape the
     * invoice builder reasonably assumed could not exist, and the application
     * would make the same assumption.
     */
    const accepted = wouldAcceptAt !== undefined && wouldAcceptAt <= now;
    const status = drawn === "accepted" && !accepted ? "issued" : drawn;
    const acceptedAt = accepted ? wouldAcceptAt : undefined;

    quotes.push({
      _id: new mongoose.Types.ObjectId(),
      organizationId: request.organizationId,
      requestId: request._id,
      version: 1,
      title: `Scope and build — ${String(request.title).slice(0, 48)}`,
      items: [
        {
          kind: "development",
          description: "Design, build and handover",
          quantity: 1,
          unitPrice: { amount, currency },
          lineTotal: { amount, currency },
        },
      ],
      currency,
      subtotal: { amount, currency },
      total: { amount, currency },
      status,
      paymentTerms: weighted([
        ["deposit_balance", 6],
        ["milestones", 3],
        ["full_upfront", 1],
      ]),
      issuedAt,
      expiresAt: addDays(issuedAt, 30),
      ...(acceptedAt ? { acceptedAt } : {}),
      createdAt: addMinutes(issuedAt, -between(30, 600)),
      updatedAt: acceptedAt ?? issuedAt,
    });
  }

  return quotes;
}

/**
 * An invoice per accepted quote, with a realistic spread of overdue.
 *
 * The ageing panel is only worth building if some invoices are genuinely late,
 * and `amountPaid` short of `total` is the `partially_paid` case the outstanding
 * figure has to net off — which is the arithmetic `staffHeadline` already does
 * and the one place a rounding mistake would be visible as money.
 */
function buildInvoices(
  quotes: Array<Record<string, unknown>>,
  now: Date,
): Array<Record<string, unknown>> {
  const invoices: Array<Record<string, unknown>> = [];

  for (const quote of quotes) {
    if (quote.status !== "accepted") continue;
    const issuedAt = addDays(quote.acceptedAt as Date, between(0, 4));
    if (issuedAt > now) continue;

    const total = quote.total as { amount: number; currency: string };
    const dueAt = addDays(issuedAt, 30);
    const overdue = dueAt < now;

    const status = overdue
      ? weighted([
          ["paid", 7],
          ["overdue", 2],
          ["partially_paid", 1],
        ])
      : weighted([
          ["paid", 4],
          ["issued", 5],
          ["partially_paid", 1],
        ]);

    const amountPaid =
      status === "paid"
        ? total.amount
        : status === "partially_paid"
          ? Math.round(total.amount * (0.2 + random() * 0.5))
          : 0;

    invoices.push({
      _id: new mongoose.Types.ObjectId(),
      organizationId: quote.organizationId,
      sourceType: "quote",
      sourceId: quote._id,
      portion: "full",
      items: quote.items,
      currency: total.currency,
      subtotal: { amount: total.amount, currency: total.currency },
      total: { amount: total.amount, currency: total.currency },
      amountPaid: { amount: amountPaid, currency: total.currency },
      status,
      issuedAt,
      dueAt,
      ...(status === "paid" ? { paidAt: addDays(issuedAt, between(1, 34)) } : {}),
      remindersSentAt: [],
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
  }

  return invoices;
}

/* ────────────────────────────────────────────── writing */

/**
 * References, in the year the document is dated.
 *
 * `generateReference` takes the year for exactly this reason — its own comment
 * says "so a back-dated import can produce references in the right year". A
 * 2025 order numbered `ORD-2026-0102` would be the sort of detail that makes a
 * demo unbelievable at the worst moment.
 *
 * The shared `counters` collection is used rather than an in-memory store, so
 * seeded references cannot collide with real ones. `--purge` does not roll the
 * counters back, which is correct: a reference is never reissued.
 */
async function assignReferences(
  docs: Array<Record<string, unknown>>,
  prefix: ReferencePrefix | null,
): Promise<void> {
  const store = new MongoCounterStore();
  for (const doc of docs) {
    const dated = (doc.submittedAt ?? doc.issuedAt ?? doc.createdAt) as Date;
    const chosen = prefix ?? (doc.kind === "customization" ? "CUS" : "REQ");
    doc.reference = await generateReference(store, chosen, dated.getUTCFullYear());
  }
}

/**
 * Validate through Mongoose, then insert with the driver.
 *
 * Both halves are load-bearing. The driver is the only way to keep a back-dated
 * `createdAt` — `timestamps: true` overwrites it on any Mongoose write — and
 * validating first is what stops this script writing a document the application
 * cannot read back. Every document is checked, not a sample: the failure mode is
 * one bad enum value in one branch of a weighted draw, which a sample misses.
 */
async function insert(
  modelName: string,
  collection: string,
  docs: Array<Record<string, unknown>>,
): Promise<mongoose.Types.ObjectId[]> {
  if (docs.length === 0) return [];

  const model = mongoose.model(modelName);
  for (const doc of docs) {
    try {
      await new model(doc).validate();
    } catch (error) {
      throw new Error(
        `${modelName} would be invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const ids = docs.map((doc) => doc._id as mongoose.Types.ObjectId);
  /*
   * The manifest is extended *before* the write, not after.
   *
   * The first version recorded every id in memory and wrote one manifest at the
   * end — so the first validation failure left 725 payments in the database with
   * nothing to identify them by, and `--purge` could not have found them. A
   * partial run must still be completely reversible, which means the record of
   * what was written cannot depend on the run finishing.
   */
  await mongoose.connection
    .db!.collection(MANIFEST_COLLECTION)
    .updateOne({ _id: MANIFEST_ID as never }, {
      $push: { [`ids.${collection}`]: { $each: ids } },
    } as never);

  await mongoose.connection.db!.collection(collection).insertMany(docs as never[]);
  console.log(`  ${collection.padEnd(20)} +${docs.length}`);
  return ids;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
