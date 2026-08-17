import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Vendor support and disputes — vendor ticket 13.
 *
 * ## The visibility matrix is most of this file
 *
 * | | Customer | Vendor | Staff |
 * |---|---|---|---|
 * | `customer` | ✓ | ✓ | ✓ |
 * | `vendor` | | ✓ | ✓ |
 * | `internal` | | | ✓ |
 *
 * §37 calls this a disclosure boundary rather than a UI preference, and vendor ticket 13 gave it a
 * second edge: what staff say *about* a vendor must not reach the vendor either. Both directions are
 * asserted separately, because a filter that happens to exclude one is not evidence about the other.
 *
 * The rest is the three-party question: the vendor answers first, either party may raise a dispute,
 * and a dispute cannot be closed without an outcome and a reason.
 */

let mongoose: typeof import("mongoose").default;
let support: typeof import("./support-service");
let takedown: typeof import("./takedown-service");
let messaging: typeof import("@/services/messaging/messaging-service");
let catalog: typeof import("@/lib/db/models/catalog");
let commerce: typeof import("@/lib/db/models/commerce");
let vendors: typeof import("@/lib/db/models/vendors");
let communication: typeof import("@/lib/db/models/communication");
let requests: typeof import("@/lib/db/models/requests");
let takedowns: typeof import("@/lib/db/models/takedowns");
let errors: typeof import("@/lib/errors");

const VENDOR = "8c00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "8c00c46f6c887b38e2f0e0a2";
const ORG = "8c00c46f6c887b38e2f0e0b1";
const OTHER_ORG = "8c00c46f6c887b38e2f0e0b2";
const CUSTOMER_USER = "8c00c46f6c887b38e2f0e0c1";
const VENDOR_USER = "8c00c46f6c887b38e2f0e0c2";
const STAFF_USER = "8c00c46f6c887b38e2f0e0c3";
const PRODUCT = "8c00c46f6c887b38e2f0e0d1";
const FIRST_PARTY = "8c00c46f6c887b38e2f0e0d2";
const ORDER = "8c00c46f6c887b38e2f0e0e1";

const CUSTOMER = { type: "customer", userId: CUSTOMER_USER, name: "Ada" } as const;
const STAFF = { type: "staff", userId: STAFF_USER, name: "Sam" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "vendor_support_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  support = await import("./support-service");
  takedown = await import("./takedown-service");
  messaging = await import("@/services/messaging/messaging-service");
  catalog = await import("@/lib/db/models/catalog");
  commerce = await import("@/lib/db/models/commerce");
  vendors = await import("@/lib/db/models/vendors");
  communication = await import("@/lib/db/models/communication");
  requests = await import("@/lib/db/models/requests");
  takedowns = await import("@/lib/db/models/takedowns");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await communication.Conversation.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await communication.Conversation.deleteMany({});
  await communication.Message.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
  await catalog.Product.deleteMany({});
  await commerce.Entitlement.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await requests.FollowUp.deleteMany({});
  await takedowns.TakedownClaim.deleteMany({});
});

/* ────────────────────────────────────────────── fixtures */

async function seed() {
  await vendors.Vendor.create({
    _id: VENDOR,
    displayName: "Northwind Labs",
    slug: "northwind",
    contactEmail: "ada@northwind.test",
    country: "GB",
    pitch: "Dispatch tooling.",
    appliedAt: new Date(),
    status: "verified" as const,
    verification: {
      identity: { status: "approved" },
      // Identity only, so the SLA target is the 48-hour one.
      business: { status: "pending" },
    },
  });

  await catalog.Product.create([
    {
      _id: PRODUCT,
      name: "Northwind Dispatch",
      slug: "northwind-dispatch",
      summary: "Dispatch tooling.",
      status: "published" as const,
      vendorId: VENDOR,
      vendorSlug: "northwind",
      vendorName: "Northwind Labs",
    },
    // No vendor — the control for "a first-party product has no vendor to route to".
    {
      _id: FIRST_PARTY,
      name: "Atlas",
      slug: "atlas",
      summary: "Ours.",
      status: "published" as const,
    },
  ]);
}

async function entitlement(productId = PRODUCT, organizationId = ORG) {
  const created = await commerce.Entitlement.create({
    organizationId,
    productId,
    orderId: ORDER,
    orderLineId: `line-${Math.random().toString(36).slice(2, 8)}`,
    status: "active" as const,
  });
  return String(created._id);
}

const scope = { organizationId: ORG };

