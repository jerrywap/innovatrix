import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * The audit log — §90, ticket 26.
 *
 * The service had no test at all, which for the collection whose entire purpose
 * is being trustworthy later is the wrong one to have skipped. Four properties
 * matter and each is here:
 *
 *  1. It records what happened.
 *  2. It **cannot be amended or deleted** through any application path.
 *  3. It never stores a secret, however carelessly the caller passes one.
 *  4. Inside a transaction it throws; outside one it swallows. Those are
 *     opposite behaviours and both are deliberate.
 */

let mongoose: typeof import("mongoose").default;
let audit: typeof import("./index");
let repositories: typeof import("@/repositories/audit-log.repository");
let communication: typeof import("@/lib/db/models/communication");
let transaction: typeof import("@/lib/db/transaction");
let base: typeof import("@/repositories/base");

const STAFF = "6c00c46f6c887b38e2f0e0a1";
const ORG = "6c00c46f6c887b38e2f0e0b1";
const PRODUCT = "6c00c46f6c887b38e2f0e0c1";

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "audit_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  audit = await import("./index");
  repositories = await import("@/repositories/audit-log.repository");
  communication = await import("@/lib/db/models/communication");
  transaction = await import("@/lib/db/transaction");
  base = await import("@/repositories/base");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await communication.AuditLog.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  // Through the collection handle, because the model refuses every delete —
  // which is the property this file exists to assert.
  await communication.AuditLog.collection.deleteMany({});
});

const ACTOR = { type: "staff", userId: STAFF, name: "Sam" } as const;

describe("writing", () => {
  it("records the actor, the subject and the change", async () => {
    await audit.writeAuditLog({
      action: "product.status_changed",
      actor: ACTOR,
      subject: { type: "product", id: PRODUCT },
      organizationId: ORG,
      ...audit.statusChange("ready", "published"),
      ip: "203.0.113.4",
    });

    const rows = await communication.AuditLog.find({}).lean();
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.action).toBe("product.status_changed");
    expect(row.actorType).toBe("staff");
    expect(String(row.actorUserId)).toBe(STAFF);
    expect(row.subjectType).toBe("product");
    expect(String(row.subjectId)).toBe(PRODUCT);
    expect(row.before).toEqual({ status: "ready" });
    expect(row.after).toEqual({ status: "published" });
    expect(row.ip).toBe("203.0.113.4");
  });

  it("records a system actor with no user", async () => {
    await audit.writeAuditLog({ action: "payment.succeeded", actor: { type: "system" } });

    const row = await communication.AuditLog.findOne({}).lean();
    expect(row?.actorType).toBe("system");
    expect(row?.actorUserId).toBeUndefined();
  });
});

describe("secrets never reach it — §89", () => {
  it("redacts anything whose key looks like a credential", async () => {
    await audit.writeAuditLog({
      action: "product.demo_updated",
      actor: ACTOR,
      subject: { type: "product", id: PRODUCT },
      after: {
        username: "admin@atlas.demo",
        password: "demo-admin-2026",
        passwordCipher: "gAAAAA…",
        apiKey: "sk-or-v1-secret",
        nested: { accessToken: "abc123", label: "fine" },
      },
    });

    const row = await communication.AuditLog.findOne({}).lean<{
      after: Record<string, unknown>;
    }>();

    const after = row!.after;
    expect(after.password).toBe("[redacted]");
    expect(after.passwordCipher).toBe("[redacted]");
    expect(after.apiKey).toBe("[redacted]");
    expect((after.nested as Record<string, unknown>).accessToken).toBe("[redacted]");

    // Non-secret keys survive, or the redactor would make the log useless.
    expect(after.username).toBe("admin@atlas.demo");
    expect((after.nested as Record<string, unknown>).label).toBe("fine");
  });

  it("does not recurse for ever on a self-referencing object", async () => {
    // Depth-capped rather than cycle-detecting. Asserted because the cap is the
    // only thing between a hostile payload and a hung request.
    const cyclic: Record<string, unknown> = { label: "top" };
    cyclic.self = cyclic;

    expect(() => audit.redactAuditPayload(cyclic)).not.toThrow();
  });
});

