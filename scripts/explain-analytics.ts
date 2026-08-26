/**
 * Do the reporting pipelines use their indexes?
 *
 *   npm run db:explain:analytics
 *
 * Every panel on the two dashboards starts with the same shape — an equality on
 * `status` (or `kind`) and a range on a date — and the whole design assumes an
 * index serves it. That assumption was already wrong once and silently: the
 * comment in `features/reporting/headline.ts` claimed *"the index on
 * `(status, paidAt)` serves both"* and no such index existed, so the headline
 * revenue figure has been scanning `orders` on every admin page view.
 *
 * A comment cannot catch that. This can, and it is cheaper than the integration
 * test that would be the alternative — one round trip per pipeline, no 129-line
 * preamble, and it reports the index by name so the output is readable rather
 * than merely green.
 *
 * Follows `explain-queues.ts`, including its correction: the walk starts at
 * `winningPlan`, **not** `queryPlanner`, because the latter also holds
 * `rejectedPlans` — so walking it reports every index MongoDB *considered* and
 * passes while being wrong.
 */
import "dotenv/config";
import mongoose from "mongoose";

type Stage = Record<string, unknown>;

function winningPlan(explained: Record<string, unknown>): Stage | undefined {
  const planner = explained.queryPlanner as Record<string, unknown> | undefined;
  if (planner?.winningPlan) return planner.winningPlan as Stage;

  // An aggregation explains as `stages[0].$cursor.queryPlanner`, not at the top
  // level — the shape differs from a `find()` explain and walking the wrong one
  // silently finds nothing to complain about.
  const stages = explained.stages as Array<Record<string, unknown>> | undefined;
  const cursor = stages?.[0]?.$cursor as Record<string, unknown> | undefined;
  const inner = cursor?.queryPlanner as Record<string, unknown> | undefined;
  return inner?.winningPlan as Stage | undefined;
}

function collect(plan: Stage | undefined, found: Stage[] = []): Stage[] {
  if (!plan) return found;
  if (typeof plan.stage === "string") found.push(plan);
  if (plan.inputStage) collect(plan.inputStage as Stage, found);
  if (plan.queryPlan) collect(plan.queryPlan as Stage, found);
  for (const child of (plan.inputStages as Stage[] | undefined) ?? []) collect(child, found);
  return found;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);

  const { Invoice, Quote } = await import("../src/lib/db/models/billing");
  const { Product } = await import("../src/lib/db/models/catalog");
  const { Order, Payment } = await import("../src/lib/db/models/commerce");
  const { Organization } = await import("../src/lib/db/models/identity");
  const { AiConversation, CustomerRequest } = await import("../src/lib/db/models/requests");
  const { parseRange } = await import("../src/features/reporting/range");

  // The widest window the UI offers, because that is the query worth checking.
  const range = parseRange({ range: "12m" }, new Date());
  const window = { $gte: range.from, $lt: range.to };

  const checks: Array<{
    panel: string;
    model: {
      collection: { collectionName: string };
      aggregate: (p: unknown[]) => { explain: () => Promise<Record<string, unknown>> };
    };
    match: Record<string, unknown>;
  }> = [
    {
      panel: "revenue over time",
      model: Order as never,
      match: { status: { $in: ["paid", "fulfilled"] }, paidAt: window },
    },
    {
      panel: "payment outcomes",
      model: Payment as never,
      match: { status: "succeeded", createdAt: window },
    },
    {
      panel: "requests arriving",
      model: CustomerRequest as never,
      match: { kind: "custom_build", submittedAt: window },
    },
    {
      panel: "quotes issued",
      model: Quote as never,
      match: { status: "accepted", issuedAt: window },
    },
    {
      panel: "products published",
      model: Product as never,
      match: { status: "published", publishedAt: window },
    },
    {
      panel: "new customers",
      model: Organization as never,
      match: { createdAt: window },
    },
    {
      panel: "assistant spend",
      model: AiConversation as never,
      match: { createdAt: window },
    },
    {
      panel: "outstanding invoices",
      model: Invoice as never,
      match: { status: { $in: ["issued", "partially_paid", "overdue"] } },
    },
  ];

  let scans = 0;

  for (const check of checks) {
    const explained = await check.model
      .aggregate([{ $match: check.match }, { $group: { _id: null, n: { $sum: 1 } } }])
      .explain();

    const stages = collect(winningPlan(explained));
    const names = stages.map((stage) => String(stage.stage));
    const index = stages.find((stage) => stage.indexName)?.indexName;
    const scanned = names.includes("COLLSCAN");
    if (scanned) scans += 1;

    console.log(
      `${scanned ? "SCAN" : "  ok"}  ${check.panel.padEnd(24)} ` +
        `${check.model.collection.collectionName.padEnd(18)} ` +
        `${scanned ? names.join(" → ") : `index: ${String(index)}`}`,
    );
  }

  await mongoose.disconnect();

  if (scans > 0) {
    console.error(
      `\n${scans} of ${checks.length} reporting queries scan their collection. ` +
        `Declare the missing index in the model file — \`syncIndexes()\` drops anything ` +
        `created by hand.`,
    );
    process.exit(1);
  }

  console.log(`\nAll ${checks.length} reporting queries are served by an index.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