/** Open a thread and return both ids the tests need. */
async function aThread() {
  await seed();
  const entitlementId = await entitlement();
  const opened = await support.openThread(
    { entitlementId, body: "The import fails on a 12MB file." },
    scope,
    CUSTOMER,
  );
  return { ...opened, entitlementId };
}

/* ────────────────────────────────────────────── opening */

describe("opening a thread", () => {
  it("routes to the vendor and sets the response target from their level", async () => {
    const { conversationId, vendorId, slaHours } = await aThread();

    expect(vendorId).toBe(VENDOR);
    // Identity-verified only ⇒ 48 hours.
    expect(slaHours).toBe(support.SLA_HOURS.identity);

    const conversation = await communication.Conversation.findById(conversationId).lean();
    expect(conversation!.subjectType).toBe("vendor_support");
    expect(String(conversation!.vendorId)).toBe(VENDOR);
    expect(String(conversation!.productId)).toBe(PRODUCT);
    expect(conversation!.responseDueAt).toBeInstanceOf(Date);
  });

  it("continues the same thread on a second question rather than opening two", async () => {
    const { entitlementId, conversationId } = await aThread();

    const again = await support.openThread(
      { entitlementId, body: "Any update on this?" },
      scope,
      CUSTOMER,
    );

    expect(again.conversationId).toBe(conversationId);
    expect(await communication.Conversation.countDocuments({})).toBe(1);
  });

  it("refuses another organisation's entitlement, as a 404", async () => {
    await seed();
    const theirs = await entitlement(PRODUCT, OTHER_ORG);

    await expect(
      support.openThread({ entitlementId: theirs, body: "Not mine." }, scope, CUSTOMER),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a first-party product rather than inventing a vendor", async () => {
    await seed();
    const ours = await entitlement(FIRST_PARTY);

    await expect(
      support.openThread({ entitlementId: ours, body: "Help." }, scope, CUSTOMER),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("refuses an empty question", async () => {
    await seed();
    const id = await entitlement();

    await expect(
      support.openThread({ entitlementId: id, body: "   " }, scope, CUSTOMER),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});

/* ────────────────────────────────────────────── the visibility matrix */

describe("§37's boundary, with three audiences", () => {
  async function withEveryVisibility() {
    const { entitlementId } = await aThread();

    // A vendor note to us.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "VENDOR-NOTE: the customer is on an old build, do not tell them yet.",
      visibility: "vendor",
    });

    // A staff note about the vendor.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: STAFF_USER,
      senderType: "staff",
      body: "INTERNAL-NOTE: this vendor has been slow on three threads.",
      visibility: "internal",
    });

    // A vendor reply the customer should see.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "PUBLIC-REPLY: 2.1 raises the import limit.",
      visibility: "customer",
    });

    return entitlementId;
  }

  it("shows the customer only customer-visible messages", async () => {
    const entitlementId = await withEveryVisibility();

    const messages = await messaging.customerThread({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      viewerUserId: CUSTOMER_USER,
    });

    const payload = JSON.stringify(messages);
    expect(payload).not.toContain("VENDOR-NOTE");
    expect(payload).not.toContain("INTERNAL-NOTE");
    expect(payload).toContain("PUBLIC-REPLY");
    // Layer 3: the type has no `visibility` field, so one cannot be serialised.
    expect(payload).not.toContain("visibility");
  });

  /** The second edge, asserted separately — this is the one vendor ticket 13 added. */
  it("shows the vendor their own notes and never an internal one", async () => {
    const entitlementId = await withEveryVisibility();

    const messages = await messaging.vendorThread({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      viewerUserId: VENDOR_USER,
    });

    const payload = JSON.stringify(messages);
    expect(payload).toContain("VENDOR-NOTE");
    expect(payload).toContain("PUBLIC-REPLY");
    // A staff assessment of the vendor's responsiveness is exactly the note that must not reach
    // them.
    expect(payload).not.toContain("INTERNAL-NOTE");
    // And no raw `visibility` either — the vendor gets a derived boolean instead.
    expect(payload).not.toContain('"visibility"');
    expect(payload).toContain("visibleToCustomer");
  });

  it("shows staff everything, which is the point of their view", async () => {
    const entitlementId = await withEveryVisibility();

    const messages = await messaging.staffThread({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      viewerUserId: STAFF_USER,
    });

    const payload = JSON.stringify(messages);
    expect(payload).toContain("VENDOR-NOTE");
    expect(payload).toContain("INTERNAL-NOTE");
    expect(payload).toContain("PUBLIC-REPLY");
  });

  /** A vendor cannot write an internal note — it would be one they could not read back. */
  it("coerces a vendor's `internal` to `vendor`", async () => {
    const { entitlementId } = await aThread();

    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "Trying to write a staff-only note.",
      visibility: "internal",
    });

    const stored = await communication.Message.findOne({
      body: "Trying to write a staff-only note.",
    }).lean();
    expect(stored!.visibility).toBe("vendor");
  });

  it("still forces a customer's message to `customer`", async () => {
    const { entitlementId } = await aThread();

    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: CUSTOMER_USER,
      senderType: "customer",
      body: "Probing with an internal visibility.",
      visibility: "internal",
    });

    const stored = await communication.Message.findOne({
      body: "Probing with an internal visibility.",
    }).lean();
    expect(stored!.visibility).toBe("customer");
  });
});

