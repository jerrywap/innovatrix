import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §37 — layer 4 of the visibility boundary.
 *
 * The first three layers are structural: the filter is in the query, the
 * customer-facing service takes no audience, and `CustomerMessage` has no
 * `visibility` field. This is the layer that *checks* them, and it checks the
 * only thing that finally matters — **that an internal note is absent from the
 * serialised customer payload**, not merely hidden by a component.
 *
 * The failure this guards against is silent and one-directional: nobody
 * notices a leak from the outside, and the customer who reads staff
 * deliberation about their own request does not report it as a bug.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./messaging-service");
let communication: typeof import("@/lib/db/models/communication");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const OTHER_ORG = "6a80c46f6c887b38e2f0e0c9";
const CUSTOMER = "6a80c46f6c887b38e2f0e0b2";
const STAFF = "6a80c46f6c887b38e2f0e0a1";
const SUBJECT = "6a80c46f6c887b38e2f0e0d1";

const INTERNAL = "Their budget looks unrealistic — flag to Tom before we quote.";
const VISIBLE = "Thanks — we're looking at this now.";

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "messaging_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./messaging-service");
  communication = await import("@/lib/db/models/communication");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    communication.Conversation.syncIndexes(),
    communication.Message.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await Promise.all([
    communication.Conversation.deleteMany({}),
    communication.Message.deleteMany({}),
  ]);
});

const subject = { subjectType: "request" as const, subjectId: SUBJECT };

async function seedBothKinds(organizationId = ORG) {
  await service.postMessage({
    organizationId,
    ...subject,
    senderUserId: CUSTOMER,
    senderType: "customer",
    body: "Can you also add payroll export?",
    visibility: "customer",
  });

  await service.postMessage({
    organizationId,
    ...subject,
    senderUserId: STAFF,
    senderType: "staff",
    body: INTERNAL,
    visibility: "internal",
  });

  await service.postMessage({
    organizationId,
    ...subject,
    senderUserId: STAFF,
    senderType: "staff",
    body: VISIBLE,
    visibility: "customer",
  });
}

describe("the customer payload cannot carry an internal note — §37", () => {
  it("omits it from the thread entirely", async () => {
    await seedBothKinds();

    const forCustomer = await service.customerThread({
      organizationId: ORG,
      ...subject,
      viewerUserId: CUSTOMER,
    });

    expect(forCustomer).toHaveLength(2);
    // The assertion that matters: the serialised payload, not the rendered page.
    expect(JSON.stringify(forCustomer)).not.toContain(INTERNAL);
    expect(JSON.stringify(forCustomer)).not.toContain("Tom");
  });

  it("carries no `visibility` field at all, so one cannot be smuggled in", async () => {
    // Layer 3. Even a bug that got an internal row past the query would have
    // nowhere to put the flag saying so.
    await seedBothKinds();

    const forCustomer = await service.customerThread({
      organizationId: ORG,
      ...subject,
      viewerUserId: CUSTOMER,
    });

    for (const message of forCustomer) {
      expect(message).not.toHaveProperty("visibility");
    }
  });

  it("shows staff both, and says which is which", async () => {
    await seedBothKinds();

    const forStaff = await service.staffThread({
      organizationId: ORG,
      ...subject,
      viewerUserId: STAFF,
    });

    expect(forStaff).toHaveLength(3);
    expect(forStaff.filter((message) => message.visibility === "internal")).toHaveLength(1);
    expect(JSON.stringify(forStaff)).toContain(INTERNAL);
  });

  it("forces a customer's message to be customer-visible, whatever was asked for", async () => {
    // A customer has no legitimate reason to post an internal note, so the
    // service coerces rather than trusting the caller.
    await service.postMessage({
      organizationId: ORG,
      ...subject,
      senderUserId: CUSTOMER,
      senderType: "customer",
      body: "Trying to post internally",
      visibility: "internal",
    });

    const stored = await communication.Message.findOne({}).lean();
    expect(stored!.visibility).toBe("customer");
  });

  it("does not leak across organisations", async () => {
    await seedBothKinds(ORG);

    const otherOrg = await service.customerThread({
      organizationId: OTHER_ORG,
      ...subject,
      viewerUserId: CUSTOMER,
    });

    // Same subject id, different organisation: the conversation is scoped, so
    // there is nothing to read rather than somebody else's thread.
    expect(otherOrg).toEqual([]);
  });
});

