import { connectToDatabase } from "@/lib/db/client";
import { reconcile } from "@/services/jobs/handlers/payments";
import { assertCronSecret } from "../secret";

/**
 * The safety net — §87. Now a thin caller over ticket 25's job.
 *
 * ## Why this route still exists
 *
 * The sweep it used to contain moved into `reconcile-pending-payments`, which
 * `/api/cron/tick` schedules every fifteen minutes. This route is therefore
 * redundant on any deployment running the tick — and it stays anyway, because
 * something may already be pointed at it. Deleting a URL a scheduler is calling
 * does not produce an error anyone reads; it produces payments that quietly
 * stop being reconciled, which is the exact failure the route was built to
 * prevent.
 *
 * ## It runs inline rather than enqueuing
 *
 * Enqueuing would be tidier and would be wrong here: a caller hitting this URL
 * is asking for reconciliation *now*, and on a deployment with `JOBS_WORKER=off`
 * and no tick configured, an enqueue would sit in the collection for ever. So it
 * does the work and reports what it found — the same function the job runs.
 */

export async function GET(request: Request): Promise<Response> {
  const refusal = assertCronSecret(request);
  if (refusal) return refusal;

  await connectToDatabase();

  const summary = await reconcile();
  return Response.json(summary, { status: 200 });
}