/* ────────────────────────────────────────────── the SLA */

describe("time to first response", () => {
  it("is stamped by the vendor's first customer-visible reply, once", async () => {
    const { entitlementId, conversationId } = await aThread();

    // A note to us is not an answer to the buyer.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "Looking at it.",
      visibility: "vendor",
    });

    let conversation = await communication.Conversation.findById(conversationId).lean();
    expect(conversation!.firstVendorResponseAt).toBeUndefined();

    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "Fixed in 2.1.",
      visibility: "customer",
    });

    conversation = await communication.Conversation.findById(conversationId).lean();
    const first = conversation!.firstVendorResponseAt;
    expect(first).toBeInstanceOf(Date);

    // A second reply must not move it — `$min` is what makes that true.
    await messaging.postMessage({
      organizationId: ORG,
      subjectType: "vendor_support",
      subjectId: entitlementId,
      senderUserId: VENDOR_USER,
      senderType: "vendor",
      body: "And here is the build.",
      visibility: "customer",
    });

    conversation = await communication.Conversation.findById(conversationId).lean();
    expect(conversation!.firstVendorResponseAt?.getTime()).toBe(first?.getTime());
  });

  it("reports a median and counts what is overdue", async () => {
    const { conversationId } = await aThread();

    // Age the thread and its target so it is overdue without waiting.
    await communication.Conversation.updateOne(
      { _id: conversationId },
      { $set: { responseDueAt: new Date(Date.now() - 3_600_000) } },
    );

    const metrics = await support.responsiveness(VENDOR);
    expect(metrics.threads).toBe(1);
    expect(metrics.medianHours).toBeNull();
    expect(metrics.overdue).toBe(1);

    // And the sweep's query finds it.
    const overdue = await support.overdueThreads();
    expect(overdue.map((row) => String(row._id))).toContain(conversationId);
  });

  it("escalates without removing the vendor, and creates one follow-up", async () => {
    const { conversationId } = await aThread();

    await support.escalate(conversationId, { ...STAFF });
    await support.escalate(conversationId, { ...STAFF });

    const conversation = await communication.Conversation.findById(conversationId).lean();
    expect(conversation!.escalatedAt).toBeInstanceOf(Date);
    // The vendor is still the vendor — escalation adds staff, it does not reassign.
    expect(String(conversation!.vendorId)).toBe(VENDOR);

    // One follow-up, not two. A queue item per escalation is how a queue stops being trusted.
    expect(await requests.FollowUp.countDocuments({ status: "open" })).toBe(1);

    // And an escalated thread is out of the sweep's query.
    expect(await support.overdueThreads()).toEqual([]);
  });
});

/* ────────────────────────────────────────────── disputes */

