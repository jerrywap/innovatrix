/**
 * Index synchronisation — ticket 02.
 *
 * Mongoose's `autoIndex` builds indexes lazily and *asynchronously* the first
 * time a model is used. A short-lived process (a seed script, a serverless
 * invocation) can therefore exit before the build finishes, leaving indexes
 * that exist in code but not in the database — which is invisible until a
 * marketplace query starts collection-scanning in production.
 *
 * This makes it explicit and awaited. Run it after a deploy and after seeding.
 *
 *   npm run db:indexes
 *
 * `syncIndexes()` also *drops* indexes that are no longer declared, so this is
 * the migration path when an index is removed rather than added.
 */
import "dotenv/config";
import mongoose from "mongoose";

export async function syncAllIndexes(): Promise<void> {
  const models = mongoose.modelNames().sort();
  let created = 0;
  let dropped = 0;

  for (const name of models) {
    const model = mongoose.model(name);
    // Returns the names of indexes it removed; created ones are implicit.
    const removed = await model.syncIndexes();
    const indexes = await model.collection.indexes();
    created += indexes.length;
    dropped += removed.length;
    console.log(
      `  ${name.padEnd(22)} ${String(indexes.length).padStart(2)} index(es)` +
        (removed.length ? `  (dropped ${removed.join(", ")})` : ""),
    );
  }

  console.log(`\n${models.length} models · ${created} indexes present · ${dropped} dropped`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });
  await import("../src/lib/db/models");

  console.log("syncing indexes…\n");
  await syncAllIndexes();
  await mongoose.disconnect();
}

// Only run when invoked directly, so `seed.ts` can import `syncAllIndexes`.
if (process.argv[1]?.includes("sync-indexes")) {
  main().catch(async (error) => {
    console.error("index sync failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
