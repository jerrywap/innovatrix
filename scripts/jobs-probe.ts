import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { Job } from "@/lib/db/models/system";
import { Organization } from "@/lib/db/models/identity";
import { Notification } from "@/lib/db/models/communication";
import { enqueue } from "@/services/jobs/queue";
import { drainQueue } from "@/services/jobs/runner";
import { enqueueDueScheduled, SCHEDULE } from "@/services/jobs/schedule";
import { registerJobs } from "@/services/jobs/handlers";
import { withTransaction } from "@/lib/db/transaction";
import { dispatch } from "@/services/notifications/notification-service";

/**
 * `tsx --conditions=react-server --env-file=.env.local scripts/jobs-probe.ts`
 *
 * Drives the queue against the real dev database.
 *
 * The integration suite proves the mechanics against an ephemeral replica set.
 * What it cannot show is the half that only exists here: that the schedule
 * enqueues the jobs you expect, that the real handlers run against real seeded
 * data without throwing, and that a notification's email actually reaches
 * `.dev-emails/` through the queue rather than through the transport directly.
 *
 * Safe to run repeatedly — every sweep is idempotent, and the probe cleans up
 * the rows it created itself.
 */

const PROBE_KEY = "probe:jobs";

async function main() {
  await connectToDatabase();
  registerJobs();

  const org = await Organization.findOne({ slug: "brightpath-care" }).lean<{
    _id: unknown;
    name: string;
  }>();
  if (!org) throw new Error("Run `npm run db:seed` first.");

  console.log(`\norganisation: ${org.name}\n`);

  /* ── 1. the schedule ─────────────────────────────────── */

  console.log("SCHEDULE");
  for (const job of SCHEDULE) {
    console.log(`  ${job.name.padEnd(28)} every ${job.everyMinutes} min`);
  }

  const first = await enqueueDueScheduled();
  const second = await enqueueDueScheduled();

  console.log(`\n  tick 1 enqueued ${first.enqueued.length}, skipped ${first.skipped.length}`);
  console.log(
    `  tick 2 enqueued ${second.enqueued.length}, skipped ${second.skipped.length}` +
      (second.enqueued.length === 0 ? "  ← idempotent" : "  ← WRONG, should be 0"),
  );

  /* ── 2. transactional enqueue ────────────────────────── */

  const beforeRollback = await Job.countDocuments({ idempotencyKey: PROBE_KEY });

  try {
    await withTransaction(async (session) => {
      await enqueue(
        "send-email",
        { to: "nobody@innovatrix.test", subject: "should never send", text: "—" },
        { idempotencyKey: PROBE_KEY, session },
      );
      throw new Error("deliberate rollback");
    });
  } catch {
    // Expected.
  }

  const afterRollback = await Job.countDocuments({ idempotencyKey: PROBE_KEY });
  console.log(
    `\nTRANSACTIONAL ENQUEUE\n  rows before ${beforeRollback}, after rollback ${afterRollback}` +
      (afterRollback === beforeRollback ? "  ← nothing leaked" : "  ← WRONG, a job survived"),
  );

  /* ── 3. a real notification, delivered through the queue ── */

  /*
   * A fresh id every run.
   *
   * The dedupe key is derived from the href, which contains the invoice id, so
   * a fixed id makes the second run of this probe report `skipped 1` and queue
   * nothing — correct behaviour, and useless as a probe of the delivery path.
   * Found by running it twice.
   */
  const invoiceId = String(new Types.ObjectId());

  const result = await dispatch(
    "InvoiceIssued",
    {
      invoiceId,
      reference: "INV-2026-9002",
      organizationId: String(org._id),
      portion: "deposit",
      total: 540_000,
      currency: "GBP",
    },
    { organizationId: String(org._id) },
  );

  const queued = await Job.countDocuments({ name: "send-email", status: "pending" });
  console.log(
    `\nNOTIFICATION → QUEUE\n  written ${result.written}, skipped ${result.skipped}, failed ${result.failed}`,
  );
  console.log(`  send-email jobs pending: ${queued}`);

  /* ── 4. drain, and see what the handlers actually did ──── */

  const drained = await drainQueue({ maxJobs: 50, budgetMs: 60_000 });

  console.log(
    `\nDRAIN\n  claimed ${drained.claimed} · succeeded ${drained.succeeded} · ` +
      `failed ${drained.failed} · dead ${drained.dead} · reclaimed ${drained.reclaimed}`,
  );

  await Notification.deleteMany({
    dedupeKey: `InvoiceIssued:0:/dashboard/invoices/${invoiceId}`,
  });

  const dead = await Job.find({ status: "dead" })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean<Array<{ name: string; attempts: number; lastError?: string }>>();

  if (dead.length > 0) {
    console.log("\n  dead-lettered:");
    for (const job of dead) {
      console.log(`    ${job.name} (${job.attempts} tries) — ${job.lastError ?? "no error"}`);
    }
  }

  /* ── 5. what the collection looks like now ───────────── */

  const byStatus = await Job.aggregate<{ _id: string; count: number }>([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  console.log("\nCOLLECTION");
  for (const row of byStatus) console.log(`  ${row._id.padEnd(12)} ${row.count}`);

  console.log("\nEmails, if any, are in .dev-emails/\n");

  await Job.deleteMany({ idempotencyKey: PROBE_KEY });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\njobs probe failed:", error);
    process.exit(1);
  });
