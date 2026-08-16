import { connectToDatabase } from "@/lib/db/client";
import { drainQueue } from "@/services/jobs/runner";
import { enqueueDueScheduled } from "@/services/jobs/schedule";
import { assertCronSecret } from "../secret";

/**
 * The serverless half of the job runner — ticket 25, §86.
 *
 * Enqueue whatever the schedule says is due, then drain. Identical to what the
 * in-process worker's tick does, because it calls the same two functions: the
 * hosting choice changes who calls them and nothing else.
 *
 * ## The budget is not a nicety
 *
 * `budgetMs` is set below any plausible platform request timeout. A drain that
 * is killed mid-job is *safe* — the lease expires and the job comes back — but
 * it consumes an attempt every time, so a queue permanently longer than one
 * invocation would dead-letter its tail rather than working through it. Stopping
 * cleanly and letting the next tick continue is the difference.
 *
 * Point a scheduler at this every minute. The `everyMinutes` in `SCHEDULE` does
 * the rest; a tick that finds nothing due costs one indexed query per job.
 */

export async function GET(request: Request): Promise<Response> {
  const refusal = assertCronSecret(request);
  if (refusal) return refusal;

  await connectToDatabase();

  const schedule = await enqueueDueScheduled();
  const drained = await drainQueue({ budgetMs: 25_000, maxJobs: 50 });

  return Response.json({ schedule, drained }, { status: 200 });
}

/**
 * Vercel Cron issues `GET`; most other schedulers are configured with `POST`.
 * Accepting both is one line and saves a deployment-shaped outage.
 */
export const POST = GET;
