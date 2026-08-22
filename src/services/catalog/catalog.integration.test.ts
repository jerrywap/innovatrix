import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { DEFAULT_TESTING_CHECKLIST } from "./readiness";
import { VALID_ENV } from "@/test/env";

/**
 * Integration tests for the catalogue services, against a real MongoDB.
 *
 * Every claim here is one a unit test cannot make, because it depends on the
 * database enforcing something:
 *
 * - **Uniqueness is the index's job, not `uniqueSlug`'s.** Two administrators
 *   naming a product the same thing at the same moment both pass the
 *   pre-check; only the index can decide, and only a real index proves the
 *   loser gets a sentence rather than an `E11000` stack trace.
 * - **The guarded status update** is the same shape of race, one transition
 *   later. What matters is not just that the second writer fails, but that the
 *   audit trail records the transition **once** — §90 is worthless if a
 *   double-click makes it ambiguous.
 * - **Facet re-derivation** touches every product referencing a renamed
 *   taxonomy. Its failure mode is silent and only visible in the stored
 *   documents.
 *
 * A **replica set** rather than a standalone mongod, because `transition`
 * takes a different code path when `supportsTransactions()` is true — and that
 * is the path production runs.
 *
 * The services read validated env at import time and cache the connection on
 * `globalThis`, so the environment is set **before** the first dynamic import
 * and the modules are loaded once, here, rather than per test.
 */

let catalog: typeof import("./product-service");
let siblings: typeof import("./template-sibling");
let taxonomyService: typeof import("./taxonomy-service");
let models: typeof import("@/lib/db/models/catalog");
let auditModel: typeof import("@/lib/db/models/communication");
let mongoose: typeof import("mongoose").default;
let marketplace: typeof import("@/services/marketplace/pipeline");

const ACTOR = { type: "staff", userId: "6a80c46f6c887b38e2f0e001", name: "Test" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(key, value);
  }
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "catalog_test");
  // The replica set can transact, so exercise the transactional branch of
  // `transition` rather than the standalone fallback.
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  marketplace = await import("@/services/marketplace/pipeline");
  catalog = await import("./product-service");
  siblings = await import("./template-sibling");
  taxonomyService = await import("./taxonomy-service");
  models = await import("@/lib/db/models/catalog");
  auditModel = await import("@/lib/db/models/communication");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();

  // Mongoose builds indexes lazily and asynchronously; the uniqueness tests
  // below would race the build and pass for the wrong reason.
  await Promise.all([
    models.Product.syncIndexes(),
    models.Taxonomy.syncIndexes(),
    models.ProductVersion.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await Promise.all([
    models.Product.deleteMany({}),
    models.Taxonomy.deleteMany({}),
    models.ProductVersion.deleteMany({}),
    /*
     * Through the native driver, because ticket 26 made the *model* refuse
     * every delete — `AuditLog.deleteMany({})` now throws, which is the point.
     * Emptying a test database is not an application code path, and the
     * collection handle is how that distinction is expressed.
     */
    auditModel.AuditLog.collection.deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── helpers */

async function draft(name = "Atlas CRM") {
  return catalog.createDraft({ name, summary: "A CRM for property teams." }, ACTOR);
}

/** Fill in everything `computeReadiness` asks for except the version. */
async function makeAlmostPublishable(id: string) {
  await models.Product.updateOne(
    { _id: id },
    {
      $set: {
        ...models.descriptionFields({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "What it does." }] }],
        }),
        prices: [{ currency: "GBP", amount: 29_900 }],
        licencePackages: [
          { key: "standard", name: "Standard", prices: [{ currency: "GBP", amount: 29_900 }] },
        ],
        media: [{ kind: "screenshot", url: "https://example.test/a.png", sortOrder: 0 }],
        testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
          item,
          status: "pass",
        })),
      },
    },
  );
}

