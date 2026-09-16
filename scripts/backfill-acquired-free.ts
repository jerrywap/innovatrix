import "dotenv/config";
import mongoose from "mongoose";

/**
 * Mark existing entitlements that cost nothing.
 *
 * ## Why a backfill rather than a default
 *
 * `acquiredFree` is written at fulfilment, off `order.total.amount`, and it is
 * what decides whether a customer may take an item off their library shelf.
 * Without this, every entitlement that predates the field reads as paid — so
 * somebody who claimed a free template last month would find no way to remove
 * it, while the person who claims one tomorrow can. A flag that is only true
 * going forwards is a feature that works for nobody who already used the thing.
 *
 * Deriving it at read time was the alternative and is worse: it costs a fifth
 * bulk query on the library page, and the only cheap source — today's price —
 * is the wrong answer. A product that was free last year and costs £40 now was
 * still free when it was taken.
 *
 * ## Idempotent
 *
 * The filter excludes rows that already carry the field, so a second run reports
 * zero. Safe against production and safe to run before the reading code ships:
 * the UI tests `acquiredFree === true`, so an absent field simply means "no
 * remove button", which is the state today.
 *
 *   npm run db:backfill:acquired-free
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Use --env-file=.env.local.");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connecting.");

  console.log("\nbackfilling acquiredFree\n");

  /*
   * The order is the authority, so this reads orders and not prices.
   *
   * Projected to ids only and collected in one pass: an entitlement points at
   * exactly one order, and the alternative — a `$lookup` on every entitlement —
   * is a pipeline to answer a question two `find`s answer.
   */
  const freeOrderIds = (
    await db.collection("orders").find({ "total.amount": 0 }).project({ _id: 1 }).toArray()
  ).map((order) => order._id);

  const free = freeOrderIds.length
    ? await db
        .collection("entitlements")
        .updateMany(
          { orderId: { $in: freeOrderIds }, acquiredFree: { $exists: false } },
          { $set: { acquiredFree: true } },
        )
    : { modifiedCount: 0 };

  // Everything else is paid, and is written explicitly rather than left absent
  // so that "no field" stops meaning two different things.
  const paid = await db
    .collection("entitlements")
    .updateMany(
      { orderId: { $nin: freeOrderIds }, acquiredFree: { $exists: false } },
      { $set: { acquiredFree: false } },
    );

  const remaining = await db
    .collection("entitlements")
    .countDocuments({ acquiredFree: { $exists: false } });

  console.log(`  zero-total orders      ${freeOrderIds.length}`);
  console.log(`  marked free            ${free.modifiedCount}`);
  console.log(`  marked paid            ${paid.modifiedCount}`);
  console.log(`  still without the flag ${remaining}`);
  console.log(remaining === 0 ? "\ndone\n" : "\nsome rows were missed — investigate\n");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
