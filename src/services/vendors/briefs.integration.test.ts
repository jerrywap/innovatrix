import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Vendor-directed customization — vendor ticket 14.
 *
 * One promise dominates this file, and it is the ticket's decision W2:
 *
 * > **The vendor is told what to build, never who asked.**
 *
 * Most of these cases assert that against the **serialised** vendor payload rather than against a
 * document, because serialising is what reaches a screen. A test that checked
 * `brief.organizationId === undefined` would pass while a view spread the whole document into a
 * prop; `JSON.stringify` catches that, and it catches the field somebody adds next year without
 * reading this comment.
 *
 * The second promise is the one that makes the first structural rather than aspirational:
 *
 * > **A vendor is not a participant in the customer's conversation at all.**
 *
 * Two subjects — `request` for customer↔staff, `vendor_brief` for staff↔vendor. So there is no
 * customer message on the vendor's thread to filter out, which matters because no visibility rule
 * could stop a customer typing their own phone number into a message body.
 */

let mongoose: typeof import("mongoose").default;
let briefs: typeof import("./brief-service");
let messaging: typeof import("@/services/messaging/messaging-service");
let catalog: typeof import("@/lib/db/models/catalog");
let requests: typeof import("@/lib/db/models/requests");
let briefModels: typeof import("@/lib/db/models/briefs");
let vendors: typeof import("@/lib/db/models/vendors");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");
let scope: typeof import("@/lib/auth/scope");

const VENDOR = "9c00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "9c00c46f6c887b38e2f0e0a2";
const ORG = "9c00c46f6c887b38e2f0e0b1";
const CUSTOMER_USER = "9c00c46f6c887b38e2f0e0c1";
const STAFF_USER = "9c00c46f6c887b38e2f0e0c2";
const VENDOR_USER = "9c00c46f6c887b38e2f0e0c3";
const PRODUCT = "9c00c46f6c887b38e2f0e0d1";
const FIRST_PARTY = "9c00c46f6c887b38e2f0e0d2";
const REQUEST = "9c00c46f6c887b38e2f0e0e1";

const STAFF_ACTOR = { type: "staff", userId: STAFF_USER, name: "Sam" } as const;
const VENDOR_ACTOR = {
  type: "vendor",
  userId: VENDOR_USER,
  vendorId: VENDOR,
  name: "Dev",
} as const;

/** The things a vendor must never be able to read, in the words they would appear in. */
const CUSTOMER_IDENTIFIERS = [ORG, CUSTOMER_USER, REQUEST, "CUS-2026-0001", "Ada Lovelace"];

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "vendor_briefs_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  briefs = await import("./brief-service");
  messaging = await import("@/services/messaging/messaging-service");
  catalog = await import("@/lib/db/models/catalog");
  requests = await import("@/lib/db/models/requests");
  briefModels = await import("@/lib/db/models/briefs");
  vendors = await import("@/lib/db/models/vendors");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");
  scope = await import("@/lib/auth/scope");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();

  /*
   * Indexes here rather than in the first test. `autoIndex` builds a model's indexes on its first
   * write, and without this that cost lands inside whichever test runs first — which is how the
   * lifecycle suite timed out at 30s under a loaded run while passing in isolation. `beforeAll`
   * has a 180-second budget for exactly this.
   */
  await Promise.all([
    briefModels.VendorBrief.syncIndexes(),
    requests.CustomerRequest.syncIndexes(),
    catalog.Product.syncIndexes(),
    vendors.Vendor.syncIndexes(),
    communication.Conversation.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await briefModels.VendorBrief.deleteMany({});
  await requests.CustomerRequest.deleteMany({});
  await catalog.Product.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await communication.Conversation.deleteMany({});
  await communication.Message.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
  await communication.ActivityEvent.deleteMany({});
});

/* ────────────────────────────────────────────── fixtures */

