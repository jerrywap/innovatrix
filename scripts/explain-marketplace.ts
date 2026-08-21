/**
 * Proves the §94 performance criteria, or fails loudly.
 *
 *   npm run db:explain
 *
 * Two things are asserted across a matrix of realistic filter shapes:
 *
 * 1. **An index is used.** A `COLLSCAN` anywhere is a failure, not a warning —
 *    on a thousand products it is imperceptible and on fifty thousand it is the
 *    outage.
 * 2. **Under 300ms.** The number in the ticket.
 *
 * Written as a script with a non-zero exit rather than a vitest case because it
 * needs a *populated* database, which CI does not have by default — ticket 27
 * can wire it into a pipeline that does.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { buildMarketplacePipeline } from "../src/services/marketplace/pipeline";
import type { MarketplaceQueryInput } from "../src/services/marketplace/pipeline";

const BUDGET_MS = 300;

const base = {
  sort: "latest",
  page: 1,
  limit: 24,
  currency: "GBP",
  catalogue: "script",
} as const;

const CASES: Array<{ label: string; query: MarketplaceQueryInput }> = [
  { label: "unfiltered, page 1", query: { ...base } },
  { label: "unfiltered, page 20", query: { ...base, page: 20 } },
  { label: "one category (the fat head)", query: { ...base, category: ["crm"] } },
  { label: "one category (the thin tail)", query: { ...base, category: ["hr-and-rota"] } },
  {
    label: "two categories + a technology",
    query: { ...base, category: ["crm", "property"], technology: ["laravel"] },
  },
  {
    label: "category + industry + technology + type",
    query: {
      ...base,
      category: ["crm"],
      industry: ["healthcare"],
      technology: ["laravel"],
      productType: "complete-application",
    },
  },
  { label: "price range", query: { ...base, minPrice: 50_000, maxPrice: 250_000 } },
  {
    label: "category + price range",
    query: { ...base, category: ["crm"], minPrice: 50_000, maxPrice: 250_000 },
  },
  { label: "customisable only", query: { ...base, customisable: true } },
  { label: "sort by price ascending", query: { ...base, sort: "price_asc" } },
  { label: "sort by popularity", query: { ...base, sort: "popular" } },
  { label: "free text", query: { ...base, q: "appointments reminders", sort: "relevance" } },
  {
    label: "free text + category",
    query: { ...base, q: "invoices", category: ["finance"], sort: "relevance" },
  },
  { label: "NGN pricing", query: { ...base, currency: "NGN", sort: "price_asc" } },
  /*
   * Both sides of the catalogue split, because they take *different* index bounds
   * and only one of them is a point lookup.
   *
   * The script predicate is an `$in` of two point values, chosen so that `facets`
   * still bounds after it — a `$ne` on the middle key of
   * `{ status, catalogue, facets }` would strip those bounds and slow every
   * marketplace query, not only the template ones. If that regresses, it shows up
   * here as a jump in `totalKeysExamined` on the *script* rows.
   */
  { label: "templates, unfiltered", query: { ...base, catalogue: "template" } },
  {
    label: "templates + a category",
    query: { ...base, catalogue: "template", category: ["admin-dashboards"] },
  },
  { label: "both catalogues (a vendor storefront)", query: { ...base, catalogue: "all" } },
];

interface Stage {
  stage?: string;
  inputStage?: Stage;
  inputStages?: Stage[];
  indexName?: string;
  [key: string]: unknown;
}

/**
 * Find the **winning** plan, wherever this pipeline shape put it.
 *
 * Two shapes to handle, and getting this wrong is worse than not checking at
 * all: a `$facet` pipeline reports under `stages[0].$cursor.queryPlanner`,
 * everything else at the top level. And the walk must start at `winningPlan`
 * rather than at `queryPlanner` — the latter also contains `rejectedPlans`, so
 * walking it reports every index MongoDB *considered* and would flag a COLLSCAN
 * that was considered and discarded.
 */
function winningPlan(explained: Record<string, unknown>): Stage | undefined {
  const direct = explained.queryPlanner as Record<string, unknown> | undefined;
  if (direct?.winningPlan) return direct.winningPlan as Stage;

  const cursor = (explained.stages as Array<Record<string, unknown>> | undefined)?.[0]?.[
    "$cursor"
  ] as Record<string, unknown> | undefined;
  const planner = cursor?.queryPlanner as Record<string, unknown> | undefined;

  return planner?.winningPlan as Stage | undefined;
}

/** Walk the plan tree — the interesting stage is never at the top. */
function collectStages(plan: Stage | undefined, found: string[] = []): string[] {
  if (!plan) return found;
  if (plan.stage) found.push(plan.stage);
  if (plan.inputStage) collectStages(plan.inputStage, found);
  for (const child of plan.inputStages ?? []) collectStages(child, found);
  return found;
}

function indexNames(plan: Stage | undefined, found: string[] = []): string[] {
  if (!plan) return found;
  if (typeof plan.indexName === "string") found.push(plan.indexName);
  if (plan.inputStage) indexNames(plan.inputStage, found);
  for (const child of plan.inputStages ?? []) indexNames(child, found);
  return found;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });
  const M = await import("../src/lib/db/models");

  const total = await M.Product.countDocuments({ status: "published", deletedAt: null });
  console.log(`\n${total} published products\n`);

  if (total < 500) {
    console.log("⚠  fewer than 500 products — run `npm run db:seed:bulk` first.\n");
  }

  console.log(`${"case".padEnd(38)} ${"ms".padStart(6)} ${"rows".padStart(6)}  plan`);
  console.log("─".repeat(96));

  let failures = 0;

  for (const { label, query } of CASES) {
    const pipeline = buildMarketplacePipeline(query);

    // Timed separately from the explain: `explain` itself adds overhead, and
    // the number in the ticket is about the real query.
    const started = performance.now();
    const [result] = await M.Product.aggregate(pipeline as never[]);
    const elapsed = performance.now() - started;
    const rows = (result?.total?.[0]?.value as number | undefined) ?? 0;

    const explained = (await M.Product.aggregate(pipeline as never[]).explain(
      "queryPlanner",
    )) as unknown as Record<string, unknown>;

    const plan = winningPlan(explained);
    const stages = collectStages(plan);

    const collscan = stages.includes("COLLSCAN");
    const indexed = stages.some((stage) => stage === "IXSCAN" || stage === "TEXT_MATCH");
    const slow = elapsed > BUDGET_MS;
    const names = [...new Set(indexNames(plan))];

    // "No index and no COLLSCAN" means the plan was not read at all — a silent
    // pass is exactly what this script exists to prevent.
    const unreadable = !collscan && !indexed;
    const verdict = collscan
      ? "✗ COLLSCAN"
      : slow
        ? "✗ SLOW"
        : unreadable
          ? `✗ PLAN NOT READ (${stages.join(">") || "empty"})`
          : "✓";
    if (collscan || slow || unreadable) failures += 1;

    console.log(
      `${label.padEnd(38)} ${elapsed.toFixed(0).padStart(6)} ${String(rows).padStart(6)}  ${verdict}` +
        (names.length ? `  [${names.join(", ")}]` : ""),
    );
  }

  console.log("─".repeat(96));
  console.log(
    failures === 0
      ? `\n✓ every case indexed and under ${BUDGET_MS}ms\n`
      : `\n✗ ${failures} case${failures === 1 ? "" : "s"} failed\n`,
  );

  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
