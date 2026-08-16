"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { objectIdSchema } from "@/validators/common";
import { requirePermission } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Job } from "@/lib/db/models/system";
import { staffActor, writeAuditLog } from "@/services/audit";
import { drainQueue } from "@/services/jobs/runner";
import { enqueueDueScheduled } from "@/services/jobs/schedule";

/**
 * The three buttons on `/admin/jobs` — §86's "manual retry and cancel".
 *
 * Each one guards with `system.manage_jobs` in its own body. The page guards
 * too, and neither is redundant: a server action is a public POST endpoint, and
 * the page guard only decides what gets drawn.
 */

const jobIdSchema = z.object({ jobId: objectIdSchema }).strict();

/**
 * Put a dead job back in the queue.
 *
 * Resets `attempts` to zero. The alternative — leaving the count and letting it
 * fail once more — makes the button a no-op on every job that reached its limit,
 * which is every job on this screen. Somebody pressing retry has decided the
 * cause is fixed, and the audit row records that they decided it.
 */
export async function retryJobAction(
  _prev: ActionResult<{ jobId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string }>> {
  return withAction(async () => {
    const session = await requirePermission("system.manage_jobs");
    const input = parseInput(jobIdSchema, { jobId: formData.get("jobId") });

    await connectToDatabase();

    const result = await Job.findOneAndUpdate(
      // Guarded on `dead`, so pressing retry on a row somebody already retried
      // — or one a worker is holding — does nothing rather than resetting a job
      // mid-flight.
      { _id: toObjectId(input.jobId), status: "dead" },
      {
        $set: { status: "pending", attempts: 0, runAt: new Date() },
        $unset: { lockedAt: "", lockedBy: "", completedAt: "" },
      },
      { returnDocument: "after" },
    ).lean<{ name: string }>();

    if (!result) {
      return fail("That job is no longer dead-lettered — reload the page.", {
        code: "CONFLICT",
      });
    }

    await writeAuditLog({
      action: "job.retried",
      actor: staffActor(session.user),
      subject: { type: "job", id: input.jobId },
      after: { name: result.name },
    });

    revalidatePath("/admin/jobs");
    return ok({ jobId: input.jobId });
  });
}

/**
 * Stop a job ever running.
 *
 * Moves it to `dead` rather than deleting it. A cancelled job is a decision
 * somebody made, and §90 wants the trail; a deleted row leaves the audit entry
 * pointing at nothing.
 */
export async function cancelJobAction(
  _prev: ActionResult<{ jobId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string }>> {
  return withAction(async () => {
    const session = await requirePermission("system.manage_jobs");
    const input = parseInput(jobIdSchema, { jobId: formData.get("jobId") });

    await connectToDatabase();

    const result = await Job.findOneAndUpdate(
      { _id: toObjectId(input.jobId), status: { $in: ["pending", "failed"] } },
      {
        $set: {
          status: "dead",
          lastError: "Cancelled by an administrator.",
          completedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    ).lean<{ name: string }>();

    if (!result) {
      return fail("That job has already started or finished.", { code: "CONFLICT" });
    }

    await writeAuditLog({
      action: "job.cancelled",
      actor: staffActor(session.user),
      subject: { type: "job", id: input.jobId },
      after: { name: result.name },
    });

    revalidatePath("/admin/jobs");
    return ok({ jobId: input.jobId });
  });
}

/**
 * Run a tick by hand.
 *
 * Exists because the alternative when something looks stuck is waiting for a
 * poll interval and guessing. Bounded hard: this runs inside a server action,
 * which has a request timeout like anything else.
 */
export async function runQueueNowAction(): Promise<
  ActionResult<{ claimed: number; dead: number }>
> {
  return withAction(async () => {
    await requirePermission("system.manage_jobs");

    await enqueueDueScheduled();
    const drained = await drainQueue({ maxJobs: 10, budgetMs: 10_000 });

    revalidatePath("/admin/jobs");
    return ok({ claimed: drained.claimed, dead: drained.dead });
  });
}
