import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §86 — the background queue.
 *
 * One test per acceptance criterion, including the two that are easy to write
 * around: two workers must never process the same job, and a worker killed
 * mid-job must return it to the queue rather than leave it in limbo. Both are
 * concurrency properties, and a queue that has not been tested for them is a
 * queue that works until it is under load.
 */

let mongoose: typeof import("mongoose").default;
let queue: typeof import("./queue");
let registry: typeof import("./registry");
let runner: typeof import("./runner");
let schedule: typeof import("./schedule");
let types: typeof import("./types");
let system: typeof import("@/lib/db/models/system");
let transaction: typeof import("@/lib/db/transaction");

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "jobs_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  // The worker must never start inside the suite — a background loop claiming
  // rows would race every assertion here and fail intermittently.
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  queue = await import("./queue");
  registry = await import("./registry");
  runner = await import("./runner");
  schedule = await import("./schedule");
  types = await import("./types");
  system = await import("@/lib/db/models/system");
  transaction = await import("@/lib/db/transaction");

  /*
   * Register the real handlers once, here, so `drainQueue`'s own idempotent
   * `registerJobs()` is already satisfied and becomes a no-op.
   *
   * Without this the *first* drain in the file registers the production
   * handlers on top of whatever the test had just defined — and the symptom is
   * a dev-email banner in the output and an assertion that the handler was
   * never called. `afterEach` then clears the map, so every test from the
   * second onwards behaved correctly and only the first one lied.
   */
  (await import("./handlers")).registerJobs();

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await system.Job.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await system.Job.deleteMany({});
  registry.resetJobRegistry();
});

/**
 * The registry is typed against the real `JobName` union, so a test job needs a
 * real name. `send-email` is used throughout with its handler replaced — the
 * name is incidental to what is being tested, which is the machinery.
 */
const NAME = "send-email" as const;
const PAYLOAD = { to: "a@b.test", subject: "s", text: "t" };

/**
 * Backoff is realistic rather than tiny.
 *
 * A 10ms backoff is unmeasurable — by the time the row has been read back the
 * retry is already overdue and `runAt - now` is negative, which reads as "no
 * backoff was applied". The tests never actually wait, because each pass forces
 * `runAt` to now before draining again.
 */
const BACKOFF_MS = 5_000;

function define(handler: () => Promise<void>, options?: { maxAttempts?: number }) {
  registry.defineJob(NAME, handler, {
    backoffMs: BACKOFF_MS,
    backoffCapMs: 60_000,
    ...options,
  });
}