async function walkTo(id: string, target: "internal_review" | "testing" | "ready") {
  const path = ["internal_review", "testing", "ready"] as const;
  for (const step of path) {
    await catalog.transition(id, step, ACTOR);
    if (step === target) return;
  }
}

const auditActions = async (productId: string) =>
  (
    await auditModel.AuditLog.find({ subjectId: new mongoose.Types.ObjectId(productId) })
      .sort({ createdAt: 1 })
      .lean()
  ).map((row) => row.action);

/* ────────────────────────────────────────────── slugs */

describe("slug uniqueness", () => {
  it("lets exactly one of two simultaneous creations take the slug", async () => {
    const results = await Promise.allSettled([
      catalog.createDraft({ name: "Atlas CRM", summary: "One." }, ACTOR),
      catalog.createDraft({ name: "Atlas CRM", summary: "Two." }, ACTOR),
    ]);

    const created = results.filter((r) => r.status === "fulfilled");
    const slugs = created.map((r) => r.value.slug);

    // Both may legitimately succeed: `uniqueSlug` appends a random suffix when
    // it sees a collision, so the second gets `atlas-crm-x7k2`. What must never
    // happen is two products sharing a slug, or a raw duplicate-key error
    // reaching the caller.
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(String(result.reason)).toMatch(/created|try again/i);
        expect(String(result.reason)).not.toMatch(/E11000|duplicate key/i);
      }
    }
  });

  it("refuses a slug the index already holds, with a suggestion", async () => {
    const first = await draft("Atlas CRM");
    const second = await draft("Tenancy");

    await expect(
      catalog.changeSlug(String(second._id), first.slug, ACTOR),
    ).rejects.toMatchObject({
      fieldErrors: { slug: [expect.stringContaining(first.slug)] },
    });
  });

  it("keeps the old address in slugHistory so ticket 27 can redirect it", async () => {
    const product = await draft();
    await catalog.changeSlug(String(product._id), "atlas-crm-2", ACTOR);

    const after = await models.Product.findById(product._id).lean();
    expect(after?.slug).toBe("atlas-crm-2");
    expect(after?.slugHistory).toContain(product.slug);
  });
});

/* ────────────────────────────────────────────── lifecycle */