async function seed(overrides: { vendorStatus?: string; requestStatus?: string } = {}) {
  await vendors.Vendor.create({
    _id: VENDOR,
    slug: "northwind-labs",
    displayName: "Northwind Labs",
    contactEmail: "dev@northwind.example",
    country: "GB",
    pitch: "Dispatch tooling for fleets.",
    status: (overrides.vendorStatus ?? "verified") as "verified",
    profile: {},
    verification: {
      identity: { status: "approved" as const },
      business: { status: "approved" as const },
    },
    verificationDecisions: [],
    appliedAt: new Date(),
  });

  await catalog.Product.create([
    {
      _id: PRODUCT,
      name: "Northwind Dispatch",
      slug: "northwind-dispatch",
      summary: "Dispatch tooling.",
      status: "published" as const,
      vendorId: VENDOR,
      vendorSlug: "northwind-labs",
      vendorName: "Northwind Labs",
      prices: [{ currency: "GBP", amount: 29_900 }],
    },
    // The control: absence of a vendor must not read as "mine".
    {
      _id: FIRST_PARTY,
      name: "Atlas",
      slug: "atlas",
      summary: "Ours.",
      status: "published" as const,
    },
  ]);

  await requests.CustomerRequest.create({
    _id: REQUEST,
    reference: "CUS-2026-0001",
    kind: "customization" as const,
    organizationId: ORG,
    userId: CUSTOMER_USER,
    title: "Add a second depot",
    baseProductId: PRODUCT,
    vendorId: VENDOR,
    customerRequirements: [
      {
        key: "depot",
        label: "A second depot",
        origin: "confirmed" as const,
        acceptedByCustomer: true,
      },
      {
        key: "sms",
        label: "SMS alerts",
        detail: "To drivers",
        origin: "assumed" as const,
        acceptedByCustomer: false,
      },
    ],
    assumptions: [],
    requirementsVersion: 1,
    requirementsHistory: [],
    status: (overrides.requestStatus ?? "under_review") as "under_review",
    assignments: [],
    quoteIds: [],
    desiredTimeline: "before April",
    submittedAt: new Date(),
  });
}

/* ────────────────────────────────────────────── the promise */

describe("the vendor is told what to build, never who asked", () => {
  it("gives the vendor the requirements, the product and the timeline", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    const list = await briefs.listForVendor({ vendorId: VENDOR });
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("Add a second depot");
    expect(list[0]!.productName).toBe("Northwind Dispatch");
    expect(list[0]!.desiredTimeline).toBe("before April");
    expect(list[0]!.requirements.map((r) => r.label)).toEqual(["A second depot", "SMS alerts"]);
    // The origin survives: "we assumed this" is exactly what a vendor should push back on.
    expect(list[0]!.requirements[1]!.origin).toBe("assumed");
    // The currency is the *product's*, which the vendor set — not the customer's. Pricing bespoke
    // work in a currency the vendor never chose would need an FX decision nobody has taken.
    expect(list[0]!.currency).toBe("GBP");
  });

  it("puts no customer identifier in the serialised payload", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    const list = await briefs.listForVendor({ vendorId: VENDOR });
    const detail = await briefs.briefForVendor(list[0]!.id, { vendorId: VENDOR });

    // Serialised, not inspected field by field: `JSON.stringify` is what a view spreading the whole
    // object into a prop would produce, and it catches the field somebody adds later.
    for (const payload of [JSON.stringify(list), JSON.stringify(detail)]) {
      for (const identifier of CUSTOMER_IDENTIFIERS) {
        expect(payload, `${identifier} reached the vendor`).not.toContain(identifier);
      }
      // The words too, not just the ids — a future field called `customerName` would be caught by
      // the ids above only if it were populated in this fixture.
      expect(payload).not.toContain("organizationId");
      expect(payload).not.toContain("requestId");
      expect(payload).not.toContain("reference");
    }
  });

  it("drops the assumption flags the customer set, and every attachment", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    const [brief] = await briefs.listForVendor({ vendorId: VENDOR });
    const serialised = JSON.stringify(brief);

    // `acceptedByCustomer` is a negotiating position rather than a specification.
    expect(serialised).not.toContain("acceptedByCustomer");
    // An uploaded file is the likeliest place for a letterhead or a signature.
    expect(serialised).not.toContain("attachment");
    expect(serialised).not.toContain("storageKey");
  });
});

/* ────────────────────────────────────────────── two threads, not one */

