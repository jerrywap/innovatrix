/**
 * Do the staff queues use their indexes? — §32's acceptance criterion.
 *
 *   npm run db:explain:queues
 *
 * Seeds 10,000 requests, runs `explain("executionStats")` on every queue, and
 * fails if any of them scans the collection. A queue is the screen staff leave
 * open all day; at a thousand requests a `COLLSCAN` is imperceptible and at
 * fifty thousand it is the outage.
 *
 * Follows `explain-marketplace.ts` — including its correction. The walk starts
 * at `winningPlan`, **not** `queryPlanner`: the latter also holds
 * `rejectedPlans`, so walking it reports every index MongoDB *considered* and
 * flags scans that were considered and discarded. That version passed while
 * being wrong.
 */
import "dotenv/config";
import mongoose from "mongoose";

const SEED_COUNT = 10_000;
const BUDGET_MS = 300;

type Stage = Record<string, unknown>;

function winningPlan(explained: Record<string, unknown>): Stage | undefined {
  const planner = explained.queryPlanner as Record<string, unknown> | undefined;
  return planner?.winningPlan as Stage | undefined;
}

function collectStages(plan: Stage | undefined, found: string[] = []): string[] {
  if (!plan) return found;
  if (typeof plan.stage === "string") found.push(plan.stage);
  if (plan.inputStage) collectStages(plan.inputStage as Stage, found);
  for (const child of (plan.inputStages as Stage[] | undefined) ?? []) {
    collectStages(child, found);
  }
  return found;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });

  const { CustomerRequest } = await import("../src/lib/db/models/requests");
  const { Organization } = await import("../src/lib/db/models/identity");
  const { QUEUES } = await import("../src/features/staff/queues");

  const org = await Organization.findOne({ slug: "brightpath-care" }).lean<{
    _id: mongoose.Types.ObjectId;
  }>();
  if (!org) throw new Error("seed the database first (npm run db:seed)");

  await CustomerRequest.syncIndexes();

  const existing = await CustomerRequest.countDocuments({ reference: /^EXP-/ });
  if (existing < SEED_COUNT) {
    console.log(`seeding ${SEED_COUNT - existing} synthetic requests…`);

    const kinds = ["customization", "custom_build"] as const;
    const statuses = [
      "submitted",
      "under_review",
      "waiting_for_customer",
      "technical_review",
      "quoted",
      "converted",
    ] as const;

    const staffUser = new mongoose.Types.ObjectId();
    const batch = [];

    for (let index = existing; index < SEED_COUNT; index += 1) {
      const status = statuses[index % statuses.length]!;
      batch.push({
        reference: `EXP-2026-${String(index).padStart(6, "0")}`,
        kind: kinds[index % 2]!,
        organizationId: org._id,
        userId: new mongoose.Types.ObjectId(),
        title: `Synthetic request ${index}`,
        customerRequirements: [],
        assumptions: [],
        status,
        // A third assigned, so `unassigned` and `mine` both have real work to do.
        ...(index % 3 === 0 ? { currentAssigneeUserId: staffUser } : {}),
        ...(status === "waiting_for_customer"
          ? { waitingOn: "customer" }
          : status === "converted"
            ? {}
            : { waitingOn: "innovatrix" }),
      });

      if (batch.length === 1000) {
        await CustomerRequest.insertMany(batch, { ordered: false });
        batch.length = 0;
      }
    }
    if (batch.length) await CustomerRequest.insertMany(batch, { ordered: false });
  }

  const total = await CustomerRequest.countDocuments({});
  console.log(`\n${total} requests in the collection\n`);

  const staffUserId = String(new mongoose.Types.ObjectId());
  let failures = 0;

  for (const queue of QUEUES) {
    const filter = queue.filter({ staffUserId });

    const explained = (await CustomerRequest.find(filter)
      .sort(queue.sort)
      .limit(100)
      .explain("executionStats")) as unknown as Record<string, unknown>;

    const plan = winningPlan(explained);
    if (!plan) {
      // Loudly, rather than passing because nothing could be read — the exact
      // way `explain-marketplace.ts` used to pass two cases silently.
      console.log(`  \x1b[31mFAIL\x1b[0m ${queue.key.padEnd(24)} could not read a query plan`);
      failures += 1;
      continue;
    }

    const stages = collectStages(plan);
    const stats = explained.executionStats as
      | { executionTimeMillis?: number; totalDocsExamined?: number; nReturned?: number }
      | undefined;

    const scanned = stages.includes("COLLSCAN");
    const ms = stats?.executionTimeMillis ?? -1;
    const slow = ms > BUDGET_MS;
    const ok = !scanned && !slow;

    if (!ok) failures += 1;

    console.log(
      `  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${queue.key.padEnd(24)} ` +
        `${String(ms).padStart(4)}ms  examined ${String(stats?.totalDocsExamined ?? "?").padStart(6)} ` +
        `→ ${String(stats?.nReturned ?? "?").padStart(4)}  [${stages.join(" → ")}]`,
    );
  }

  console.log(
    failures === 0
      ? "\n\x1b[32mevery queue uses an index and is inside the budget\x1b[0m"
      : `\n\x1b[31m${failures} queue(s) need an index\x1b[0m`,
  );

  if (process.argv.includes("--clean")) {
    const removed = await CustomerRequest.deleteMany({ reference: /^EXP-/ });
    console.log(`removed ${removed.deletedCount} synthetic requests`);
  } else {
    console.log("\nsynthetic rows left in place — re-run with --clean to remove them");
  }

  await mongoose.disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
