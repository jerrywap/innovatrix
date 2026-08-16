import mongoose, { Schema, Types, type Model } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import { generateReference, parseReference } from "@/lib/references";
import { BaseRepository, OrgScopedRepository, RepositoryError } from "@/repositories/base";
import { MoneySchema, orgScoped, schemaOptions, softDeletable } from "./base";

/**
 * Integration tests against a real MongoDB **replica set** — a standalone
 * mongod cannot start a transaction, so a single-node replSet is the minimum
 * that proves anything about the flows in MANDATORY_TRANSACTION_FLOWS.
 *
 * These import mongoose directly rather than through `@/lib/db/client`, because
 * the client reads validated env at module load and its `globalThis` cache is
 * deliberately process-wide. Connection caching is exercised separately.
 */

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    // The default 10s launch timeout is fine once the mongod binary is cached,
    // but the first run on a machine (or a cold CI cache) downloads and
    // extracts it first, which blows straight through 10s.
    instanceOpts: [{ launchTimeout: 120_000 }],
  });
  await mongoose.connect(replSet.getUri(), { dbName: "test" });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
});

/* ────────────────────────────────────────────── fixtures */

interface Priced {
  name: string;
  price: { amount: number; currency: string };
}

const pricedSchema = new Schema<Priced>(
  {
    name: { type: String, required: true },
    price: { type: MoneySchema, required: true },
  },
  schemaOptions(),
);

const PricedModel = () =>
  (mongoose.models.Priced as Model<Priced> | undefined) ??
  mongoose.model<Priced>("Priced", pricedSchema);

interface Doc {
  name: string;
  organizationId: Types.ObjectId;
  deletedAt: Date | null;
}

const docSchema = new Schema<Doc>(
  softDeletable(orgScoped({ name: { type: String, required: true } })),
  schemaOptions(),
);

const DocModel = () =>
  (mongoose.models.Doc as Model<Doc> | undefined) ?? mongoose.model<Doc>("Doc", docSchema);

const objectId = () => new Types.ObjectId();

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) =>
      (c as { deleteMany: () => Promise<unknown> }).deleteMany(),
    ),
  );
});

/* ────────────────────────────────────────────── money */