describe("a vendor is not in the customer's conversation", () => {
  it("cannot read a customer message, because it is on a different subject", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    // The customer writes on their own thread.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "request",
      subjectId: REQUEST,
      senderUserId: CUSTOMER_USER,
      senderType: "customer",
      body: "Call me on 07700 900123 and ask for Ada.",
      visibility: "customer",
    });

    // Staff write on the brief thread.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_brief",
      subjectId: String(brief._id),
      senderUserId: STAFF_USER,
      senderType: "staff",
      body: "Can this be done on 2.1.0?",
      visibility: "vendor",
    });

    const vendorSide = await messaging.vendorThread({
      organizationId: ORG,
      subjectType: "vendor_brief",
      subjectId: String(brief._id),
      viewerUserId: VENDOR_USER,
    });

    expect(vendorSide).toHaveLength(1);
    expect(vendorSide[0]!.body).toBe("Can this be done on 2.1.0?");
    // The phone number is the point. No visibility level could have stopped it — the customer's
    // message simply is not on this conversation.
    expect(JSON.stringify(vendorSide)).not.toContain("07700 900123");
  });

  it("keeps the two conversations separate, which the unique index requires", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST, note: "Context for you." },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    const all = await communication.Conversation.find({}).lean();
    const subjects = all.map((row) => row.subjectType).sort();
    expect(subjects).toEqual(["vendor_brief"]);

    // `{subjectType, subjectId}` is unique, so the brief's own id is what makes a second thread on
    // one request possible at all.
    expect(String(all[0]!.subjectId)).toBe(String(brief._id));
  });
});

/* ────────────────────────────────────────────── scoping */

describe("a brief belongs to one vendor", () => {
  it("answers 404 for another vendor, not 403", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    // Not `ForbiddenError`: "that exists but is not yours" turns the screen into an oracle for
    // which brief ids are real. Same position as downloads and vendor products.
    await expect(
      briefs.briefForVendor(String(brief._id), { vendorId: OTHER_VENDOR }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    expect(await briefs.listForVendor({ vendorId: OTHER_VENDOR })).toEqual([]);
  });

  it("refuses an empty vendor scope rather than reading everything", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    // The `vendorFilter` guard. A missing scope must throw, never widen to every vendor.
    // `ScopeError` lives in `auth/scope`, not `lib/errors` — it is an authorisation-shape mistake
    // rather than a domain error, and it is deliberately not something `withAction` can render.
    await expect(briefs.listForVendor({ vendorId: "" })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
    await expect(briefs.listForVendor({ vendorId: "  " })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
  });

  it("will not let another vendor price it", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    await expect(
      briefs.submitProposal(
        { briefId: String(brief._id), amount: 240_000, currency: "GBP", effort: "a week" },
        { vendorId: OTHER_VENDOR },
        { ...VENDOR_ACTOR, userId: VENDOR_USER },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    const untouched = await briefModels.VendorBrief.findById(brief._id).lean();
    expect(untouched!.status).toBe("sent");
    expect(untouched!.proposal).toBeUndefined();
  });
});

/* ────────────────────────────────────────────── routing rules */

describe("what staff may route", () => {
  it("refuses a first-party product, rather than silently doing nothing", async () => {
    await seed();
    await requests.CustomerRequest.updateOne(
      { _id: REQUEST },
      { $set: { baseProductId: FIRST_PARTY }, $unset: { vendorId: "" } },
    );

    await expect(
      briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER }),
    ).rejects.toThrow(/no vendor to send it to/);
  });

  it("refuses a vendor who is not verified", async () => {
    await seed({ vendorStatus: "suspended" });

    // Asking a suspended vendor to price bespoke work extends them a relationship they do not
    // currently have — they cannot even list a product.
    await expect(
      briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER }),
    ).rejects.toThrow(/not currently verified/);
  });

  it("refuses a second brief while one is open", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    await expect(
      briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER }),
    ).rejects.toBeInstanceOf(errors.ConflictError);
  });

  it("allows a fresh brief once the last one is withdrawn", async () => {
    await seed();
    const first = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    await briefs.withdraw(String(first._id), { ...STAFF_ACTOR, userId: STAFF_USER });

    // A revision of the requirements is the real reason: the withdrawn brief describes work nobody
    // is asking for now, and it stays readable as the record of what was asked before.
    const second = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    expect(String(second._id)).not.toBe(String(first._id));
    const history = await briefs.listForRequest(REQUEST);
    expect(history.map((row) => row.status).sort()).toEqual(["sent", "withdrawn"]);
  });

  it("moves the request to technical_review", async () => {
    await seed();
    await briefs.routeToVendor({ requestId: REQUEST }, { ...STAFF_ACTOR, userId: STAFF_USER });

    // An edge that already existed. *With the vendor* is what it means for a vendor-owned request,
    // which is why this ticket adds no state to the machine.
    const after = await requests.CustomerRequest.findById(REQUEST).lean();
    expect(after!.status).toBe("technical_review");
  });
});

