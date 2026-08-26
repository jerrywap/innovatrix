import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §69 — notifications.
 *
 * The criteria this file exists for: every catalog row produces what it says,
 * exactly one notification per recipient per event, an email failure changes
 * nothing, opting out never suppresses a receipt, and no internal note reaches
 * a customer.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./notification-service");
let catalog: typeof import("./catalog");
let handlers: typeof import("./handlers");
let events: typeof import("@/lib/events");
let communication: typeof import("@/lib/db/models/communication");
let identity: typeof import("@/lib/db/models/identity");
let email: typeof import("@/services/email");
let jobs: typeof import("@/services/jobs/runner");
let system: typeof import("@/lib/db/models/system");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const OWNER = "6a80c46f6c887b38e2f0e0b2";
const TECHNICAL = "6a80c46f6c887b38e2f0e0b3";
const STAFF = "6a80c46f6c887b38e2f0e0a1";

/** Every message the fake transport was handed, in order. */
let sent: Array<{ to: string; subject: string; text: string; html?: string }>;
let failSending = false;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "notifications_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./notification-service");
  catalog = await import("./catalog");
  handlers = await import("./handlers");
  events = await import("@/lib/events");
  communication = await import("@/lib/db/models/communication");
  identity = await import("@/lib/db/models/identity");
  email = await import("@/services/email");
  jobs = await import("@/services/jobs/runner");
  system = await import("@/lib/db/models/system");

  email.setEmailTransport({
    name: "test",
    async send(message) {
      if (failSending) throw new Error("mail provider is down");
      sent.push(message);
    },
  });

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    communication.Notification.syncIndexes(),
    communication.NotificationPreference.syncIndexes(),
    // The unique index on `idempotencyKey` is what makes one notification
    // produce one email however many times dispatch runs.
    system.Job.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  email.setEmailTransport(undefined);
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  events.resetBus();
  sent = [];
  failSending = false;
  await Promise.all([
    communication.Notification.deleteMany({}),
    communication.NotificationPreference.deleteMany({}),
    communication.Conversation.deleteMany({}),
    identity.User.deleteMany({}),
    identity.OrganizationMember.deleteMany({}),
    identity.StaffProfile.deleteMany({}),
    system.Job.deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

async function people() {
  sent = [];

  await identity.User.create([
    { _id: OWNER, name: "Amara", email: "amara@example.test", emailVerified: true },
    { _id: TECHNICAL, name: "Tobi", email: "tobi@example.test", emailVerified: true },
    {
      _id: STAFF,
      name: "Sam",
      email: "sam@innovatrix.test",
      emailVerified: true,
      isStaff: true,
    },
  ]);

  await identity.OrganizationMember.create([
    { organizationId: ORG, userId: OWNER, role: "owner", status: "active" },
    { organizationId: ORG, userId: TECHNICAL, role: "technical", status: "active" },
  ]);

  await identity.StaffProfile.create({
    userId: STAFF,
    roles: ["super_admin"],
    teams: [],
    isActive: true,
  });
}

/**
 * Run the queue, so `sent` reflects what actually reached an inbox.
 *
 * Since ticket 25 the email channel **enqueues** a `send-email` job rather than
 * calling the transport. That is the point — a mail provider blip now retries
 * instead of vanishing — but it means dispatch alone no longer sends anything,
 * and a test asserting on `sent` immediately after it would be asserting that
 * the queue exists rather than that the email is right.
 *
 * Draining keeps every assertion below end-to-end: dispatch → job → transport.
 */
async function deliverQueuedEmail(): Promise<void> {
  await jobs.drainQueue({ maxJobs: 20, budgetMs: 5_000 });
}

async function rowsFor(userId: string) {
  return communication.Notification.find({ recipientUserId: userId })
    .sort({ createdAt: 1 })
    .lean<Array<{ title: string; href?: string; category: string; dedupeKey: string }>>();
}

/* ────────────────────────────────────────────── tests */

describe("the catalog is the contract — §69", () => {
  it("every rule produces a title and an href for its event", () => {
    // Not a behavioural test: a guard against a row that renders `undefined`
    // into somebody's inbox because a payload field was renamed.
    for (const [event, rules] of Object.entries(catalog.CATALOG)) {
      for (const rule of rules ?? []) {
        expect(rule.category, `${event} has a category`).toBeTruthy();
        expect(typeof rule.title, `${event} has a title`).toBe("function");
        expect(typeof rule.href, `${event} has an href`).toBe("function");
      }
    }
  });

  it("sends the customer and the staff queue to different screens", async () => {
    await people();

    await service.dispatch(
      "RequestSubmitted",
      {
        requestId: "6a80c46f6c887b38e2f0e0c1",
        reference: "REQ-2026-0001",
        organizationId: ORG,
        kind: "custom_build",
      },
      { organizationId: ORG, ownerUserId: OWNER },
    );

    const [customer] = await rowsFor(OWNER);
    const [staff] = await rowsFor(STAFF);

    expect(customer!.href).toBe("/dashboard/requests/REQ-2026-0001");
    expect(staff!.href).toBe("/staff/requests/REQ-2026-0001");
    // Same event, two audiences, two screens — the reason a rule carries its
    // own href rather than the event doing so.
    expect(customer!.title).not.toBe(staff!.title);
  });
});

describe("exactly once — §87", () => {
  it("a re-dispatched event writes one notification, not two", async () => {
    await people();

    const payload = {
      quoteId: "6a80c46f6c887b38e2f0e0d1",
      reference: "QUO-2026-0001",
      organizationId: ORG,
      requestId: "6a80c46f6c887b38e2f0e0c1",
      total: 100_000,
      currency: "GBP",
    };

    const first = await service.dispatch("QuoteIssued", payload, { organizationId: ORG });
    const second = await service.dispatch("QuoteIssued", payload, { organizationId: ORG });

    expect(first.written).toBe(2); // owner + technical
    // Asserted so a degraded dispatch fails here, naming the cause, rather
    // than three assertions later as an unexplained empty array.
    expect(first.failed).toBe(0);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(2);

    expect(await communication.Notification.countDocuments({})).toBe(2);

    // Two jobs, not four — the second dispatch never got as far as the email
    // channel, and the `send-email:notification:<id>` key would have refused it
    // if it had.
    expect(await system.Job.countDocuments({ name: "send-email" })).toBe(2);

    // And one email each, not two.
    await deliverQueuedEmail();
    expect(sent).toHaveLength(2);
  });

  it("does not notify somebody about their own action", async () => {
    await people();

    await service.dispatch(
      "RequestAssigned",
      {
        requestId: "6a80c46f6c887b38e2f0e0c1",
        reference: "REQ-2026-0001",
        organizationId: ORG,
        assigneeUserId: STAFF,
        assignedByUserId: STAFF,
      },
      { organizationId: ORG, assigneeUserId: STAFF, actorUserId: STAFF },
    );

    expect(await rowsFor(STAFF)).toHaveLength(0);
  });
});

describe("preferences — §69", () => {
  it("muting a category stops its email and keeps the in-app row", async () => {
    await people();

    await service.setPreference({
      userId: OWNER,
      category: "quotes",
      channel: "email",
      enabled: false,
    });

    await service.dispatch(
      "QuoteIssued",
      {
        quoteId: "6a80c46f6c887b38e2f0e0d1",
        reference: "QUO-2026-0001",
        organizationId: ORG,
        requestId: "6a80c46f6c887b38e2f0e0c1",
        total: 100_000,
        currency: "GBP",
      },
      { organizationId: ORG },
    );

    // The notification is the record; email is a copy of it.
    expect(await rowsFor(OWNER)).toHaveLength(1);

    await deliverQueuedEmail();
    expect(sent.map((m) => m.to)).toEqual(["tobi@example.test"]);
  });

  it("never suppresses a payment receipt, however hard you try", async () => {
    // The explicit criterion. Both halves: the service refuses to store the
    // preference, and dispatch would ignore it even if one existed.
    await people();

    await expect(
      service.setPreference({
        userId: OWNER,
        category: "billing",
        channel: "email",
        enabled: false,
      }),
    ).rejects.toThrow();

    // Force the row in anyway, as though it predated the rule.
    await communication.NotificationPreference.updateOne(
      { userId: OWNER },
      { $addToSet: { muted: "billing:email" } },
      { upsert: true },
    );

    await service.dispatch(
      "InvoicePaid",
      {
        invoiceId: "6a80c46f6c887b38e2f0e0e1",
        reference: "INV-2026-0001",
        organizationId: ORG,
        sourceType: "quote",
        sourceId: "6a80c46f6c887b38e2f0e0d1",
        total: 100_000,
        currency: "GBP",
      },
      { organizationId: ORG },
    );

    await deliverQueuedEmail();
    expect(sent.map((m) => m.to)).toContain("amara@example.test");
  });

  /**
   * The account-security alerts, and the one mistake that would ship silently.
   *
   * `resolveAudience` strips `context.actorUserId` from every audience — nobody
   * is notified about a button they just pressed. Correct everywhere else, and
   * exactly wrong for a security alert: the person who changed the password is
   * the person who has to hear about it, and if it was not them then the actor
   * is an attacker. Get it wrong and `dispatch` filters the audience to nobody
   * and reports a clean run, so nothing fails and no one is told.
   *
   * Asserted through `emit` rather than `dispatch` on purpose. `dispatch` takes
   * the context as an argument, so calling it directly would prove the catalogue
   * row works while testing none of the wiring in `handlers.ts` — which is where
   * the actor would have been passed.
   */
  it("tells the account holder about a password change, and lets nothing mute it", async () => {
    await people();

    await service.setPreference({
      userId: OWNER,
      category: "requests",
      channel: "email",
      enabled: false,
    });
    // Forced in directly, as though it predated the rule that refuses it.
    await communication.NotificationPreference.updateOne(
      { userId: OWNER },
      { $addToSet: { muted: "security:email" } },
      { upsert: true },
    );

    handlers.registerNotificationHandlers();
    await events.emit("PasswordChanged", { userId: OWNER });

    const rows = await rowsFor(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe("security");
    expect(rows[0]?.href).toBe("/dashboard/account/security");

    await deliverQueuedEmail();
    expect(sent.map((m) => m.to)).toEqual(["amara@example.test"]);
    // Nobody else's business: not the organisation, not the technical contact.
    expect(await rowsFor(TECHNICAL)).toHaveLength(0);
  });

  it("keeps billing notices to the billing roles", async () => {
    await people();

    await service.dispatch(
      "InvoiceIssued",
      {
        invoiceId: "6a80c46f6c887b38e2f0e0e1",
        reference: "INV-2026-0001",
        organizationId: ORG,
        portion: "full",
        total: 100_000,
        currency: "GBP",
      },
      { organizationId: ORG },
    );

    expect(await rowsFor(OWNER)).toHaveLength(1);
    // §89 — the technical contact is not the billing contact.
    expect(await rowsFor(TECHNICAL)).toHaveLength(0);
  });
});

describe("email failure — §92, §86", () => {
  it("leaves the notification standing, and retries the email until it lands", async () => {
    await people();
    failSending = true;

    const result = await service.dispatch(
      "QuoteIssued",
      {
        quoteId: "6a80c46f6c887b38e2f0e0d1",
        reference: "QUO-2026-0001",
        organizationId: ORG,
        requestId: "6a80c46f6c887b38e2f0e0c1",
        total: 100_000,
        currency: "GBP",
      },
      { organizationId: ORG },
    );

    expect(result.written).toBe(2);

    // The domain outcome is unaffected — the criterion §92 actually states.
    await deliverQueuedEmail();
    expect(sent).toHaveLength(0);

    const afterFailure = await communication.Notification.find({}).lean<
      Array<{ emailSentAt?: Date; channels: string[] }>
    >();
    expect(afterFailure).toHaveLength(2);
    expect(afterFailure.every((row) => row.emailSentAt === undefined)).toBe(true);
    /*
     * `channels` records the *intent*, which is what makes the retry query
     * possible at all. Stamping the channel on success — the old behaviour —
     * described a state that could not exist, because success also sets
     * `emailSentAt`, so "an email channel and no stamp" matched nothing.
     */
    expect(afterFailure.every((row) => row.channels.includes("email"))).toBe(true);

    // The jobs are still there, waiting, with the failure recorded.
    const failed = await system.Job.find({ name: "send-email" }).lean<
      Array<{ status: string; attempts: number; lastError?: string }>
    >();
    expect(failed).toHaveLength(2);
    expect(failed.every((job) => job.status === "failed")).toBe(true);
    expect(failed.every((job) => job.lastError === "mail provider is down")).toBe(true);

    /*
     * The provider comes back. This is the half the old test could not assert,
     * because before ticket 25 there was no next attempt: the driver caught the
     * error, logged it, and the email was gone.
     */
    failSending = false;
    await system.Job.updateMany({ name: "send-email" }, { $set: { runAt: new Date() } });
    await deliverQueuedEmail();

    expect(sent).toHaveLength(2);

    const afterRetry = await communication.Notification.find({}).lean<
      Array<{ emailSentAt?: Date }>
    >();
    expect(afterRetry.every((row) => row.emailSentAt instanceof Date)).toBe(true);
  });
});

describe("internal notes stay internal — §37", () => {
  it("an internal message notifies staff participants only", async () => {
    await people();

    const conversation = await communication.Conversation.create({
      organizationId: ORG,
      subjectType: "request",
      subjectId: "6a80c46f6c887b38e2f0e0c1",
      participantUserIds: [OWNER, STAFF],
    });

    handlers.registerNotificationHandlers();

    await events.emit("MessagePosted", {
      conversationId: String(conversation._id),
      messageId: "6a80c46f6c887b38e2f0e0f1",
      organizationId: ORG,
      subjectType: "request",
      subjectId: "6a80c46f6c887b38e2f0e0c1",
      subjectReference: "REQ-2026-0001",
      // Somebody other than either participant, so neither is filtered as the
      // actor and the audience rule is the only thing doing the work.
      senderUserId: "6a80c46f6c887b38e2f0e0ff",
      audience: "internal",
    });

    expect(await rowsFor(STAFF)).toHaveLength(1);
    expect(await rowsFor(OWNER)).toHaveLength(0);

    // And nothing about it reached the customer's inbox either.
    await deliverQueuedEmail();
    expect(sent.map((m) => m.to)).toEqual(["sam@innovatrix.test"]);
  });

  it("never puts a message body in the notification", async () => {
    await people();

    const conversation = await communication.Conversation.create({
      organizationId: ORG,
      subjectType: "request",
      subjectId: "6a80c46f6c887b38e2f0e0c1",
      participantUserIds: [OWNER, STAFF],
    });

    await service.dispatch(
      "MessagePosted",
      {
        conversationId: String(conversation._id),
        messageId: "6a80c46f6c887b38e2f0e0f1",
        organizationId: ORG,
        subjectType: "request",
        subjectId: "6a80c46f6c887b38e2f0e0c1",
        subjectReference: "REQ-2026-0001",
        senderUserId: STAFF,
        audience: "customer",
      },
      {
        organizationId: ORG,
        conversationId: String(conversation._id),
        messageAudience: "customer",
        actorUserId: STAFF,
      },
    );

    const [row] = await rowsFor(OWNER);
    // The title says *that* there is a message and where. The words stay behind
    // the thread's own authorisation.
    expect(row!.title).toBe("New message on REQ-2026-0001");
    expect(JSON.stringify(row)).not.toContain("body");
  });
});

describe("read state", () => {
  it("counts, marks one, and marks all", async () => {
    await people();

    await service.dispatch(
      "RequestSubmitted",
      {
        requestId: "6a80c46f6c887b38e2f0e0c1",
        reference: "REQ-2026-0001",
        organizationId: ORG,
        kind: "custom_build",
      },
      { organizationId: ORG, ownerUserId: OWNER },
    );
    await service.dispatch(
      "QuoteIssued",
      {
        quoteId: "6a80c46f6c887b38e2f0e0d1",
        reference: "QUO-2026-0001",
        organizationId: ORG,
        requestId: "6a80c46f6c887b38e2f0e0c1",
        total: 100_000,
        currency: "GBP",
      },
      { organizationId: ORG },
    );

    expect(await service.unreadCount(OWNER)).toBe(2);

    const [first] = await communication.Notification.find({ recipientUserId: OWNER }).lean<
      Array<{ _id: unknown }>
    >();
    await service.markRead(OWNER, String(first!._id));
    expect(await service.unreadCount(OWNER)).toBe(1);

    await service.markAllRead(OWNER);
    expect(await service.unreadCount(OWNER)).toBe(0);
  });

  it("will not let one user mark another's notification read", async () => {
    await people();

    await service.dispatch(
      "RequestSubmitted",
      {
        requestId: "6a80c46f6c887b38e2f0e0c1",
        reference: "REQ-2026-0001",
        organizationId: ORG,
        kind: "custom_build",
      },
      { organizationId: ORG, ownerUserId: OWNER },
    );

    const [row] = await communication.Notification.find({ recipientUserId: OWNER }).lean<
      Array<{ _id: unknown }>
    >();

    await service.markRead(TECHNICAL, String(row!._id));

    // Untouched: the recipient is in the query, not checked afterwards.
    expect(await service.unreadCount(OWNER)).toBe(1);
  });
});

describe("the email itself — §69", () => {
  it("has a plain-text part carrying the link, and escapes the HTML one", async () => {
    await people();

    await service.dispatch(
      "CustomerActionRequested",
      {
        requestId: "6a80c46f6c887b38e2f0e0c1",
        reference: "REQ-2026-0001",
        organizationId: ORG,
        note: 'Send us the <script>alert("x")</script> spec',
      },
      { organizationId: ORG },
    );

    await deliverQueuedEmail();
    const message = sent[0]!;

    expect(message.text).toContain("REQ-2026-0001");
    // Absolute — an inbox has no base URL to resolve against.
    expect(message.text).toMatch(/https?:\/\/[^\s]+\/dashboard\/requests\/REQ-2026-0001/);
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
  });
});
