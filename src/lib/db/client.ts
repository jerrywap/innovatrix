import "server-only";
import mongoose, { type Connection, type Mongoose } from "mongoose";
import { serverEnv } from "@/config/env";

/**
 * MongoDB connection.
 *
 * Two problems this module exists to solve:
 *
 * 1. **Next.js reloads modules constantly.** In dev, every HMR pass re-evaluates
 *    this file; in serverless, every warm invocation may too. Without a cache on
 *    `globalThis` you get a new connection pool per reload until Mongo refuses
 *    further connections.
 *
 * 2. **Models can only be compiled once per connection.** Re-running
 *    `mongoose.model("Product", schema)` after a reload throws
 *    `OverwriteModelError`. `defineModel` below makes registration idempotent.
 */

declare global {
  var __innovatrixMongoose:
    { conn: Mongoose | null; promise: Promise<Mongoose> | null } | undefined;
}

const cache = (globalThis.__innovatrixMongoose ??= { conn: null, promise: null });

export async function connectToDatabase(): Promise<Mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const env = serverEnv();

    mongoose.set("strictQuery", true);
    // Surfaces a query that will hang because a collection/index is missing,
    // instead of buffering it for 10s and then failing opaquely.
    mongoose.set("bufferCommands", false);

    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB_NAME,
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 8_000,
        socketTimeoutMS: 45_000,
        // retryWrites is deliberately NOT set here. It is a replica-set
        // feature, and forcing it on breaks a standalone mongod outright
        // ("does not support retryable writes"). The driver already defaults
        // it to true, and the connection string can turn it off for local
        // standalone dev — see MONGODB_URI in .env.example.
        // Fulfilment writes must survive a primary failover (§62, §87).
        writeConcern: { w: "majority" },
      })
      .then((m) => {
        cache.conn = m;
        return m;
      })
      .catch((error) => {
        // Clear the promise so the next request retries rather than awaiting a
        // permanently rejected promise for the lifetime of the process.
        cache.promise = null;
        throw error;
      });
  }

  return cache.promise;
}

/**
 * Whether this deployment can run multi-document transactions.
 *
 * Only a replica set can. A standalone mongod rejects `startTransaction`
 * outright, so anything that assumes otherwise fails at runtime rather than at
 * boot — Better Auth's MongoDB adapter in particular defaults transactions
 * **on** whenever a `MongoClient` is passed, and every write it makes then
 * fails against local dev.
 *
 * `MONGODB_TRANSACTIONS` overrides the guess. The guess itself is deliberately
 * pessimistic: assuming "no" costs atomicity guarantees we can detect, while
 * assuming "yes" wrongly breaks every write.
 */
export function supportsTransactions(): boolean {
  const env = serverEnv();
  if (env.MONGODB_TRANSACTIONS !== undefined) return env.MONGODB_TRANSACTIONS;

  const uri = env.MONGODB_URI;
  // mongodb+srv is Atlas (or a seedlist DNS deployment) — always a replica set.
  if (uri.startsWith("mongodb+srv://")) return true;
  return /[?&]replicaSet=/i.test(uri);
}

export async function getConnection(): Promise<Connection> {
  const m = await connectToDatabase();
  return m.connection;
}

/**
 * Register a model exactly once per connection.
 *
 * Always define models through this helper. A bare `mongoose.model(...)` at
 * module scope throws on the second HMR pass.
 */
export function defineModel<T>(name: string, schema: mongoose.Schema<T>): mongoose.Model<T> {
  return (
    (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema)
  );
}

/** Tests and scripts only — the web app never disconnects deliberately. */
export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}

export { mongoose };