describe("transitions", () => {
  it("rejects an illegal jump as a transition error, not a readiness one", async () => {
    const product = await draft();

    // The distinction matters: told to "add a screenshot", an administrator
    // adds one and tries again, and is refused for the same real reason —
    // that you cannot publish straight from draft.
    await expect(catalog.transition(String(product._id), "published", ACTOR)).rejects.toThrow(
      /draft.*published|cannot|transition/i,
    );

    const fresh = await models.Product.findById(product._id).lean();
    expect(fresh?.status).toBe("draft");
  });

  it("names every specific gap when a legal publish is incomplete", async () => {
    const product = await draft();
    const id = String(product._id);
    await models.Product.updateOne(
      { _id: id },
      {
        $set: {
          testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
            item,
            status: "pass",
          })),
        },
      },
    );
    await walkTo(id, "ready");

    await expect(catalog.transition(id, "published", ACTOR)).rejects.toMatchObject({
      fieldErrors: {
        no_price: expect.any(Array),
        no_licence_package: expect.any(Array),
        no_screenshot: expect.any(Array),
        no_description: expect.any(Array),
        no_released_version: expect.any(Array),
      },
    });
  });

  it("blocks entry to ready until the §47 checklist is settled", async () => {
    const product = await draft();
    const id = String(product._id);
    await walkTo(id, "testing");

    await expect(catalog.transition(id, "ready", ACTOR)).rejects.toMatchObject({
      fieldErrors: { testing_incomplete: expect.any(Array) },
    });

    // `na` without a note is clicking through, and does not settle it.
    await models.Product.updateOne(
      { _id: id },
      {
        $set: {
          testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
            item,
            status: "na",
          })),
        },
      },
    );
    await expect(catalog.transition(id, "ready", ACTOR)).rejects.toMatchObject({
      fieldErrors: { testing_incomplete: expect.any(Array) },
    });

    await models.Product.updateOne(
      { _id: id },
      {
        $set: {
          testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
            item,
            status: "na",
            notes: "Not applicable — no payment integration.",
          })),
        },
      },
    );
    await expect(catalog.transition(id, "ready", ACTOR)).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("writes exactly one audit row when two publishes race", async () => {
    const product = await draft();
    const id = String(product._id);
    await makeAlmostPublishable(id);
    const version = await models.ProductVersion.create({
      productId: product._id,
      version: "1.0.0",
      status: "released",
      releasedAt: new Date(),
      changelog: "First release.",
    });
    await models.ProductFile.create({
      productId: product._id,
      versionId: version._id,
      kind: "application_package",
      filename: "atlas.zip",
      storageKey: "innovatrix/test/products/atlas/1.0.0/atlas.zip",
      sizeBytes: 1024,
      contentType: "application/zip",
      scanStatus: "clean",
    });
    await walkTo(id, "ready");

    const results = await Promise.allSettled([
      catalog.transition(id, "published", ACTOR),
      catalog.transition(id, "published", ACTOR),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.reason)).toMatch(/someone else|reload/i);

    // The point of the test. A guarded update that let both writes through
    // would still leave the product published — and the audit trail would
    // claim two people published it.
    const changes = (await auditActions(id)).filter((a) => a === "product.status_changed");
    expect(changes).toHaveLength(4); // review, testing, ready, published

    const publishRows = await auditModel.AuditLog.find({
      subjectId: new mongoose.Types.ObjectId(id),
      "after.status": "published",
    }).lean();
    expect(publishRows).toHaveLength(1);
    expect(publishRows[0]?.before).toMatchObject({ status: "ready" });
  });

  it("reports an already-published product as skipped, not failed", async () => {
    const a = await draft("Atlas CRM");
    const b = await draft("Tenancy");
    for (const p of [a, b]) {
      await makeAlmostPublishable(String(p._id));
      await walkTo(String(p._id), "ready");
    }
    await models.Product.updateOne({ _id: a._id }, { $set: { status: "published" } });

    const result = await catalog.bulkTransition(
      [String(a._id), String(b._id)],
      "published",
      ACTOR,
    );

    expect(result.skipped.map((s) => s.id)).toEqual([String(a._id)]);
    // b still has no released version, so it fails for a real reason.
    expect(result.failed.map((f) => f.id)).toEqual([String(b._id)]);
    expect(result.failed[0]?.reason).toMatch(/release a version/i);
  });
});

/* ────────────────────────────────────────────── taxonomy */

