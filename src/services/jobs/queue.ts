import "server-only";
import type { ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { Job, type JobDoc, type JobStatus } from "@/lib/db/models/system";
import { toObjectId } from "@/lib/db/base";
import { definitionFor } from "./registry";
import type { JobName, JobPayloadMap } from "./types";

/**
 * The queue itself — enqueue, claim, complete, fail, reclaim.
 *
 * Deliberately not a `BaseRepository` subclass. `BaseRepository` gives soft
 * deletes, org scoping and a paginated `list()`, none of which a queue wants:
 * jobs are not org-scoped (a sweep belongs to nobody), a soft-deleted job is a
 * job that quietly never runs, and the claim needs a raw guarded
 * `findOneAndUpdate` rather than anything that reads first.
 */

/** How long a claim is good for before another worker may steal it. */
export const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60_000;

export interface EnqueueOptions {
  /** Delay the job. Defaults to now. */
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Makes a repeat enqueue a no-op, enforced by a unique index.
   *
   * Required for anything enqueued from a handler that can run twice — every
   * `withTransaction` callback, every event handler that a webhook retry can
   * re-drive.
   */
  idempotencyKey?: string;
  /**
   * Joins the caller's transaction, so the job exists only if the write does.
   *
   * This is the whole reason the queue lives in Mongo. A rolled-back order must
   * not leave a phantom "your order is confirmed" email behind, and with any
   * other backend the enqueue would already have happened by the time the
   * transaction aborted.
   */
  session?: ClientSession;
}

export interface EnqueueResult {
  jobId: string;
  /** False when an idempotency key matched an existing row. */
  created: boolean;
}

export async function enqueue<K extends JobName>(
  name: K,
  payload: JobPayloadMap[K],
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  await connectToDatabase();

  const doc = {
    name,
    payload,
    status: "pending" as const,
    runAt: options.runAt ?? new Date(),
    attempts: 0,
    // Frozen onto the row at enqueue rather than read from the registry at run
    // time, so a job in flight keeps the contract it was created under even if
    // a deploy changes `defineJob`'s options underneath it.
    maxAttempts: options.maxAttempts ?? definitionFor(name)?.maxAttempts ?? 5,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  };

  try {
    const [created] = await Job.create([doc], { session: options.session });
    return { jobId: String(created!._id), created: true };
  } catch (error) {
    /*
     * The index refused it, which is the answer rather than a problem.
     *
     * Note this is *not* wrapped in a prior read: two callers racing on the
     * same key would both read nothing and both insert. Letting the write fail
     * and interpreting the failure is the only version that is correct under
     * concurrency — the same shape as `webhookEvents.record`.
     *
     * Inside a transaction the duplicate aborts it, and rightly so: the caller
     * asked for the domain write and the job together, and the job is already
     * there. Reading it back on a doomed session would return nothing useful,
     * so we rethrow and let the caller's retry see the committed state.
     */
    if (isDuplicateKey(error) && options.idempotencyKey && !options.session) {
      const existing = await Job.findOne({ idempotencyKey: options.idempotencyKey })
        .select({ _id: 1 })
        .lean<{ _id: unknown }>();
      if (existing) return { jobId: String(existing._id), created: false };
    }
    throw error;
  }
}

/**
 * Statuses a job may be claimed from.
 *
 * `failed` is in here and `dead` is not — that is the entire difference between
 * them. A failed job is waiting for its backoff to elapse; a dead one is
 * waiting for a person.
 */
export const CLAIMABLE = ["pending", "failed"] as const satisfies readonly JobStatus[];

/**
 * Take exclusive ownership of the next due job.
 *
 * Everything that makes this safe is in the filter. The status and
 * `runAt: { $lte: now }` are matched **and** updated in one atomic operation,
 * so of two workers calling this in the same instant exactly one gets the
 * document and the other gets the next one — or null.
 *
 * `sort` makes it a queue rather than a bag: oldest due work first.
 */
export async function claimNext(workerId: string, names?: JobName[]): Promise<JobDoc | null> {
  await connectToDatabase();
  const now = new Date();

  return Job.findOneAndUpdate(
    {
      status: { $in: CLAIMABLE },
      runAt: { $lte: now },
      ...(names?.length ? { name: { $in: names } } : {}),
    },
    {
      $set: { status: "processing", lockedAt: now, lockedBy: workerId },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { runAt: 1 } },
  ).lean<JobDoc>();
}

export async function complete(jobId: string): Promise<void> {
  await Job.updateOne(
    { _id: toObjectId(jobId) },
    {
      $set: { status: "succeeded", completedAt: new Date() },
      $unset: { lockedAt: "", lockedBy: "", lastError: "" },
    },
  );
}

export interface FailOptions {
  /** Terminal — dead-letter immediately rather than burning the attempts. */
  permanent?: boolean;
  backoffMs?: number;
  backoffCapMs?: number;
}

/**
 * Record a failure, and decide whether there is a next time.
 *
 * `attempts` was already incremented by the claim, so a job on its last attempt
 * arrives here with `attempts === maxAttempts` and goes to `dead`. That is
 * deliberate: counting on the claim rather than on the failure means a worker
 * killed mid-job still consumes an attempt, so a job that reliably crashes the
 * process cannot loop for ever.
 */
export async function fail(
  job: Pick<JobDoc, "_id" | "attempts" | "maxAttempts">,
  error: unknown,
  options: FailOptions = {},
): Promise<{ status: "failed" | "dead"; runAt?: Date }> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = options.permanent || job.attempts >= job.maxAttempts;

  if (exhausted) {
    await Job.updateOne(
      { _id: job._id },
      {
        $set: { status: "dead", lastError: message, completedAt: new Date() },
        $unset: { lockedAt: "", lockedBy: "" },
      },
    );
    return { status: "dead" };
  }

  const runAt = new Date(
    Date.now() +
      backoffFor(job.attempts, options.backoffMs ?? 10_000, options.backoffCapMs ?? 3_600_000),
  );

  await Job.updateOne(
    { _id: job._id },
    {
      // `failed` rather than back to `pending`: both are in `CLAIMABLE`, so it
      // still retries, but only one of them tells the admin screen that this
      // job has already gone wrong once.
      $set: { status: "failed", lastError: message, runAt },
      $unset: { lockedAt: "", lockedBy: "" },
    },
  );

  return { status: "failed", runAt };
}