describe("enqueue", () => {
  it("stores a pending job that is immediately due", async () => {
    const { jobId, created } = await queue.enqueue(NAME, PAYLOAD);

    expect(created).toBe(true);

    const row = await system.Job.findById(jobId).lean<{ status: string; runAt: Date }>();
    expect(row?.status).toBe("pending");
    expect(row!.runAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("runs once when the same idempotency key is enqueued twice", async () => {
    const first = await queue.enqueue(NAME, PAYLOAD, { idempotencyKey: "same" });
    const second = await queue.enqueue(NAME, PAYLOAD, { idempotencyKey: "same" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.jobId).toBe(first.jobId);
    expect(await system.Job.countDocuments({})).toBe(1);
  });

  it("never executes a job enqueued inside a transaction that rolls back", async () => {
    const boom = new Error("the domain write failed");

    await expect(
      transaction.withTransaction(async (session) => {
        await queue.enqueue(NAME, PAYLOAD, { session });
        // Everything the caller asked for must vanish together. If the job
        // survived this, a cancelled order would still send its confirmation.
        throw boom;
      }),
    ).rejects.toThrow(boom);

    expect(await system.Job.countDocuments({})).toBe(0);
  });

  it("keeps a job enqueued inside a transaction that commits", async () => {
    await transaction.withTransaction(async (session) => {
      await queue.enqueue(NAME, PAYLOAD, { session });
    });

    expect(await system.Job.countDocuments({})).toBe(1);
  });

  it("does not claim a job whose runAt is in the future", async () => {
    await queue.enqueue(NAME, PAYLOAD, { runAt: new Date(Date.now() + 60_000) });

    expect(await queue.claimNext("worker-1")).toBeNull();
  });
});

describe("claiming", () => {
  it("gives a job to exactly one of two concurrent workers", async () => {
    await queue.enqueue(NAME, PAYLOAD);

    // Both calls are in flight before either resolves — the atomic
    // findOneAndUpdate is the only thing standing between this and a double
    // fulfilment in production.
    const [a, b] = await Promise.all([
      queue.claimNext("worker-a"),
      queue.claimNext("worker-b"),
    ]);

    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.attempts).toBe(1);
  });

  it("returns an abandoned job to the queue after the visibility timeout", async () => {
    const { jobId } = await queue.enqueue(NAME, PAYLOAD);
    await queue.claimNext("worker-that-dies");

    // Nothing reclaims it while the lease is good.
    expect(await queue.reclaimExpiredLeases(60_000)).toBe(0);

    // Simulate the lease ageing rather than waiting for it. The clock is the
    // thing under test, so moving the row is honest and waiting is not.
    await system.Job.updateOne(
      { _id: jobId },
      { $set: { lockedAt: new Date(Date.now() - 120_000) } },
    );

    expect(await queue.reclaimExpiredLeases(60_000)).toBe(1);

    const row = await system.Job.findById(jobId).lean<{
      status: string;
      attempts: number;
      lockedBy?: string;
    }>();

    expect(row?.status).toBe("pending");
    expect(row?.lockedBy).toBeUndefined();
    // The attempt it consumed stays consumed, so a job that kills its worker
    // every time still dead-letters instead of looping for ever.
    expect(row?.attempts).toBe(1);
  });
});

describe("failure handling", () => {
  it("retries with growing backoff, then dead-letters with the error kept", async () => {
    let calls = 0;
    define(
      async () => {
        calls += 1;
        throw new Error(`attempt ${calls} exploded`);
      },
      { maxAttempts: 3 },
    );

    const { jobId } = await queue.enqueue(NAME, PAYLOAD, { maxAttempts: 3 });

    const delays: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      // Each pass makes the job due again, so the drain can claim it without
      // the test sleeping through a real backoff.
      await system.Job.updateOne({ _id: jobId }, { $set: { runAt: new Date() } });
      await runner.drainQueue({ maxJobs: 1 });

      const row = await system.Job.findById(jobId).lean<{ status: string; runAt: Date }>();
      if (row?.status === "failed") delays.push(row.runAt.getTime() - Date.now());
    }

    expect(calls).toBe(3);

    const final = await system.Job.findById(jobId).lean<{
      status: string;
      attempts: number;
      lastError?: string;
    }>();

    expect(final?.status).toBe("dead");
    expect(final?.attempts).toBe(3);
    expect(final?.lastError).toBe("attempt 3 exploded");

    /*
     * Two retries were scheduled before the third attempt, each into the
     * future, and the second band is above the first.
     *
     * Asserted as bands rather than as `delays[1] > delays[0]`, because jitter
     * is a 0.5–1.0 multiplier and the bands touch: a first retry that jitters
     * to its maximum and a second that jitters to its minimum are equal. A
     * strict inequality here would fail roughly one run in a thousand, which is
     * the worst kind of test. The exact growth is asserted on `backoffFor`
     * below, where there is no clock to fight.
     */
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[0]).toBeLessThanOrEqual(BACKOFF_MS);
    expect(delays[1]).toBeGreaterThan(0);
    expect(delays[1]).toBeLessThanOrEqual(2 * BACKOFF_MS);
  });

  it("grows the backoff exponentially and caps it", () => {
    // Pure, so the jitter band can be asserted exactly.
    for (const attempts of [1, 2, 3, 4]) {
      const delay = queue.backoffFor(attempts, 1_000, 60_000);
      const exponential = 1_000 * 2 ** (attempts - 1);
      expect(delay).toBeGreaterThanOrEqual(exponential * 0.5);
      expect(delay).toBeLessThanOrEqual(exponential);
    }

    // The cap holds however many attempts have gone by, so a job that has
    // failed twenty times retries hourly rather than in a fortnight.
    expect(queue.backoffFor(20, 1_000, 60_000)).toBeLessThanOrEqual(60_000);
  });

  it("dead-letters immediately on a PermanentJobError without burning attempts", async () => {
    define(async () => {
      throw new types.PermanentJobError("this payload will never be valid");
    });

    const { jobId } = await queue.enqueue(NAME, PAYLOAD, { maxAttempts: 5 });
    const result = await runner.drainQueue({ maxJobs: 1 });

    expect(result.dead).toBe(1);

    const row = await system.Job.findById(jobId).lean<{ status: string; attempts: number }>();
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(1);
  });

  it("dead-letters a job with no registered handler rather than retrying it", async () => {
    // Nothing defined — `afterEach` reset the registry.
    const { jobId } = await queue.enqueue(NAME, PAYLOAD);
    const result = await runner.drainQueue({ maxJobs: 1 });

    expect(result.dead).toBe(1);

    const row = await system.Job.findById(jobId).lean<{ status: string; lastError?: string }>();
    expect(row?.status).toBe("dead");
    expect(row?.lastError).toContain("No handler registered");
  });

  it("keeps draining after one job fails", async () => {
    let seen = 0;
    define(async () => {
      seen += 1;
      if (seen === 1) throw new Error("the poison one");
    });

    await queue.enqueue(NAME, PAYLOAD, { idempotencyKey: "one", maxAttempts: 1 });
    await queue.enqueue(NAME, PAYLOAD, { idempotencyKey: "two" });

    const result = await runner.drainQueue({ maxJobs: 5 });

    expect(result.claimed).toBe(2);
    expect(result.dead).toBe(1);
    expect(result.succeeded).toBe(1);
  });
});

describe("draining", () => {
  it("marks a successful job succeeded and clears its lease", async () => {
    define(async () => {});

    const { jobId } = await queue.enqueue(NAME, PAYLOAD);
    const result = await runner.drainQueue({ maxJobs: 5 });

    expect(result.succeeded).toBe(1);

    const row = await system.Job.findById(jobId).lean<{
      status: string;
      lockedBy?: string;
      completedAt?: Date;
    }>();

    expect(row?.status).toBe("succeeded");
    expect(row?.lockedBy).toBeUndefined();
    expect(row?.completedAt).toBeInstanceOf(Date);
  });

  it("stops at maxJobs and says so", async () => {
    define(async () => {});

    for (let i = 0; i < 4; i += 1) {
      await queue.enqueue(NAME, PAYLOAD, { idempotencyKey: `bulk-${i}` });
    }

    const result = await runner.drainQueue({ maxJobs: 2 });

    expect(result.claimed).toBe(2);
    expect(result.stoppedEarly).toBe(true);
    expect(await system.Job.countDocuments({ status: "pending" })).toBe(2);
  });
});

describe("the schedule", () => {
  it("enqueues each due job once per window, however many times it ticks", async () => {
    const at = new Date("2026-08-16T10:00:00.000Z");

    const first = await schedule.enqueueDueScheduled(at);
    const second = await schedule.enqueueDueScheduled(at);

    expect(first.enqueued).toEqual(schedule.SCHEDULE.map((job) => job.name));
    expect(second.enqueued).toEqual([]);
    expect(second.skipped).toHaveLength(schedule.SCHEDULE.length);
    expect(await system.Job.countDocuments({})).toBe(schedule.SCHEDULE.length);
  });

  it("enqueues again once the window rolls over", async () => {
    const at = new Date("2026-08-16T10:00:00.000Z");
    // Sixteen minutes later: past the 15-minute window, inside the daily one.
    const later = new Date(at.getTime() + 16 * 60_000);

    await schedule.enqueueDueScheduled(at);
    const next = await schedule.enqueueDueScheduled(later);

    const quarterHourly = schedule.SCHEDULE.filter((job) => job.everyMinutes === 15);
    expect(next.enqueued.sort()).toEqual(quarterHourly.map((job) => job.name).sort());
  });
});