describe("taxonomy", () => {
  it("re-derives facets on every referencing product when a slug moves", async () => {
    const category = await taxonomyService.createTaxonomy(
      { kind: "category", name: "CRM" },
      ACTOR,
    );
    const industry = await taxonomyService.createTaxonomy(
      { kind: "industry", name: "Property" },
      ACTOR,
    );

    const products = await Promise.all([draft("Atlas CRM"), draft("Tenancy")]);
    for (const product of products) {
      await catalog.saveClassification(
        String(product._id),
        {
          catalogue: "script" as const,
          categoryIds: [String(category._id)],
          industryIds: [String(industry._id)],
          technologyIds: [],
        },
        ACTOR,
      );
    }

    const before = await models.Product.find({ facets: "cat:crm" }).lean();
    expect(before).toHaveLength(2);

    const result = await taxonomyService.updateTaxonomy(
      String(category._id),
      { kind: "category", name: "CRM", slug: "crm-systems" },
      ACTOR,
    );

    expect(result.productsReindexed).toBe(2);
    expect(await models.Product.countDocuments({ facets: "cat:crm" })).toBe(0);
    expect(await models.Product.countDocuments({ facets: "cat:crm-systems" })).toBe(2);
    // The untouched dimension survives, and the array stays sorted and unique.
    const reindexed = await models.Product.findOne({ facets: "cat:crm-systems" }).lean();
    expect(reindexed?.facets).toEqual(["cat:crm-systems", "ind:property"]);
  });

  it("refuses to delete a taxonomy that products still reference", async () => {
    const category = await taxonomyService.createTaxonomy(
      { kind: "category", name: "CRM" },
      ACTOR,
    );
    const product = await draft();
    await catalog.saveClassification(
      String(product._id),
      {
        catalogue: "script" as const,
        categoryIds: [String(category._id)],
        industryIds: [],
        technologyIds: [],
      },
      ACTOR,
    );

    await expect(taxonomyService.deleteTaxonomy(String(category._id), ACTOR)).rejects.toThrow(
      /1 product/i,
    );
    expect(await models.Taxonomy.countDocuments({ _id: category._id })).toBe(1);

    // Unclassify, and the delete goes through — the guard is about references,
    // not a permanent veto.
    await catalog.saveClassification(
      String(product._id),
      { catalogue: "script" as const, categoryIds: [], industryIds: [], technologyIds: [] },
      ACTOR,
    );
    await expect(
      taxonomyService.deleteTaxonomy(String(category._id), ACTOR),
    ).resolves.toBeUndefined();
  });
});

/* ────────────────────────────────────────────── description */

describe("description", () => {
  it("stores the tree and its searchable twin together", async () => {
    const product = await catalog.createDraft(
      {
        name: "Atlas CRM",
        summary: "A CRM for property teams.",
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Tracks viewings and tenancies." }],
            },
          ],
        },
      },
      ACTOR,
    );

    const stored = await models.Product.findById(product._id).lean();
    // The tree survives as a tree — not stringified, not flattened.
    expect(stored?.description).toMatchObject({ type: "doc" });
    expect(stored?.descriptionText).toBe("Tracks viewings and tenancies.");

    // And it is what §74 search actually matches on.
    await models.Product.updateOne({ _id: product._id }, { $set: { status: "published" } });
    const hits = await models.Product.find({ $text: { $search: "tenancies" } }).lean();
    expect(hits.map((h) => String(h._id))).toContain(String(product._id));
  });

  it("clears both fields when the copy is deleted", async () => {
    const product = await draft();
    const id = String(product._id);
    await makeAlmostPublishable(id);
    expect((await models.Product.findById(id).lean())?.descriptionText).toBeTruthy();

    await catalog.saveSection(
      id,
      "basics",
      models.descriptionFields({ type: "doc", content: [] }),
      ACTOR,
    );

    const cleared = await models.Product.findById(id).lean();
    expect(cleared?.description).toBeUndefined();
    expect(cleared?.descriptionText).toBeUndefined();
    // Readiness agrees, rather than seeing a stale twin.
    expect((await catalog.readinessFor((await models.Product.findById(id))!)).gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "no_description" })]),
    );
  });
});

describe("clearing a field", () => {
  it("removes an optional value instead of leaving the old one live", async () => {
    const product = await draft();
    const id = String(product._id);
    await catalog.saveSection(id, "seo", { "seo.title": "Atlas CRM — property teams" }, ACTOR);
    expect((await models.Product.findById(id).lean())?.seo?.title).toBeTruthy();

    // Emptying the field in the form arrives as `undefined`, which `$set`
    // would silently ignore.
    await catalog.saveSection(id, "seo", { "seo.title": undefined }, ACTOR);
    expect((await models.Product.findById(id).lean())?.seo?.title).toBeUndefined();
  });
});

/* ────────────────────────────────────────────── audit */