describe("one conversation per subject — §38", () => {
  it("does not create a second thread when two people post at once", async () => {
    // `findOrCreateForSubject` upserts rather than `create`s. Two threads for
    // one request means the second is invisible to whoever opened the first.
    await Promise.all([
      service.postMessage({
        organizationId: ORG,
        ...subject,
        senderUserId: CUSTOMER,
        senderType: "customer",
        body: "First",
        visibility: "customer",
      }),
      service.postMessage({
        organizationId: ORG,
        ...subject,
        senderUserId: STAFF,
        senderType: "staff",
        body: "Second",
        visibility: "customer",
      }),
    ]);

    expect(await communication.Conversation.countDocuments({})).toBe(1);
    expect(await communication.Message.countDocuments({})).toBe(2);
  });
});

describe("read state — §13.5", () => {
  it("does not count your own message as unread", async () => {
    await service.postMessage({
      organizationId: ORG,
      ...subject,
      senderUserId: CUSTOMER,
      senderType: "customer",
      body: "Mine",
      visibility: "customer",
    });

    expect(
      await service.unreadForOrganization({
        organizationId: ORG,
        userId: CUSTOMER,
        audience: "customer",
      }),
    ).toBe(0);
  });

  it("counts a staff reply as unread for the customer, and not the internal note", async () => {
    await seedBothKinds();

    // Two staff messages exist; only one is customer-visible.
    expect(
      await service.unreadForOrganization({
        organizationId: ORG,
        userId: CUSTOMER,
        audience: "customer",
      }),
    ).toBe(1);
  });

  it("is idempotent, so reading on a second device changes nothing", async () => {
    await seedBothKinds();

    const read = () =>
      service.markThreadRead({
        organizationId: ORG,
        ...subject,
        userId: CUSTOMER,
        audience: "customer",
      });

    await read();
    await read();

    expect(
      await service.unreadForOrganization({
        organizationId: ORG,
        userId: CUSTOMER,
        audience: "customer",
      }),
    ).toBe(0);

    const stored = await communication.Message.find({ visibility: "customer" }).lean();
    for (const message of stored) {
      // `$addToSet`, so twice is once.
      const mine = message.readByUserIds.filter((id) => String(id) === CUSTOMER);
      expect(mine).toHaveLength(1);
    }
  });

  it("leaves an internal note unread-irrelevant to the customer after they read", async () => {
    await seedBothKinds();
    await service.markThreadRead({
      organizationId: ORG,
      ...subject,
      userId: CUSTOMER,
      audience: "customer",
    });

    // The customer's read must not mark the internal note as read by them —
    // that would put a customer's id in the read list of a message they are
    // not allowed to see, which reads very badly in an audit.
    const internal = await communication.Message.findOne({ visibility: "internal" }).lean();
    expect(internal!.readByUserIds.map(String)).not.toContain(CUSTOMER);
  });
});

describe("the §31 counters are fed without scanning messages", () => {
  it("records a customer reply and a visible staff reply separately", async () => {
    await seedBothKinds();

    const conversation = await communication.Conversation.findOne({}).lean();
    expect(conversation!.lastCustomerMessageAt).toBeInstanceOf(Date);
    expect(conversation!.lastStaffMessageAt).toBeInstanceOf(Date);
  });

  it("does not treat an internal note as having replied to the customer", async () => {
    // The bug this prevents: a request drops out of "awaiting staff response"
    // because somebody wrote a note to themselves, and the customer waits.
    await service.postMessage({
      organizationId: ORG,
      ...subject,
      senderUserId: CUSTOMER,
      senderType: "customer",
      body: "Any update?",
      visibility: "customer",
    });
    await service.postMessage({
      organizationId: ORG,
      ...subject,
      senderUserId: STAFF,
      senderType: "staff",
      body: INTERNAL,
      visibility: "internal",
    });

    const conversation = await communication.Conversation.findOne({}).lean();
    expect(conversation!.lastCustomerMessageAt).toBeInstanceOf(Date);
    expect(conversation!.lastStaffMessageAt).toBeUndefined();
  });
});
