import "server-only";
import type { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Job, type JobStatus } from "@/lib/db/models/system";
import { SCHEDULE } from "@/services/jobs/schedule";
import { registeredJobs } from "@/services/jobs/registry";
import { registerJobs } from "@/services/jobs/handlers";

/**
 * What `/admin/jobs` reads — §86's "observable", §95's queue monitoring.
 *
 * ## The screen answers one question
 *
 * "Is anything wrong, and what?" Everything here serves that: the dead-letter
 * count first because it is the only number that needs a person, then the
 * oldest pending age because a queue that is deep but moving is fine and a
 * queue that is shallow and stuck is not. Total throughput is not here —
 * interesting, but not a question anybody opens this page to ask.
 */

export interface JobRow {
  id: string;
  name: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  createdAt: string;
  lastError?: string;
  lockedBy?: string;
}

export interface JobNameSummary {
  name: string;
  pending: number;
  processing: number;
  failed: number;
  dead: number;
  succeeded: number;
  /** From `SCHEDULE`, so a job that should be recurring and isn't shows it. */
  everyMinutes?: number;
  registered: boolean;
}

export interface JobsOverview {
  totals: Record<JobStatus, number>;
  byName: JobNameSummary[];
  /** Minutes since the oldest claimable job became due. Null when idle. */
  oldestPendingMinutes: number | null;
  dead: JobRow[];
  inFlight: JobRow[];
  recent: JobRow[];
}

const EMPTY_TOTALS: Record<JobStatus, number> = {
  pending: 0,
  processing: 0,
  succeeded: 0,
  failed: 0,
  dead: 0,
};

export async function loadJobsOverview(): Promise<JobsOverview> {
  await connectToDatabase();
  // So `registeredJobs()` is populated on a request that has not yet touched
  // the worker — the admin screen must not report "no handler" for a job that
  // simply has not been looked up on this instance.
  registerJobs();

  const [counts, oldest, dead, inFlight, recent] = await Promise.all([
    Job.aggregate<{ _id: { name: string; status: JobStatus }; count: number }>([
      { $group: { _id: { name: "$name", status: "$status" }, count: { $sum: 1 } } },
    ]),
    Job.findOne({ status: { $in: ["pending", "failed"] } })
      .sort({ runAt: 1 })
      .select({ runAt: 1 })
      .lean<{ runAt: Date }>(),
    rows({ status: "dead" }, { updatedAt: -1 }, 50),
    rows({ status: "processing" }, { lockedAt: 1 }, 25),
    rows({}, { createdAt: -1 }, 25),
  ]);

  const totals = { ...EMPTY_TOTALS };
  const perName = new Map<string, Record<JobStatus, number>>();

  for (const entry of counts) {
    totals[entry._id.status] += entry.count;
    const bucket = perName.get(entry._id.name) ?? { ...EMPTY_TOTALS };
    bucket[entry._id.status] += entry.count;
    perName.set(entry._id.name, bucket);
  }

  const scheduled = new Map(SCHEDULE.map((job) => [job.name as string, job.everyMinutes]));
  const known = new Set(registeredJobs().map((job) => job.name as string));

  // Union of what exists in the collection and what the code declares, so a
  // scheduled job that has never run once still appears — its absence from the
  // list is the interesting part.
  const names = [...new Set([...perName.keys(), ...scheduled.keys(), ...known])].sort();

  const byName: JobNameSummary[] = names.map((name) => {
    const bucket = perName.get(name) ?? EMPTY_TOTALS;
    return {
      name,
      pending: bucket.pending,
      processing: bucket.processing,
      failed: bucket.failed,
      dead: bucket.dead,
      succeeded: bucket.succeeded,
      ...(scheduled.has(name) ? { everyMinutes: scheduled.get(name)! } : {}),
      registered: known.has(name),
    };
  });

  return {
    totals,
    byName,
    oldestPendingMinutes: oldest
      ? Math.max(0, Math.floor((Date.now() - new Date(oldest.runAt).getTime()) / 60_000))
      : null,
    dead,
    inFlight,
    recent,
  };
}

export async function loadJob(id: string): Promise<(JobRow & { payload: unknown }) | null> {
  await connectToDatabase();

  let objectId;
  try {
    objectId = toObjectId(id);
  } catch {
    // A malformed id is a 404, not a 500. The same reasoning as the download
    // route: an id-shape error message is a small oracle and no use to anyone.
    return null;
  }

  const doc = await Job.findById(objectId).lean<{
    _id: Types.ObjectId;
    name: string;
    status: JobStatus;
    attempts: number;
    maxAttempts: number;
    runAt: Date;
    createdAt: Date;
    lastError?: string;
    lockedBy?: string;
    payload: unknown;
  }>();

  if (!doc) return null;

  return { ...toRow(doc), payload: doc.payload };
}

async function rows(
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit: number,
): Promise<JobRow[]> {
  const docs = await Job.find(filter)
    .sort(sort)
    // Bounded by construction (§94). A dead-letter list of five thousand is a
    // scroll bar, not information — the count above it is the information.
    .limit(limit)
    .lean<
      {
        _id: Types.ObjectId;
        name: string;
        status: JobStatus;
        attempts: number;
        maxAttempts: number;
        runAt: Date;
        createdAt: Date;
        lastError?: string;
        lockedBy?: string;
      }[]
    >();

  return docs.map(toRow);
}

function toRow(doc: {
  _id: Types.ObjectId;
  name: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
  lastError?: string;
  lockedBy?: string;
}): JobRow {
  return {
    id: String(doc._id),
    name: doc.name,
    status: doc.status,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    // Absolute, not relative — a server-rendered "3 minutes ago" is wrong by
    // the time it is read and differs from the client's clock.
    runAt: new Date(doc.runAt).toISOString().replace("T", " ").slice(0, 19),
    createdAt: new Date(doc.createdAt).toISOString().replace("T", " ").slice(0, 19),
    ...(doc.lastError ? { lastError: doc.lastError } : {}),
    ...(doc.lockedBy ? { lockedBy: doc.lockedBy } : {}),
  };
}
