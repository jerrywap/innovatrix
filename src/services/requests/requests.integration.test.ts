import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §91, §92, §34 — the guarantees that only a real database can demonstrate.
 *
 * Every case here is one where the wrong behaviour is silent: a status that
 * moved without a record, a customer's confirmed requirements quietly rewritten
 * by staff, an event handler failing and taking a transition down with it, or a
 * rolled-back submission burning a reference number nobody can account for.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./request-service");
let events: typeof import("@/lib/events");
let models: typeof import("@/lib/db/models/requests");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const OTHER_ORG = "6a80c46f6c887b38e2f0e0c9";
const CUSTOMER = "6a80c46f6c887b38e2f0e0b2";
const STAFF = "6a80c46f6c887b38e2f0e0a1";

/** Everything a staff actor could hold, for tests that are not about permissions. */
const ALL: readonly string[] = [
  "request.update_status",
  "request.close",
  "request.assign",
  "request.comment_internal",
  "quote.issue",
];

const staff = (permissions: readonly string[] = ALL) =>
  ({ type: "staff", userId: STAFF, name: "Sam", permissions: new Set(permissions) }) as const;

const customer = (organizationId = ORG) =>
  ({ type: "customer", userId: CUSTOMER, organizationId, name: "Amara" }) as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "requests_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./request-service");
  events = await import("@/lib/events");
  models = await import("@/lib/db/models/requests");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    models.CustomerRequest.syncIndexes(),
    models.AiConversation.syncIndexes(),
    communication.ActivityEvent.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  events.resetBus();
  await Promise.all([
    models.CustomerRequest.deleteMany({}),
    models.AiConversation.deleteMany({}),
    communication.ActivityEvent.deleteMany({}),
    mongoose.connection.collection("auditLogs").deleteMany({}),
    mongoose.connection.collection("counters").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

async function conversation(organizationId = ORG) {
  const created = await models.AiConversation.create({
    contextType: "customization",
    organizationId: new mongoose.Types.ObjectId(organizationId),
    userId: new mongoose.Types.ObjectId(CUSTOMER),
    status: "active",
  });
  return String(created._id);
}

async function submitted(organizationId = ORG) {
  return service.submitFromConversation({
    conversationId: await conversation(organizationId),
    kind: "customization",
    title: "Rota for a care agency",
    organizationId,
    userId: CUSTOMER,
    userName: "Amara",
    customerRequirements: [
      {
        key: "shifts",
        label: "Shift scheduling",
        origin: "confirmed",
        acceptedByCustomer: true,
      },
    ],
    assumptions: [
      { key: "mobile", label: "Mobile access", origin: "assumed", acceptedByCustomer: false },
    ],
    customerNotes: "We are moving offices in the spring, so nothing on the old server.",
  });
}

/* ────────────────────────────────────────────── tests */

describe("submission — §19, §25", () => {
  it("mints a reference, links the conversation, and marks it submitted", async () => {
    const request = await submitted();

    expect(request.reference).toMatch(/^CUS-\d{4}-\d{4}$/);
    expect(request.status).toBe("submitted");
    expect(request.waitingOn).toBe("innovatrix");

    const conv = await models.AiConversation.findById(request.aiConversationId).lean();
    expect(conv!.status).toBe("submitted");
    expect(String(conv!.submittedRequestId)).toBe(String(request._id));
  });

  it("keeps the customer's own notes", async () => {
    /*
     * Not a formality. "Anything else" had a textarea, a `maxLength` and a Zod
     * rule validating it, and then `submitRequirementsAction` never passed it on
     * — `SubmitInput` had no field and the document had no column — so every
     * sentence anyone wrote there was parsed, trimmed, validated and dropped.
     * Nothing failed and nothing said so.
     *
     * Asserted here rather than in a unit test because the write happens inside
     * the submission transaction, alongside the conversation update and the
     * activity row: what matters is that it is on the document that actually
     * committed, not that a mapping function returned it.
     */
    const request = await submitted();
    expect(request.customerNotes).toBe(
      "We are moving offices in the spring, so nothing on the old server.",
    );
  });

  it("keeps confirmed requirements and assumptions in separate fields", async () => {
    // §17 end to end: they are two arrays in the schema and must stay two.
    const request = await submitted();
    expect(request.customerRequirements.map((r) => r.key)).toEqual(["shifts"]);
    expect(request.assumptions.map((r) => r.key)).toEqual(["mobile"]);
  });

  it("returns the existing request when the same conversation is submitted twice", async () => {
    // A second tab, or a retried action. One conversation is one request.
    const conversationId = await conversation();
    const input = {
      conversationId,
      kind: "customization" as const,
      title: "Rota",
      organizationId: ORG,
      userId: CUSTOMER,
      customerRequirements: [],
      assumptions: [],
    };

    const first = await service.submitFromConversation(input);
    const second = await service.submitFromConversation(input);

    expect(String(second._id)).toBe(String(first._id));
    expect(await models.CustomerRequest.countDocuments({})).toBe(1);
  });

  it("burns no reference when the submission rolls back", async () => {
    // The counter joins the transaction, so a failed submit must not leave a
    // gap in a sequence people read as complete.
    await expect(
      service.submitFromConversation({
        conversationId: String(new mongoose.Types.ObjectId()),
        kind: "custom_build",
        title: "Nope",
        organizationId: ORG,
        userId: CUSTOMER,
        customerRequirements: [],
        assumptions: [],
      }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    const next = await submitted();
    expect(next.reference).toMatch(/-0001$/);
  });
});

describe("the state machine refuses what it should — §91", () => {
  it("rejects submitted → converted even when called directly", async () => {
    const request = await submitted();

    await expect(
      service.transition({
        requestId: String(request._id),
        to: "converted",
        actor: staff(),
      }),
    ).rejects.toBeInstanceOf(errors.StateTransitionError);

    const after = await models.CustomerRequest.findById(request._id).lean();
    expect(after!.status).toBe("submitted");
  });

  it("refuses a staff-only transition to a customer", async () => {
    const request = await submitted();

    await expect(
      service.transition({
        requestId: String(request._id),
        to: "under_review",
        actor: customer(),
      }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("refuses a staff member without the permission the edge names", async () => {
    const request = await submitted();

    await expect(
      service.transition({
        requestId: String(request._id),
        to: "under_review",
        actor: staff(["request.comment_internal"]),
      }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("hides another organisation's request from a customer entirely", async () => {
    const request = await submitted();

    await expect(
      service.transition({
        requestId: String(request._id),
        to: "cancelled",
        actor: customer(OTHER_ORG),
      }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("lets a customer cancel their own", async () => {
    const request = await submitted();
    const cancelled = await service.transition({
      requestId: String(request._id),
      to: "cancelled",
      actor: customer(),
    });
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("every transition leaves exactly one of each record — §70, §90", () => {
  it("writes one activity event and one audit entry", async () => {
    const request = await submitted();
    await communication.ActivityEvent.deleteMany({});
    await mongoose.connection.collection("auditLogs").deleteMany({});

    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });

    expect(await communication.ActivityEvent.countDocuments({})).toBe(1);
    expect(await mongoose.connection.collection("auditLogs").countDocuments({})).toBe(1);
  });

  it("keeps the internal note out of the customer's timeline", async () => {
    // §37: the failure here is a customer reading staff deliberation, so the
    // two audiences get two rows rather than one row with a flag.
    const request = await submitted();

    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
      internalNote: "Looks like a rebuild, not a customisation. Flagging to Tom.",
    });

    const customerVisible = await communication.ActivityEvent.find({
      subjectId: request._id,
      visibility: "customer",
    }).lean();

    expect(customerVisible).toHaveLength(2); // submitted + under_review
    for (const event of customerVisible) {
      expect(event.message).not.toMatch(/rebuild/i);
    }

    const internal = await communication.ActivityEvent.find({
      subjectId: request._id,
      visibility: "internal",
    }).lean();
    expect(internal).toHaveLength(1);
    expect(internal[0]!.message).toMatch(/rebuild/i);
  });

  it("describes the move in the customer's language, not the enum's", async () => {
    const request = await submitted();
    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });
    await service.transition({
      requestId: String(request._id),
      to: "technical_review",
      actor: staff(),
    });

    const latest = await communication.ActivityEvent.findOne({ subjectId: request._id })
      .sort({ createdAt: -1 })
      .lean();

    expect(latest!.message).not.toMatch(/technical_review/);
    expect(latest!.message).toMatch(/technical team/i);
  });
});

describe("progress updates carry the work past payment — §70", () => {
  it("writes a customer-visible entry with no state change", async () => {
    /*
     * The gap this closes: `transition()` was the only writer of a
     * customer-visible activity row, and `converted` — reached automatically
     * when the deposit clears — was terminal. So a job in flight produced
     * silence, and the customer's last update was "payment received".
     */
    const request = await submitted();
    const before = await service.findByReference(request.reference, { organizationId: ORG });
    await communication.ActivityEvent.deleteMany({});

    await service.postProgressUpdate({
      requestId: String(request._id),
      actor: staff(),
      message: "Tenant portal is done and on the test site.",
    });

    const after = await service.findByReference(request.reference, { organizationId: ORG });
    expect(after?.status, "status must not move").toBe(before?.status);

    const visible = await communication.ActivityEvent.find({
      subjectId: request._id,
      visibility: "customer",
    }).lean();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.message).toContain("test site");
  });

  it("keeps the internal note out of the customer's timeline", async () => {
    // §37, on a second writer. The rule is not "the filter works" — it is that
    // two audiences get two rows, so there is nothing to filter wrongly.
    const request = await submitted();
    await communication.ActivityEvent.deleteMany({});

    await service.postProgressUpdate({
      requestId: String(request._id),
      actor: staff(),
      message: "Reporting is next.",
      internalNote: "Blocked on their DNS change; chase Tom.",
    });

    const visible = await communication.ActivityEvent.find({
      subjectId: request._id,
      visibility: "customer",
    }).lean();
    const internal = await communication.ActivityEvent.find({
      subjectId: request._id,
      visibility: "internal",
    }).lean();

    expect(visible).toHaveLength(1);
    expect(internal).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain("DNS");
  });

  it("refuses an empty update", async () => {
    const request = await submitted();
    await expect(
      service.postProgressUpdate({
        requestId: String(request._id),
        actor: staff(),
        message: "   ",
      }),
    ).rejects.toThrow();
  });
});

describe("events — §92", () => {
  it("emits after the transition, with the from and to", async () => {
    const seen: unknown[] = [];
    events.on("RequestStatusChanged", (payload) => {
      seen.push(payload);
    });

    const request = await submitted();
    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ from: "submitted", to: "under_review" });
  });

  it("does not roll back the transition when a handler throws", async () => {
    // The explicit criterion. An email provider being down cannot un-move a
    // request that has moved.
    events.on("RequestStatusChanged", () => {
      throw new Error("email is down");
    });

    const request = await submitted();
    const moved = await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });

    expect(moved.status).toBe("under_review");
    const persisted = await models.CustomerRequest.findById(request._id).lean();
    expect(persisted!.status).toBe("under_review");
  });

  it("runs the handlers after a failing one", async () => {
    // Otherwise registration order becomes an undocumented priority list.
    const ran: string[] = [];
    events.on("RequestStatusChanged", () => {
      ran.push("first");
      throw new Error("boom");
    });
    events.on("RequestStatusChanged", () => {
      ran.push("second");
    });

    const request = await submitted();
    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });

    expect(ran).toEqual(["first", "second"]);
  });

  it("emits CustomerActionRequested when the request starts waiting on them", async () => {
    const seen: unknown[] = [];
    events.on("CustomerActionRequested", (payload) => {
      seen.push(payload);
    });

    const request = await submitted();
    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });
    const waiting = await service.transition({
      requestId: String(request._id),
      to: "waiting_for_customer",
      actor: staff(),
      note: "Which payroll system do you use?",
    });

    expect(waiting.waitingOn).toBe("customer");
    expect(seen).toHaveLength(1);
  });
});

describe("requirements are the customer's — §34", () => {
  it("refuses a staff actor through the API, not merely in the UI", async () => {
    const request = await submitted();

    await expect(
      service.reviseRequirements({
        requestId: String(request._id),
        actor: staff(),
        requirements: [
          {
            key: "x",
            label: "Whatever staff want",
            origin: "confirmed",
            acceptedByCustomer: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    const after = await models.CustomerRequest.findById(request._id).lean();
    expect(after!.customerRequirements.map((r) => r.key)).toEqual(["shifts"]);
  });

  it("versions an edit and keeps what it replaced", async () => {
    const request = await submitted();

    const revised = await service.reviseRequirements({
      requestId: String(request._id),
      actor: customer(),
      requirements: [
        {
          key: "shifts",
          label: "Shift scheduling",
          origin: "confirmed",
          acceptedByCustomer: true,
        },
        {
          key: "payroll",
          label: "Payroll export",
          origin: "confirmed",
          acceptedByCustomer: true,
        },
      ],
    });

    expect(revised.requirementsVersion).toBe(2);
    expect(revised.customerRequirements).toHaveLength(2);

    // History holds the *previous* version, and says who changed it.
    expect(revised.requirementsHistory).toHaveLength(1);
    expect(revised.requirementsHistory[0]!.version).toBe(1);
    expect(revised.requirementsHistory[0]!.requirements.map((r) => r.key)).toEqual(["shifts"]);
    expect(String(revised.requirementsHistory[0]!.changedByUserId)).toBe(CUSTOMER);
  });

  it("refuses an edit once the work has moved past the customer", async () => {
    const request = await submitted();
    await service.transition({
      requestId: String(request._id),
      to: "under_review",
      actor: staff(),
    });
    await service.transition({
      requestId: String(request._id),
      to: "technical_review",
      actor: staff(),
    });

    // Changing scope after a technical review has begun silently invalidates it.
    await expect(
      service.reviseRequirements({
        requestId: String(request._id),
        actor: customer(),
        requirements: [],
      }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("keeps internal interpretation separate from what the customer said", async () => {
    const request = await submitted();

    await service.setInternalInterpretation({
      requestId: String(request._id),
      actor: staff(),
      text: "Really a bespoke build; the base product only covers 30% of this.",
    });

    const after = await models.CustomerRequest.findById(request._id).lean();
    expect(after!.internalInterpretation).toMatch(/bespoke/);
    // Untouched — the whole point of the separation.
    expect(after!.customerRequirements.map((r) => r.key)).toEqual(["shifts"]);
  });
});

describe("assignment keeps its history — §40", () => {
  it("closes the previous assignment rather than replacing it", async () => {
    const request = await submitted();
    const second = "6a80c46f6c887b38e2f0e0a2";

    await service.assign({
      requestId: String(request._id),
      actor: staff(),
      assigneeUserId: STAFF,
    });
    const reassigned = await service.assign({
      requestId: String(request._id),
      actor: staff(),
      assigneeUserId: second,
      note: "Better fit for the rota work",
    });

    expect(String(reassigned.currentAssigneeUserId)).toBe(second);
    expect(reassigned.assignments).toHaveLength(2);

    const [first, latest] = reassigned.assignments;
    expect(first!.unassignedAt).toBeInstanceOf(Date);
    expect(latest!.unassignedAt).toBeUndefined();
    expect(String(latest!.assignedByUserId)).toBe(STAFF);
  });

  it("refuses a staff member without request.assign", async () => {
    const request = await submitted();
    await expect(
      service.assign({
        requestId: String(request._id),
        actor: staff(["request.update_status"]),
        assigneeUserId: STAFF,
      }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });
});

describe("permittedTransitions drives the UI from the same rules", () => {
  it("offers a customer only what they may actually do", async () => {
    const offered = service.permittedTransitions("submitted", customer()).map((t) => t.to);
    expect(offered).toEqual(["cancelled"]);
  });

  it("offers staff what their permissions allow, and no more", async () => {
    const limited = service
      .permittedTransitions("under_review", staff(["request.update_status"]))
      .map((t) => t.to);

    expect(limited).toContain("waiting_for_customer");
    expect(limited).toContain("technical_review");
    // `quoted` needs `quote.issue`; `rejected`/`cancelled` need `request.close`.
    expect(limited).not.toContain("quoted");
    expect(limited).not.toContain("rejected");
  });

  it("labels each action in words a person would click", async () => {
    for (const action of service.permittedTransitions("under_review", staff())) {
      expect(action.label).toMatch(/^[A-Z]/);
      expect(action.label).not.toMatch(/_/);
    }
  });
});