describe("audit trail", () => {
  it("records creation, section saves and every transition", async () => {
    const product = await draft();
    const id = String(product._id);
    await catalog.saveSection(id, "basics", { summary: "Reworded." }, ACTOR);
    await walkTo(id, "testing");

    expect(await auditActions(id)).toEqual([
      "product.created",
      "product.section_updated",
      "product.status_changed",
      "product.status_changed",
    ]);
  });

  it("is append-only at the repository, not by convention", async () => {
    const product = await draft();
    const [row] = await auditModel.AuditLog.find({
      subjectId: new mongoose.Types.ObjectId(String(product._id)),
    }).lean();
    const { auditLogs } = await import("@/repositories/audit-log.repository");

    expect(row).toBeDefined();
    // The signatures take no arguments at all — the override makes the call
    // itself unwritable, not merely unsuccessful.
    await expect(auditLogs.updateById()).rejects.toThrow(/append-only/i);
    await expect(auditLogs.deleteById()).rejects.toThrow(/append-only/i);
  });

  it("keeps entered values out of the log — field names only", async () => {
    const product = await draft();
    const id = String(product._id);
    await catalog.saveSection(
      id,
      "pricing",
      { prices: [{ currency: "GBP", amount: 129_999 }] },
      ACTOR,
    );

    const rows = await auditModel.AuditLog.find({
      subjectId: new mongoose.Types.ObjectId(id),
      action: "product.section_updated",
    }).lean();
    expect(JSON.stringify(rows)).not.toContain("129999");
    expect(rows[0]?.after).toMatchObject({ section: "pricing", fields: ["prices"] });
  });
});

/**
 * The catalogue predicate, against a real index and a real missing field.
 *
 * Earned as an integration test for one reason a unit test cannot reach: whether
 * `{ $in: ["script", null] }` actually matches a document where `catalogue` is
 * **absent**. That is MongoDB matcher semantics, not our code, and the whole
 * backfill window depends on it — get it wrong and `/marketplace` empties for
 * every un-backfilled product, silently.
 *
 * The absent-field row is inserted through the driver, deliberately bypassing
 * Mongoose so its schema default cannot fill the field in and make the test pass
 * for the wrong reason.
 */
