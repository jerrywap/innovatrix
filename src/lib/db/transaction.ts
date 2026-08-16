import "server-only";
import type { ClientSession } from "mongoose";
import { connectToDatabase, mongoose, supportsTransactions } from "./client";

/**
 * Multi-document transactions.
 *
 * **Requires a replica set.** A standalone mongod cannot start a transaction —
 * `npm run db:up` provides a single-node replica set locally; Atlas is one by
 * default.
 *
 * The driver's `session.withTransaction()` already implements MongoDB's
 * documented retry loop for `TransientTransactionError` and
 * `UnknownTransactionCommitResult`, so we delegate to it rather than
 * hand-rolling one.
 *
 * ⚠️ **The callback may run more than once.** On a transient error the driver
 * replays it whole. Keep side effects that aren't part of the transaction —
 * sending email, calling a payment provider, writing a file — outside it.
 * Enqueue them on the session instead (ticket 25) so they fire only on commit.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (!supportsTransactions()) {
    // Fail with the cause named. The driver's own error ("Transaction numbers
    // are only allowed on a replica set member or mongos") is accurate but
    // reads like a bug in our code rather than a deployment shape.
    throw new Error(
      "This MongoDB deployment does not support transactions — a replica set is required. " +
        "Run `npm run db:up` for a single-node replica set, or set MONGODB_TRANSACTIONS=true " +
        "if the derivation from MONGODB_URI is wrong.",
    );
  }

  await connectToDatabase();
  const session = await mongoose.startSession();

  try {
    let result: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
    // Assigned by the callback; `withTransaction` rethrows on failure, so
    // reaching this line means it committed.
    return result!;
  } finally {
    await session.endSession();
  }
}

/**
 * Operations that must never partially apply. Keep this list current — it is
 * the checklist a reviewer reads when a service touches money or entitlement.
 *
 *  1. Checkout            — create order + clear cart                (ticket 11)
 *  2. Payment verified    — payment + order + entitlements + licences (ticket 13/14)
 *  3. Quote accepted      — quote state + invoice creation            (ticket 22/23)
 *  4. Request submitted   — request + conversation link + reference   (ticket 17/18)
 *
 * Reference generation inside any of these must join the same session, or a
 * rolled-back order still burns a reference number and leaves a gap.
 */
export const MANDATORY_TRANSACTION_FLOWS = [
  "checkout.createOrder",
  "payments.fulfilOnVerified",
  "quotes.accept",
  "requests.submit",
] as const;