describe("append-only — §90", () => {
  async function existing(): Promise<string> {
    await audit.writeAuditLog({
      action: "quote.issued",
      actor: ACTOR,
      subject: { type: "product", id: PRODUCT },
      after: { total: 100_000 },
    });

    const row = await communication.AuditLog.findOne({}).lean<{ _id: unknown }>();
    return String(row!._id);
  }

  it("refuses through the repository", async () => {
    await existing();

    /*
     * Cast, and the cast is the finding.
     *
     * `AuditLogRepository` overrides these as `updateById(): Promise<never>` —
     * *no parameters* — so `auditLogs.updateById(id, patch)` does not compile.
     * That is a stronger guarantee than a runtime throw and worth keeping, but
     * it means the runtime behaviour can only be asserted from outside the
     * types. Both halves matter: the compile error stops the honest mistake,
     * and the throw stops the one that reaches production through `any`.
     */
    const unsafe = repositories.auditLogs as unknown as {
      updateById(id: string, patch: unknown): Promise<never>;
      deleteById(id: string): Promise<never>;
    };

    await expect(unsafe.updateById("x", {})).rejects.toBeInstanceOf(base.RepositoryError);
    await expect(unsafe.deleteById("x")).rejects.toBeInstanceOf(base.RepositoryError);
  });

  it("refuses through the model, which is the path that used to be open", async () => {
    /*
     * The repository override was the whole guarantee before ticket 26, and
     * `AuditLog.updateOne(...)` never touches the repository. Several services
     * import models directly for good reasons; any of them could have amended
     * the record of what happened, and nothing would have complained.
     */
    const id = await existing();

    await expect(
      communication.AuditLog.updateOne({ _id: id }, { $set: { action: "nothing.happened" } }),
    ).rejects.toThrow(/append-only/);

    await expect(communication.AuditLog.deleteOne({ _id: id })).rejects.toThrow(/append-only/);
    await expect(communication.AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(
      communication.AuditLog.findOneAndUpdate({ _id: id }, { $set: { ip: "0.0.0.0" } }),
    ).rejects.toThrow(/append-only/);

    // And the row is untouched by all of that.
    const row = await communication.AuditLog.findById(id).lean();
    expect(row?.action).toBe("quote.issued");
    expect(row?.ip).toBeUndefined();
  });

  it("refuses to save an amendment to a loaded document", async () => {
    await existing();

    const doc = await communication.AuditLog.findOne({});
    doc!.action = "something.else";

    await expect(doc!.save()).rejects.toThrow(/append-only/);
  });

  it("still allows an append", async () => {
    // The guard must not have made the collection write-only-never.
    await existing();
    await audit.writeAuditLog({ action: "quote.accepted", actor: ACTOR });

    expect(await communication.AuditLog.countDocuments({})).toBe(2);
  });
});

describe("sessions", () => {
  it("throws inside a transaction, so a change cannot commit unaudited", async () => {
    const boom = new Error("the domain write failed");

    await expect(
      transaction.withTransaction(async (session) => {
        await audit.writeAuditLog(
          { action: "payment.recorded_manually", actor: ACTOR },
          session,
        );
        throw boom;
      }),
    ).rejects.toThrow(boom);

    // Rolled back with everything else — an audit row for a payment that was
    // never recorded would be worse than none.
    expect(await communication.AuditLog.countDocuments({})).toBe(0);
  });

  it("swallows outside a transaction, so a read-audit cannot fail the read", async () => {
    /*
     * `demo_credentials_revealed` is the case this protects: the customer has
     * already been shown the credential by the time we try to record it, and
     * throwing would turn a logging failure into a broken screen.
     *
     * Forced by disconnecting rather than by mocking, so what is asserted is
     * the real failure path.
     */
    const client = await import("@/lib/db/client");

    // `disconnectFromDatabase`, not `mongoose.disconnect()`. The latter closes
    // the socket but leaves `connectToDatabase`'s memoised handle in place, so
    // the reconnect below is a no-op and every later test in the file fails on
    // a disconnected client — which is how this was first written.
    await client.disconnectFromDatabase();

    await expect(
      audit.writeAuditLog({ action: "product.demo_updated", actor: ACTOR }),
    ).resolves.toBeUndefined();

    await client.connectToDatabase();
  });
});
