import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §51, §52, §90 — the quote as a commercial commitment.
 *
 * Acceptance is a contract event and must be reconstructable months later. Most
 * of what is checked here is therefore about **what survives**: the version
 * somebody agreed to, the quote they were looking at before a revision, the
 * audit row that says who accepted and when.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./quote-service");
let events: typeof import("@/lib/events");
let billing: typeof import("@/lib/db/models/billing");
let requests: typeof import("@/lib/db/models/requests");
let errors: typeof import("@/lib/errors");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const OTHER_ORG = "6a80c46f6c887b38e2f0e0c9";
const CUSTOMER = "6a80c46f6c887b38e2f0e0b2";
const STAFF = "6a80c46f6c887b38e2f0e0a1";

const ISSUER = { userId: STAFF, name: "Sam", permissions: new Set(["quote.issue"]) };
const DRAFTER = { userId: STAFF, name: "Sam", permissions: new Set(["quote.draft"]) };
const BUYER = { userId: CUSTOMER, organizationId: ORG, name: "Amara", ip: "203.0.113.7" };

const DAY = 86_400_000;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "quotes_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./quote-service");
  events = await import("@/lib/events");
  billing = await import("@/lib/db/models/billing");
  requests = await import("@/lib/db/models/requests");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([billing.Quote.syncIndexes(), requests.CustomerRequest.syncIndexes()]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  events.resetBus();
  await Promise.all([
    billing.Quote.deleteMany({}),
    requests.CustomerRequest.deleteMany({}),
    mongoose.connection.collection("auditLogs").deleteMany({}),
    mongoose.connection.collection("activityEvents").deleteMany({}),
    mongoose.connection.collection("counters").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

async function request(organizationId = ORG) {
  const created = await requests.CustomerRequest.create({
    reference: `REQ-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    kind: "custom_build",
    organizationId: new mongoose.Types.ObjectId(organizationId),
    userId: new mongoose.Types.ObjectId(CUSTOMER),
    title: "Rota system",
    customerRequirements: [],
    assumptions: [],
    status: "under_review",
  });
  return String(created._id);
}

function draftInput(requestId: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    organizationId: ORG,
    title: "Rota system for a care agency",
    deliverables: ["Shift scheduling", "Timesheets"],
    exclusions: ["Payroll processing itself"],
    currency: "GBP",
    items: [
      {
        kind: "development" as const,
        description: "Build",
        quantity: 1,
        unitPriceAmount: 800_000,
      },
      { kind: "service" as const, description: "Setup", quantity: 2, unitPriceAmount: 50_000 },
    ],
    taxBasisPoints: 2000,
    paymentTerms: "deposit_balance" as const,
    depositBasisPoints: 5000,
    expiresAt: new Date(Date.now() + 30 * DAY),
    ...overrides,
  };
}

async function issued(overrides: Record<string, unknown> = {}) {
  const requestId = await request();
  const draft = await service.createDraft(draftInput(requestId, overrides), ISSUER);
  return service.issue(String(draft._id), ISSUER);
}

/* ────────────────────────────────────────────── tests */

describe("drafting", () => {
  it("prices the lines and the total server-side", async () => {
    const draft = await service.createDraft(draftInput(await request()), ISSUER);

    // £8,000 + (2 × £500) = £9,000, +20% = £10,800.
    expect(draft.subtotal.amount).toBe(900_000);
    expect(draft.tax!.amount).toBe(180_000);
    expect(draft.total.amount).toBe(1_080_000);
    expect(draft.items[1]!.lineTotal.amount).toBe(100_000);
  });

  it("mints a QUO reference and starts at version 1", async () => {
    const draft = await service.createDraft(draftInput(await request()), ISSUER);
    expect(draft.reference).toMatch(/^QUO-\d{4}-\d{4}$/);
    expect(draft.version).toBe(1);
    expect(draft.status).toBe("draft");
  });

  it("refuses a request from another organisation", async () => {
    const foreign = await request(OTHER_ORG);
    await expect(service.createDraft(draftInput(foreign), ISSUER)).rejects.toBeInstanceOf(
      errors.NotFoundError,
    );
  });
});

describe("issuing", () => {
  it("refuses somebody who can only draft", async () => {
    const draft = await service.createDraft(draftInput(await request()), ISSUER);
    await expect(service.issue(String(draft._id), DRAFTER)).rejects.toBeInstanceOf(
      errors.ForbiddenError,
    );
  });

  it("refuses a quote with no lines", async () => {
    const draft = await service.createDraft(draftInput(await request(), { items: [] }), ISSUER);
    await expect(service.issue(String(draft._id), ISSUER)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });

  it("refuses an expiry already in the past", async () => {
    // The one that bites in practice: the customer discovers it, not the sender.
    const draft = await service.createDraft(
      draftInput(await request(), { expiresAt: new Date(Date.now() - DAY) }),
      ISSUER,
    );
    await expect(service.issue(String(draft._id), ISSUER)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });

  it("moves the request to quoted and puts it on the customer's timeline", async () => {
    const quote = await issued();

    expect(quote.status).toBe("issued");
    expect(quote.issuedAt).toBeInstanceOf(Date);

    const parent = await requests.CustomerRequest.findById(quote.requestId).lean();
    expect(parent!.status).toBe("quoted");

    // §102: the quote must reach "Needs Your Attention" the moment it is issued,
    // and the customer-visible activity row is what puts it there.
    const activity = await mongoose.connection
      .collection("activityEvents")
      .find({ subjectId: quote._id, visibility: "customer" })
      .toArray();
    expect(activity).toHaveLength(1);
  });

  it("cannot be issued twice", async () => {
    const quote = await issued();
    await expect(service.issue(String(quote._id), ISSUER)).rejects.toBeInstanceOf(
      errors.StateTransitionError,
    );
  });
});

describe("revising produces a version, never an edit", () => {
  it("creates v2, supersedes v1, and keeps v1 readable", async () => {
    const v1 = await issued();

    const v2 = await service.revise(
      String(v1._id),
      {
        ...draftInput(String(v1.requestId)),
        items: [
          {
            kind: "development",
            description: "Build (reduced scope)",
            quantity: 1,
            unitPriceAmount: 600_000,
          },
        ],
      },
      ISSUER,
    );

    expect(v2.version).toBe(2);
    expect(v2.reference).toBe(v1.reference);
    expect(String(v2.supersedesQuoteId)).toBe(String(v1._id));

    const previous = await billing.Quote.findById(v1._id).lean();
    expect(previous!.status).toBe("superseded");
    // Still there, and still saying what it said. Editing in place would
    // destroy the record of what was on the table.
    expect(previous!.total.amount).toBe(1_080_000);
  });

  it("refuses to revise an accepted quote", async () => {
    // `accepted` is terminal. A revision after acceptance would rewrite a
    // contract somebody has already agreed to.
    const quote = await issued();
    await service.accept(String(quote._id), BUYER);

    await expect(
      service.revise(String(quote._id), draftInput(String(quote.requestId)), ISSUER),
    ).rejects.toBeInstanceOf(errors.StateTransitionError);
  });
});

describe("acceptance is a contract event — §51, §90", () => {
  it("records who, when, and which version", async () => {
    const quote = await issued();
    const accepted = await service.accept(String(quote._id), BUYER);

    expect(accepted.status).toBe("accepted");
    expect(String(accepted.acceptedByUserId)).toBe(CUSTOMER);
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    // Copied, not referenced — "reconstructable months later" must not depend
    // on the row still saying what it says today.
    expect(accepted.acceptedQuoteVersion).toBe(1);
  });

  it("audits it with the actor and the IP", async () => {
    const quote = await issued();
    await service.accept(String(quote._id), BUYER);

    const audit = await mongoose.connection
      .collection("auditLogs")
      .findOne({ action: "quote.accepted" });

    expect(audit).not.toBeNull();
    expect(audit!.ip).toBe("203.0.113.7");
    expect(audit!.after).toMatchObject({ version: 1, total: 1_080_000, currency: "GBP" });
  });

  it("moves the request to approved and emits with the version", async () => {
    const seen: unknown[] = [];
    events.on("QuoteAccepted", (payload) => {
      seen.push(payload);
    });

    const quote = await issued();
    await service.accept(String(quote._id), BUYER);

    const parent = await requests.CustomerRequest.findById(quote.requestId).lean();
    expect(parent!.status).toBe("approved");
    expect(seen[0]).toMatchObject({ version: 1, total: 1_080_000 });
  });

  it("refuses an expired quote even while the status still says issued", async () => {
    /*
     * The gap ticket 25's sweep leaves: between the expiry passing and the job
     * running, `status` is still `issued`. Accepting in that window would make
     * a contract from a lapsed quote — so the *date* decides, not the field.
     */
    const quote = await issued();
    await billing.Quote.updateOne(
      { _id: quote._id },
      { $set: { expiresAt: new Date(Date.now() - DAY) } },
    );

    await expect(service.accept(String(quote._id), BUYER)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );

    const after = await billing.Quote.findById(quote._id).lean();
    expect(after!.status).toBe("issued");
  });

  it("hides another organisation's quote entirely", async () => {
    const quote = await issued();
    await expect(
      service.accept(String(quote._id), { ...BUYER, organizationId: OTHER_ORG }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("cannot be accepted twice", async () => {
    const quote = await issued();
    await service.accept(String(quote._id), BUYER);
    await expect(service.accept(String(quote._id), BUYER)).rejects.toBeInstanceOf(
      errors.StateTransitionError,
    );
  });
});

describe("rejection", () => {
  it("records the reason and sends the request back for review", async () => {
    const quote = await issued();
    const rejected = await service.reject(String(quote._id), BUYER, "Over our budget");

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Over our budget");

    // Back to `under_review` rather than left in `quoted`, where it would sit
    // with nobody looking at it.
    const parent = await requests.CustomerRequest.findById(quote.requestId).lean();
    expect(parent!.status).toBe("under_review");
  });
});

describe("first view, for the audit trail", () => {
  it("is written once and never overwritten", async () => {
    const quote = await issued();

    await service.recordFirstView(String(quote._id));
    const first = await billing.Quote.findById(quote._id).lean();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.recordFirstView(String(quote._id));
    const second = await billing.Quote.findById(quote._id).lean();

    expect(first!.firstViewedAt).toBeInstanceOf(Date);
    expect(second!.firstViewedAt!.getTime()).toBe(first!.firstViewedAt!.getTime());
  });
});
