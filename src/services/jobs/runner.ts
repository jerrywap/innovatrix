import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { JobDoc } from "@/lib/db/models/system";
import { claimNext, complete, fail, reclaimExpiredLeases } from "./queue";
import { definitionFor } from "./registry";
import { registerJobs } from "./handlers";
import { isPermanent, type JobName } from "./types";
import { log } from "@/lib/logger";
import { alert, ALERTS } from "@/lib/alerts";

/**
 * `drainQueue` — the one entry point, and the reason the hosting decision is
 * reversible.
 *
 * A long-lived container calls this in a loop (`worker.ts`); a serverless
 * deployment calls it from `/api/cron/tick`. Both get identical semantics
 * because it is literally the same function, so moving between them is a
 * deployment change rather than a rewrite. Business decision #10 can stay open.
 *
 * Bounded two ways on purpose: `maxJobs` so one call cannot monopolise a
 * worker, and `budgetMs` so a serverless invocation returns before its request
 * timeout rather than being killed mid-job. A killed drain is safe — the lease
 * expires and the job comes back — but "safe" is not "free", and a job that
 * always outlives the budget would otherwise retry until it dead-lettered.
 */

export interface DrainOptions {
  maxJobs?: number;
  budgetMs?: number;
  workerId?: string;
  /** Restrict to specific job names. Used by tests, not in production. */
  names?: JobName[];
  visibilityTimeoutMs?: number;
}

export interface DrainResult {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  reclaimed: number;
  /** True when the loop stopped on a limit rather than an empty queue. */
  stoppedEarly: boolean;
}

export function newWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

export async function drainQueue(options: DrainOptions = {}): Promise<DrainResult> {
  const maxJobs = options.maxJobs ?? 25;
  const budgetMs = options.budgetMs ?? 25_000;
  const workerId = options.workerId ?? newWorkerId();
  const startedAt = Date.now();

  // Idempotent, and called here rather than only at boot so a cron invocation
  // on a cold serverless instance has the handlers it is about to look up.
  registerJobs();

  const result: DrainResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    reclaimed: await reclaimExpiredLeases(options.visibilityTimeoutMs),
    stoppedEarly: false,
  };

  while (result.claimed < maxJobs) {
    if (Date.now() - startedAt >= budgetMs) {
      result.stoppedEarly = true;
      break;
    }

    const job = await claimNext(workerId, options.names);
    if (!job) break;

    result.claimed += 1;
    const outcome = await runOne(job);
    result[outcome] += 1;
  }

  if (result.claimed >= maxJobs) result.stoppedEarly = true;

  return result;
}

/**
 * Run one claimed job to a terminal state.
 *
 * Never throws. A drain that aborted on the first bad job would leave every
 * job behind it stuck behind a poison message, which is precisely what the
 * dead-letter state exists to prevent.
 */
async function runOne(job: JobDoc): Promise<"succeeded" | "failed" | "dead"> {
  const definition = definitionFor(job.name);

  if (!definition) {
    /*
     * A job whose handler is not registered.
     *
     * Permanent, not retryable: retrying cannot make a handler appear, and the
     * realistic cause is a job enqueued by a newer deploy being picked up by an
     * older worker mid-rollout. Dead-lettering surfaces that on the admin
     * screen in one place instead of five failed attempts spread over an hour,
     * and the row can be retried by hand once the rollout finishes.
     */
    await fail(job, new Error(`No handler registered for job "${job.name}".`), {
      permanent: true,
    });
    return "dead";
  }

  try {
    await definition.handler(job.payload as never);
    await complete(String(job._id));
    return "succeeded";
  } catch (error) {
    const outcome = await fail(job, error, {
      permanent: isPermanent(error),
      backoffMs: definition.backoffMs,
      backoffCapMs: definition.backoffCapMs,
    });

    const fields = {
      job: job.name,
      jobId: String(job._id),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      ...(outcome.runAt ? { retryAt: outcome.runAt.toISOString() } : {}),
    };

    if (outcome.status === "dead") {
      // §86: nothing silently disappears. A retry that is still coming is a
      // log line; a job that will never run again needs a person, and this is
      // the only moment anybody would find out without opening /admin/jobs.
      alert(ALERTS.jobDeadLettered, `Job ${job.name} exhausted its attempts`, {
        ...fields,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      log.exception(`Job ${job.name} failed, retrying`, error, {
        code: "job.retrying",
        ...fields,
      });
    }

    return outcome.status;
  }
}
