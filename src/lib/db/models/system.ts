import { Schema, type Types } from "mongoose";
import { schemaOptions } from "../base";
import { defineModel } from "../client";

/**
 * Background work — §86.
 *
 * One collection, claimed by workers, backed by the database we already run.
 * The reasoning behind choosing Mongo over Redis or a platform queue is in
 * `src/services/jobs/DECISION.md`; this file is only the shape.
 *
 * The design is lifted almost wholesale from `WebhookEvent`, which has been a
 * single-purpose queue since ticket 13 and has the two properties that matter:
 * a **guarded** `findOneAndUpdate` for the claim, so two workers cannot take
 * the same row, and an `attempts` counter that survives a crash. What it lacks
 * — and what a general queue needs — is a lease with an expiry, a scheduled
 * `runAt`, and somewhere for a job to end up when it has failed for the last
 * time.
 */

/** Statuses a job moves through. `dead` is terminal and deliberate. */
export const JOB_STATUSES = ["pending", "processing", "succeeded", "failed", "dead"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobDoc {
  _id: Types.ObjectId;
  name: string;
  payload: unknown;
  /**
   * `failed` is transient and `dead` is terminal — the distinction
   * `WebhookEvent.markFailed` makes with a boolean, promoted to a state.
   *
   * A `failed` row is waiting for its next attempt and `runAt` says when. A
   * `dead` row has exhausted `maxAttempts` and will never run again unless a
   * human retries it from `/admin/jobs`. Keeping them apart is the difference
   * between "the queue is busy" and "somebody needs to look at this", which is
   * the only question the admin screen exists to answer.
   */
  status: JobStatus;
  /** Earliest time this may be claimed. Also the backoff mechanism. */
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  /** Set on claim; cleared on completion. With `lockedBy`, this is the lease. */
  lockedAt?: Date;
  lockedBy?: string;
  /**
   * Supplied by the caller when a duplicate enqueue must be a no-op. Enforced
   * by a unique index rather than a read-then-write, because the read-then-write
   * loses to two webhooks arriving in the same millisecond — the same reasoning
   * as `webhookEvents.record`.
   */
  idempotencyKey?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDoc>(
  {
    name: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, enum: JOB_STATUSES, default: "pending", required: true },
    runAt: { type: Date, required: true, default: () => new Date() },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: String,
    lockedAt: Date,
    lockedBy: String,
    idempotencyKey: String,
    completedAt: Date,
  },
  schemaOptions({ collection: "jobs" }),
);

/** The claim query: due work, oldest first. */
jobSchema.index({ status: 1, runAt: 1 });

/** The admin counts, and per-name depth. */
jobSchema.index({ name: 1, status: 1, runAt: 1 });

/**
 * Lease reclaim — `processing` rows whose worker died.
 *
 * Sparse because only in-flight rows carry `lockedAt`, and a partial index over
 * a status enum would need re-declaring every time the enum grows.
 */
jobSchema.index({ status: 1, lockedAt: 1 }, { sparse: true });

/**
 * The dedupe mechanism.
 *
 * `sparse`, so the overwhelming majority of jobs — which have no key — do not
 * all collide on `null`.
 */
jobSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

/**
 * Succeeded jobs are swept after a week; **dead ones never are.**
 *
 * A queue that grows without bound is a queue that eventually stops, but a
 * dead-letter row that expires is a failure nobody ever sees — which is the one
 * thing §86 asks this collection not to do. Hence the partial filter rather
 * than a plain TTL on `completedAt`.
 */
jobSchema.index(
  { completedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: { status: "succeeded" },
  },
);

export const Job = defineModel<JobDoc>("Job", jobSchema);