describe("disputes", () => {
  it("can be raised by the customer", async () => {
    const { conversationId } = await aThread();

    const updated = await support.raiseDispute(
      { conversationId, reason: "does_not_work", detail: "It crashes on every import." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );

    expect(updated.dispute?.status).toBe("open");
    expect(updated.dispute?.raisedByType).toBe("customer");
    // Raising a dispute escalates by definition — staff are in from that moment.
    expect(updated.escalatedAt).toBeInstanceOf(Date);
    expect(await requests.FollowUp.countDocuments({ status: "open" })).toBe(1);
  });

  it("can be raised by the vendor, by any member", async () => {
    const { conversationId } = await aThread();

    const updated = await support.raiseDispute(
      { conversationId, reason: "licence_misuse", detail: "Forty activations on one licence." },
      // A member's user id, not the owner's. The service takes no role argument at all, which is
      // what "not owner-only" means structurally.
      { type: "vendor", userId: VENDOR_USER },
      { type: "vendor", userId: VENDOR_USER, vendorId: VENDOR },
    );

    expect(updated.dispute?.raisedByType).toBe("vendor");
    expect(updated.dispute?.reason).toBe("licence_misuse");
  });

  it("is visible to both parties, because it is on the thread", async () => {
    const { conversationId } = await aThread();
    await support.raiseDispute(
      { conversationId, reason: "not_as_described", detail: "Missing the reporting module." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );

    // The vendor's own scoped list carries it — no separate dispute record to miss.
    const theirs = await support.listForVendor({ vendorId: VENDOR }, { disputesOnly: true });
    expect(theirs.map((row) => String(row._id))).toContain(conversationId);

    // And the staff queue has it.
    const queue = await support.listDisputes();
    expect(queue.map((row) => String(row._id))).toContain(conversationId);
  });

  it("refuses a second open dispute on the same thread", async () => {
    const { conversationId } = await aThread();
    await support.raiseDispute(
      { conversationId, reason: "does_not_work", detail: "First." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );

    await expect(
      support.raiseDispute(
        { conversationId, reason: "unfair_review", detail: "Second." },
        { type: "vendor", userId: VENDOR_USER },
        { type: "vendor", userId: VENDOR_USER, vendorId: VENDOR },
      ),
    ).rejects.toBeInstanceOf(errors.ConflictError);
  });

  it("cannot be closed without an outcome and a reason", async () => {
    const { conversationId } = await aThread();
    await support.raiseDispute(
      { conversationId, reason: "does_not_work", detail: "Crashes." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );

    await expect(
      support.resolveDispute(conversationId, "no_action", "   ", STAFF),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("records the decision, closes the follow-up and audits it", async () => {
    const { conversationId } = await aThread();
    await support.raiseDispute(
      { conversationId, reason: "does_not_work", detail: "Crashes." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );

    const resolved = await support.resolveDispute(
      conversationId,
      "no_action",
      "The documented import limit applies; 2.1 raises it and has been offered.",
      STAFF,
    );

    expect(resolved.dispute?.status).toBe("resolved");
    expect(resolved.dispute?.outcome).toBe("no_action");
    expect(resolved.dispute?.resolvedAt).toBeInstanceOf(Date);

    // A decided dispute must not stay on somebody's queue.
    expect(await requests.FollowUp.countDocuments({ status: "open" })).toBe(0);

    const audit = await communication.AuditLog.findOne({ action: "dispute.resolved" }).lean();
    expect(audit).toBeTruthy();
  });

  it("refuses a second resolution of the same dispute", async () => {
    const { conversationId } = await aThread();
    await support.raiseDispute(
      { conversationId, reason: "does_not_work", detail: "Crashes." },
      { type: "customer", userId: CUSTOMER_USER },
      CUSTOMER,
    );
    await support.resolveDispute(conversationId, "refunded", "Refunded in full.", STAFF);

    await expect(
      support.resolveDispute(conversationId, "no_action", "Changed my mind.", STAFF),
    ).rejects.toBeInstanceOf(errors.ConflictError);
  });

  /** The structural half of "a vendor cannot decide a refund". */
  it("refuses a vendor as the actor on a refund decision", () => {
    expect(() =>
      support.assertNotVendorRefund({ type: "vendor", userId: VENDOR_USER, vendorId: VENDOR }),
    ).toThrow(errors.ForbiddenError);

    expect(() => support.assertNotVendorRefund(STAFF)).not.toThrow();
  });

  it("records a refund request as a dispute so staff are pulled in", async () => {
    const { conversationId } = await aThread();

    const updated = await support.requestRefund(
      conversationId,
      "It does not do what the page said.",
      { userId: CUSTOMER_USER },
      CUSTOMER,
    );

    expect(updated.dispute?.reason).toBe("refund_refused");
    expect(updated.dispute?.raisedByType).toBe("customer");
  });
});

/* ────────────────────────────────────────────── scoping */

describe("scoping", () => {
  it("shows a vendor only threads about their own products", async () => {
    await aThread();

    expect(await support.listForVendor({ vendorId: OTHER_VENDOR })).toEqual([]);
    expect((await support.listForVendor({ vendorId: VENDOR })).length).toBe(1);
  });

  it("refuses an empty vendor scope rather than listing every thread", async () => {
    const scopeModule = await import("@/lib/auth/scope");
    await expect(support.listForVendor({ vendorId: "" })).rejects.toBeInstanceOf(
      scopeModule.ScopeError,
    );
  });
});

/* ────────────────────────────────────────────── takedowns */

describe("takedowns", () => {
  it("records a claim without touching the product", async () => {
    await seed();

    const claim = await takedown.recordClaim(
      {
        productId: PRODUCT,
        claimant: { name: "Rights Co", email: "legal@rights.test" },
        allegation: "The dispatch module is a copy of our GPL project without attribution.",
      },
      { ...STAFF, userId: STAFF_USER },
    );

    expect(claim.status).toBe("received");
    expect(String(claim.vendorId)).toBe(VENDOR);

    // A claim is not a finding. A system that delisted on receipt is one where a competitor can
    // take a product down by emailing us.
    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.status).toBe("published");
    expect(product!.listingSuppressed).toBeUndefined();

    const audit = await communication.AuditLog.findOne({ action: "takedown.received" }).lean();
    expect((audit!.after as { claimant?: string }).claimant).toBe("Rights Co");
  });

  it("delists on a separate, deliberate step and starts the vendor's clock", async () => {
    await seed();
    const entitlementId = await entitlement();
    void entitlementId;

    const claim = await takedown.recordClaim(
      {
        productId: PRODUCT,
        claimant: { name: "Rights Co", email: "legal@rights.test" },
        allegation: "Copied code.",
      },
      { ...STAFF, userId: STAFF_USER },
    );

    const result = await takedown.delistForClaim(String(claim._id), {
      ...STAFF,
      userId: STAFF_USER,
    });

    expect(result.claim.status).toBe("awaiting_vendor");
    expect(result.claim.delistedAt).toBeInstanceOf(Date);
    expect(result.claim.vendorResponseDueAt).toBeInstanceOf(Date);
    expect(result.entitlementsSuspended).toBe(1);

    // Vendor ticket 12's emergency delist: archived, and entitlements **suspended** not revoked.
    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.status).toBe("archived");
    const ent = await commerce.Entitlement.findOne({ productId: PRODUCT }).lean();
    expect(ent!.status).toBe("suspended");
  });

  it("records the vendor's answer, which is weighed against their attestation", async () => {
    await seed();
    const claim = await takedown.recordClaim(
      {
        productId: PRODUCT,
        claimant: { name: "Rights Co", email: "legal@rights.test" },
        allegation: "Copied code.",
      },
      { ...STAFF, userId: STAFF_USER },
    );

    const updated = await takedown.recordVendorResponse(
      String(claim._id),
      "The module is MIT-licensed and attribution is in NOTICE.md.",
      { type: "vendor", userId: VENDOR_USER, vendorId: VENDOR },
    );

    expect(updated.vendorResponse?.body).toContain("MIT-licensed");
    expect(updated.vendorResponse?.at).toBeInstanceOf(Date);
  });

  it("requires a reason to resolve, whatever the outcome", async () => {
    await seed();
    const claim = await takedown.recordClaim(
      {
        productId: PRODUCT,
        claimant: { name: "Rights Co", email: "legal@rights.test" },
        allegation: "Copied code.",
      },
      { ...STAFF, userId: STAFF_USER },
    );

    await expect(
      takedown.resolveClaim(String(claim._id), "claim_rejected", "  ", {
        ...STAFF,
        userId: STAFF_USER,
      }),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const resolved = await takedown.resolveClaim(
      String(claim._id),
      "claim_rejected",
      "The licence permits redistribution and attribution is present.",
      { ...STAFF, userId: STAFF_USER },
    );

    expect(resolved.status).toBe("rejected");
    expect(resolved.resolution?.reason).toContain("attribution");
  });

  it("keeps every step in the audit log", async () => {
    await seed();
    const claim = await takedown.recordClaim(
      {
        productId: PRODUCT,
        claimant: { name: "Rights Co", email: "legal@rights.test" },
        allegation: "Copied code.",
      },
      { ...STAFF, userId: STAFF_USER },
    );
    await takedown.delistForClaim(String(claim._id), { ...STAFF, userId: STAFF_USER });
    await takedown.recordVendorResponse(String(claim._id), "It is ours.", {
      type: "vendor",
      userId: VENDOR_USER,
      vendorId: VENDOR,
    });
    await takedown.resolveClaim(String(claim._id), "removed", "Attestation was false.", {
      ...STAFF,
      userId: STAFF_USER,
    });

    const actions = (await communication.AuditLog.find({ action: /^takedown\./ }).lean()).map(
      (row) => row.action,
    );

    expect(actions).toEqual(
      expect.arrayContaining([
        "takedown.received",
        "takedown.delisted",
        "takedown.vendor_responded",
        "takedown.resolved",
      ]),
    );
  });
});