/* ────────────────────────────────────────────── the vendor's answer */

describe("the vendor prices it or declines it", () => {
  it("records a price, and the customer's own thread learns nothing", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    const priced = await briefs.submitProposal(
      {
        briefId: String(brief._id),
        amount: 240_000,
        currency: "GBP",
        effort: "About a week",
        caveats: "Assumes PHP 8.2.",
      },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );

    expect(priced.status).toBe("answered");
    expect(priced.proposal?.amount).toBe(240_000);

    // Minor units, stored as an integer — never a float, and never through `toFixed`.
    const stored = await briefModels.VendorBrief.findById(brief._id).lean();
    expect(Number.isInteger(stored!.proposal!.amount)).toBe(true);

    // The customer is told by staff, deliberately: only they can see who to tell.
    const customerSide = await messaging.customerThread({
      organizationId: ORG,
      subjectType: "request",
      subjectId: REQUEST,
      viewerUserId: CUSTOMER_USER,
    });
    expect(customerSide).toEqual([]);
  });

  it("refuses a price on a withdrawn brief", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    await briefs.withdraw(String(brief._id), { ...STAFF_ACTOR, userId: STAFF_USER });

    // The guarded `{_id, vendorId, status: "sent"}` update does the scoping and the staleness check
    // in one write, so there is no window between reading and setting.
    await expect(
      briefs.submitProposal(
        { briefId: String(brief._id), amount: 100, currency: "GBP", effort: "a day" },
        { vendorId: VENDOR },
        { ...VENDOR_ACTOR, userId: VENDOR_USER },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a re-price once answered", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    const price = {
      briefId: String(brief._id),
      amount: 240_000,
      currency: "GBP",
      effort: "a week",
    };
    await briefs.submitProposal(
      price,
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );

    // Staff may have already quoted the customer from the first figure. Letting the underlying
    // number move would leave that quote citing a price that no longer exists.
    await expect(
      briefs.submitProposal(
        { ...price, amount: 500_000 },
        { vendorId: VENDOR },
        { ...VENDOR_ACTOR, userId: VENDOR_USER },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("requires a reason to decline", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    await expect(
      briefs.decline(
        { briefId: String(brief._id), reason: "   " },
        { vendorId: VENDOR },
        { ...VENDOR_ACTOR, userId: VENDOR_USER },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const declined = await briefs.decline(
      { briefId: String(brief._id), reason: "No capacity until March." },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );
    expect(declined.status).toBe("declined");
    expect(declined.declinedReason).toBe("No capacity until March.");
  });

  it("counts only briefs still waiting on the vendor", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    expect(await briefs.countAwaitingVendor({ vendorId: VENDOR })).toBe(1);

    await briefs.submitProposal(
      { briefId: String(brief._id), amount: 1000, currency: "GBP", effort: "a day" },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );
    expect(await briefs.countAwaitingVendor({ vendorId: VENDOR })).toBe(0);
  });
});

/* ────────────────────────────────────────────── submission stamps the vendor */

describe("a request knows whose software it is about", () => {
  it("stamps vendorId from the product at submission, and tells the vendor nothing yet", async () => {
    await seed();
    await requests.CustomerRequest.deleteMany({});

    const conversation = await requests.AiConversation.create({
      contextType: "customization" as const,
      organizationId: ORG,
      userId: CUSTOMER_USER,
      productId: PRODUCT,
      status: "active" as const,
      messages: [],
      structuredAnswers: {},
      requirements: [],
    });

    const requestService = await import("@/services/requests/request-service");
    const created = await requestService.submitFromConversation({
      conversationId: String(conversation._id),
      kind: "customization",
      title: "Add a second depot",
      organizationId: ORG,
      userId: CUSTOMER_USER,
      customerRequirements: [
        {
          key: "depot",
          label: "A second depot",
          origin: "confirmed",
          acceptedByCustomer: true,
        },
      ],
      assumptions: [],
      baseProductId: PRODUCT,
    });

    expect(String(created.vendorId)).toBe(VENDOR);

    // Decision W3: staff triage first, so nothing is waiting on the vendor yet.
    expect(await briefs.countAwaitingVendor({ vendorId: VENDOR })).toBe(0);
  });

  it("leaves vendorId absent for a first-party product", async () => {
    await seed();
    await requests.CustomerRequest.deleteMany({});

    const conversation = await requests.AiConversation.create({
      contextType: "customization" as const,
      organizationId: ORG,
      userId: CUSTOMER_USER,
      productId: FIRST_PARTY,
      status: "active" as const,
      messages: [],
      structuredAnswers: {},
      requirements: [],
    });

    const requestService = await import("@/services/requests/request-service");
    const created = await requestService.submitFromConversation({
      conversationId: String(conversation._id),
      kind: "customization",
      title: "Tweak Atlas",
      organizationId: ORG,
      userId: CUSTOMER_USER,
      customerRequirements: [
        { key: "x", label: "Something", origin: "confirmed", acceptedByCustomer: true },
      ],
      assumptions: [],
      baseProductId: FIRST_PARTY,
    });

    // Absence is the only meaning that carries: every request predating this ticket is first-party.
    expect(created.vendorId).toBeUndefined();
  });
});

/* ────────────────────────────────────────────── milestone B: the quote */

describe("staff quote the customer from the vendor's price", () => {
  async function pricedBrief() {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    await briefs.submitProposal(
      {
        briefId: String(brief._id),
        amount: 240_000,
        currency: "GBP",
        effort: "About a week",
        caveats: "Assumes PHP 8.2.",
      },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );
    return String(brief._id);
  }

  it("hands staff the price and the commission rate, resolved now", async () => {
    const briefId = await pricedBrief();

    const quotable = await briefs.quotableBrief(briefId);
    expect(quotable.amount).toBe(240_000);
    expect(quotable.currency).toBe("GBP");
    expect(quotable.effort).toBe("About a week");
    expect(quotable.vendorName).toBe("Northwind Labs");
    // Resolved at quoting time, not at payment: a rate change must not rewrite the arithmetic on
    // work already priced and agreed.
    expect(quotable.commissionBasisPoints).toBeGreaterThan(0);
  });

  it("refuses a brief with no price on it", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );

    await expect(briefs.quotableBrief(String(brief._id))).rejects.toThrow(
      /has not priced this/,
    );
  });

  it("says so when the vendor declined, rather than reporting no price", async () => {
    await seed();
    const brief = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    await briefs.decline(
      { briefId: String(brief._id), reason: "No capacity." },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );

    // Two different problems with two different answers — the same reason `releaseVersion`
    // distinguishes "still fetching" from "you never gave us a file".
    await expect(briefs.quotableBrief(String(brief._id))).rejects.toThrow(/declined/);
  });

  it("finds the newest price when a brief was resent", async () => {
    const first = await pricedBrief();
    await briefs.withdraw(first, { ...STAFF_ACTOR, userId: STAFF_USER });

    const second = await briefs.routeToVendor(
      { requestId: REQUEST },
      { ...STAFF_ACTOR, userId: STAFF_USER },
    );
    await briefs.submitProposal(
      { briefId: String(second._id), amount: 300_000, currency: "GBP", effort: "Ten days" },
      { vendorId: VENDOR },
      { ...VENDOR_ACTOR, userId: VENDOR_USER },
    );

    const latest = await briefs.latestPricedBrief(REQUEST);
    expect(latest?.amount).toBe(300_000);
  });

  it("returns null when there is nothing priced, rather than throwing", async () => {
    await seed();
    // The quote screen is reachable for every request; a vendor price is the exception, so the
    // absence of one must not be an error page.
    expect(await briefs.latestPricedBrief(REQUEST)).toBeNull();
  });
});
