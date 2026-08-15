import "server-only";
import { Schema, type ClientSession, type Model } from "mongoose";
import type { CounterStore } from "@/lib/references";
import { defineModel } from "./client";

/**
 * The durable counter behind business references (§26).
 *
 * Ticket 00 defined the `CounterStore` port and proved the contract against an
 * in-memory implementation. This is the implementation that has to hold under
 * real concurrency: a single `findOneAndUpdate` with `$inc` and `upsert`, which
 * MongoDB executes atomically on one document. Two web workers racing for
 * ORD-2026-0001 get 0001 and 0002 — never the same number twice.
 *
 * What would break it, for the next person tempted to "simplify":
 *   • read-then-write (`findOne` then `save`) — a lost update under load
 *   • `$inc` without `upsert` — the first ever call for a year silently no-ops
 *   • generating the reference outside the caller's transaction — a rolled-back
 *     order still burns a number, leaving a permanent gap in the sequence
 */

interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: "counters" },
);

export const CounterModel: Model<CounterDoc> = defineModel<CounterDoc>(
  "Counter",
  counterSchema,
);

export class MongoCounterStore implements CounterStore {
  constructor(private readonly session?: ClientSession | undefined) {}

  async next(key: string): Promise<number> {
    const doc = await CounterModel.findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      {
        returnDocument: "after",
        upsert: true,
        session: this.session ?? undefined,
        setDefaultsOnInsert: true,
      },
    )
      .lean<CounterDoc>()
      .exec();

    if (!doc) {
      throw new Error(`Counter "${key}" returned no document after upsert.`);
    }
    return doc.seq;
  }
}

/**
 * Build a counter store bound to a transaction session.
 *
 * Always pass the session when generating a reference inside a transaction —
 * see the `MANDATORY_TRANSACTION_FLOWS` list in `transaction.ts`.
 */
export function counterStore(session?: ClientSession): CounterStore {
  return new MongoCounterStore(session);
}