describe("MoneySchema — §84 enforced at the database boundary", () => {
  it("rejects a float amount", async () => {
    const M = PricedModel();
    await expect(
      M.create({ name: "CRM", price: { amount: 299.99, currency: "GBP" } }),
    ).rejects.toThrow(/integer in minor units/);
  });

  it("accepts integer minor units and stores them as an integer", async () => {
    const M = PricedModel();
    await M.create({ name: "CRM", price: { amount: 29999, currency: "GBP" } });

    const [raw] = await M.collection
      .aggregate([{ $project: { t: { $type: "$price.amount" }, v: "$price.amount" } }])
      .toArray();

    expect(raw?.v).toBe(29999);
    expect(["int", "long"]).toContain(raw?.t); // never "double"
  });

  it("rejects an unsupported currency", async () => {
    const M = PricedModel();
    await expect(
      M.create({ name: "x", price: { amount: 1, currency: "XYZ" } }),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────── transactions */

describe("transactions", () => {
  it("rolls back every write when the callback throws", async () => {
    const M = PricedModel();
    const session = await mongoose.startSession();

    await expect(
      session.withTransaction(async () => {
        await M.create([{ name: "a", price: { amount: 100, currency: "GBP" } }], { session });
        await M.create([{ name: "b", price: { amount: 200, currency: "GBP" } }], { session });
        throw new Error("payment provider timed out");
      }),
    ).rejects.toThrow("payment provider timed out");

    await session.endSession();
    expect(await M.countDocuments()).toBe(0);
  });

  it("commits both writes when the callback succeeds", async () => {
    const M = PricedModel();
    const session = await mongoose.startSession();

    await session.withTransaction(async () => {
      await M.create([{ name: "a", price: { amount: 100, currency: "GBP" } }], { session });
      await M.create([{ name: "b", price: { amount: 200, currency: "GBP" } }], { session });
    });

    await session.endSession();
    expect(await M.countDocuments()).toBe(2);
  });
});

/* ────────────────────────────────────────────── counter store */

describe("MongoCounterStore — the §26 concurrency contract, for real", () => {
  interface Counter {
    _id: string;
    seq: number;
  }

  const counterSchema = new Schema<Counter>(
    { _id: { type: String, required: true }, seq: { type: Number, default: 0 } },
    { versionKey: false },
  );

  const CounterModel = () =>
    (mongoose.models.Counter as Model<Counter> | undefined) ??
    mongoose.model<Counter>("Counter", counterSchema);

  // Mirrors MongoCounterStore exactly; that module imports `server-only`, which
  // Vitest aliases away, so the atomic $inc is exercised directly here.
  const store = {
    async next(key: string) {
      const doc = await CounterModel()
        .findOneAndUpdate(
          { _id: key },
          { $inc: { seq: 1 } },
          {
            returnDocument: "after",
            upsert: true,
          },
        )
        .lean<Counter>()
        .exec();
      if (!doc) throw new Error("counter upsert returned nothing");
      return doc.seq;
    },
  };

  it("produces 500 distinct, gapless references under real concurrency", async () => {
    const refs = await Promise.all(
      Array.from({ length: 500 }, () => generateReference(store, "ORD", 2026)),
    );

    expect(new Set(refs).size).toBe(500);

    const seqs = refs.map((r) => parseReference(r).sequence).sort((a, b) => a - b);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(500);
    expect(seqs.every((s, i) => s === i + 1)).toBe(true);
  }, 30_000);

  it("keeps prefixes and years in separate sequences", async () => {
    expect(await generateReference(store, "INV", 2026)).toBe("INV-2026-0001");
    expect(await generateReference(store, "INV", 2026)).toBe("INV-2026-0002");
    expect(await generateReference(store, "QUO", 2026)).toBe("QUO-2026-0001");
    expect(await generateReference(store, "INV", 2027)).toBe("INV-2027-0001");
  });
});

/* ────────────────────────────────────────────── repositories */

describe("BaseRepository — §94, no unbounded reads", () => {
  it("clamps an oversized limit to MAX_PAGE_SIZE", async () => {
    const M = DocModel();
    const org = objectId();
    await M.insertMany(
      Array.from({ length: 120 }, (_, i) => ({ name: `doc-${i}`, organizationId: org })),
    );

    const repo = new BaseRepository(M);
    const page = await repo.list({ limit: 5000 });

    expect(page.limit).toBe(100);
    expect(page.items).toHaveLength(100);
    expect(page.total).toBe(120);
    expect(page.hasNext).toBe(true);
  });

  it("defaults to a bounded page when no limit is given", async () => {
    const M = DocModel();
    const org = objectId();
    await M.insertMany(
      Array.from({ length: 50 }, (_, i) => ({ name: `d${i}`, organizationId: org })),
    );

    const page = await new BaseRepository(M).list();
    expect(page.items).toHaveLength(20);
  });

  it("rejects a nonsense limit rather than silently correcting it", async () => {
    await expect(new BaseRepository(DocModel()).list({ limit: 0 })).rejects.toThrow(
      RepositoryError,
    );
  });

  it("excludes soft-deleted documents by default", async () => {
    const M = DocModel();
    const org = objectId();
    const doc = await M.create({ name: "gone", organizationId: org });
    const repo = new BaseRepository(M);

    await repo.deleteById(String(doc._id));

    expect(await repo.findById(String(doc._id))).toBeNull();
    expect((await repo.list()).total).toBe(0);
    expect((await repo.list({ includeDeleted: true })).total).toBe(1);
  });
});

describe("OrgScopedRepository — tenant isolation", () => {
  it("refuses to build a query without an organizationId", async () => {
    const repo = new OrgScopedRepository(DocModel());
    await expect(repo.listForOrg("")).rejects.toThrow(RepositoryError);
    await expect(repo.listForOrg("")).rejects.toThrow(/organizationId is required/);
  });

  it("never returns another organization’s documents", async () => {
    const M = DocModel();
    const orgA = objectId();
    const orgB = objectId();
    const a = await M.create({ name: "A private", organizationId: orgA });
    await M.create({ name: "B private", organizationId: orgB });

    const repo = new OrgScopedRepository(M);

    const listB = await repo.listForOrg(String(orgB));
    expect(listB.total).toBe(1);
    expect(listB.items[0]?.name).toBe("B private");

    // The exact cross-tenant attempt ticket 26 turns into a standing CI gate:
    // a valid id from another org must not resolve.
    expect(await repo.findByIdForOrg(String(a._id), String(orgB))).toBeNull();
    expect(await repo.findByIdForOrg(String(a._id), String(orgA))).not.toBeNull();
  });

  it("scopes counts to the organization", async () => {
    const M = DocModel();
    const orgA = objectId();
    const orgB = objectId();
    await M.insertMany([
      { name: "1", organizationId: orgA },
      { name: "2", organizationId: orgA },
      { name: "3", organizationId: orgB },
    ]);

    const repo = new OrgScopedRepository(M);
    expect(await repo.countForOrg(String(orgA))).toBe(2);
    expect(await repo.countForOrg(String(orgB))).toBe(1);
  });
});