/**
 * Exponential, capped, with jitter.
 *
 * The jitter is not decoration. Without it, ten jobs that failed together
 * because a provider was down all retry in the same millisecond, and hit it
 * again together — a thundering herd that turns one outage into several.
 */
export function backoffFor(attempts: number, baseMs: number, capMs: number): number {
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attempts - 1), capMs);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Return jobs whose worker died back to the queue.
 *
 * The lease is what distinguishes "in flight" from "abandoned", and without
 * this a `SIGKILL` mid-job leaves the row `processing` for ever — visible on
 * the admin screen as permanently in flight, and never retried. §86's
 * "retryable" has to survive the worker, not just the handler.
 */
export async function reclaimExpiredLeases(
  visibilityTimeoutMs = DEFAULT_VISIBILITY_TIMEOUT_MS,
): Promise<number> {
  await connectToDatabase();
  const cutoff = new Date(Date.now() - visibilityTimeoutMs);

  const result = await Job.updateMany(
    { status: "processing", lockedAt: { $lte: cutoff } },
    {
      // Straight back to pending at the current time. The attempt it consumed
      // stays consumed, so a job that kills its worker every time still
      // dead-letters rather than looping.
      $set: { status: "pending", runAt: new Date() },
      $unset: { lockedAt: "", lockedBy: "" },
    },
  );

  return result.modifiedCount;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