describe("the catalogue predicate against real documents", () => {
  async function seedThree() {
    const base = {
      summary: "A thing.",
      status: "published",
      deletedAt: null,
      facets: ["cat:crm"],
      prices: [{ currency: "GBP", amount: 1000 }],
      licencePackages: [],
      media: [],
      testingChecklist: [],
      categoryIds: [],
      industryIds: [],
      technologyIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await mongoose.connection.collection("products").insertMany([
      { ...base, name: "A script", slug: "a-script", catalogue: "script" },
      { ...base, name: "A template", slug: "a-template", catalogue: "template" },
      // No `catalogue` at all — a document written before the field existed.
      { ...base, name: "A legacy row", slug: "a-legacy-row" },
    ] as never);
  }

  const slugsFor = async (catalogue: "script" | "template" | "all") => {
    const rows = await mongoose.connection
      .collection("products")
      .aggregate(
        marketplace.buildMarketplacePipeline({
          sort: "latest",
          page: 1,
          limit: 10,
          currency: "GBP",
          catalogue,
        }) as never,
      )
      .toArray();
    return ((rows[0]?.rows ?? []) as Array<{ slug: string }>).map((row) => row.slug).sort();
  };

  it("counts a document with no catalogue as a script", async () => {
    await seedThree();
    // The one assertion the backfill window rests on.
    expect(await slugsFor("script")).toEqual(["a-legacy-row", "a-script"]);
  });

  it("returns only templates for the template surface", async () => {
    await seedThree();
    expect(await slugsFor("template")).toEqual(["a-template"]);
  });

  it("returns everything for both", async () => {
    await seedThree();
    expect(await slugsFor("all")).toEqual(["a-legacy-row", "a-script", "a-template"]);
  });
});

/**
 * One website template per full script — the **partial unique index**.
 *
 * Earned as an integration test for one reason a unit test cannot reach:
 * `partialFilterExpression` behaviour is the engine's, not ours. The second case is
 * the entire justification for the index being *partial* rather than `sparse` —
 * `sparse` cannot express `deletedAt: null`, so a deleted template would collide
 * with its own tombstone forever and the vendor could never make another.
 *
 * Appended here rather than in a new file: this one already pays the preamble and
 * already calls `syncIndexes()`, without which the index does not exist and both
 * assertions would pass for the wrong reason.
 */
describe("linked template listings", () => {
  const PRICES = [{ currency: "GBP", amount: 7_900 }];

  it("creates the template as a draft, priced, with a deterministic slug", async () => {
    const script = await draft("Atlas CRM");

    const template = await siblings.createTemplateSibling(
      String(script._id),
      { prices: PRICES },
      ACTOR,
    );

    // Deterministic — not `uniqueSlug`'s random four-character fallback, which is
    // what two products sharing a name would otherwise produce.
    expect(template.slug).toBe("atlas-crm-template");
    expect(template.catalogue).toBe("template");
    expect(template.status).toBe("draft");
    expect(String(template.scriptListingId)).toBe(String(script._id));

    // The entered price lands on both lists, which is what makes
    // `unbuyable_currency` structurally impossible on the new listing.
    expect(template.prices).toEqual(PRICES);

    // And nothing that would be false on a front-end came across.
    expect(template.description).toBeUndefined();
    expect(template.features ?? []).toHaveLength(0);
    expect(template.media ?? []).toHaveLength(0);
  });

  it("refuses a second template for one script, in words", async () => {
    const script = await draft("Atlas CRM");
    await siblings.createTemplateSibling(String(script._id), { prices: PRICES }, ACTOR);

    await expect(
      siblings.createTemplateSibling(String(script._id), { prices: PRICES }, ACTOR),
    ).rejects.toThrow(/already has a website template listing/);
  });

  it("lets a deleted template be replaced — the reason the index is partial", async () => {
    const script = await draft("Atlas CRM");
    const first = await siblings.createTemplateSibling(
      String(script._id),
      { prices: PRICES },
      ACTOR,
    );

    await catalog.softDelete(String(first._id), ACTOR);

    // `sparse` could not have expressed this: the tombstone would still hold the
    // slot and the vendor could never create another.
    const second = await siblings.createTemplateSibling(
      String(script._id),
      { prices: PRICES },
      ACTOR,
    );
    expect(String(second._id)).not.toBe(String(first._id));
  });

  it("refuses to delete a script a template points at", async () => {
    const script = await draft("Atlas CRM");
    await siblings.createTemplateSibling(String(script._id), { prices: PRICES }, ACTOR);

    // `restrict`, not `cascade` — deleting one saleable listing because somebody
    // deleted the other is not a decision `softDelete` gets to make.
    await expect(catalog.softDelete(String(script._id), ACTOR)).rejects.toThrow(
      /template listing is linked/,
    );
  });

  it("unlinks, and then the script can be deleted", async () => {
    const script = await draft("Atlas CRM");
    const template = await siblings.createTemplateSibling(
      String(script._id),
      { prices: PRICES },
      ACTOR,
    );

    await siblings.unlinkTemplateSibling(String(template._id), ACTOR);
    await expect(catalog.softDelete(String(script._id), ACTOR)).resolves.toBeUndefined();
  });

  it("refuses to move a linked template out of the template catalogue", async () => {
    const script = await draft("Atlas CRM");
    const template = await siblings.createTemplateSibling(
      String(script._id),
      { prices: PRICES },
      ACTOR,
    );

    // A refusal rather than a silent `$unset`: clearing the link because somebody
    // changed a dropdown is invisible data loss.
    await expect(
      catalog.saveClassification(
        String(template._id),
        { catalogue: "script", categoryIds: [], industryIds: [], technologyIds: [] },
        ACTOR,
      ),
    ).rejects.toThrow(/Unlink it before moving it/);
  });
});
