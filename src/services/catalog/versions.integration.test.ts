import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Ticket 07's guarantees, against a real MongoDB.
 *
 * Three of these can only be checked here:
 *
 * - **"Demo passwords are ciphertext in MongoDB — verified by reading the raw
 *   document."** Asserted by walking the *whole stored document* for the
 *   plaintext, not by inspecting the field we happen to expect it in. A
 *   plaintext that leaked into a second field would pass the narrow check.
 * - **A released version's artefacts cannot be swapped.** The rule is enforced
 *   in three places; a test that goes through the service exercises the one
 *   that actually runs.
 * - **The current-version pointer only moves forward.** Its failure mode is a
 *   wrong pointer, not an error, so nothing else would notice.
 */

let mongoose: typeof import("mongoose").default;
let catalog: typeof import("./product-service");
let versionService: typeof import("./version-service");
let demoService: typeof import("./demo-service");
let testingService: typeof import("./testing-service");
let models: typeof import("@/lib/db/models/catalog");

const ACTOR = { type: "staff", userId: "6a80c46f6c887b38e2f0e001", name: "Test" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "versions_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  catalog = await import("./product-service");
  versionService = await import("./version-service");
  demoService = await import("./demo-service");
  testingService = await import("./testing-service");
  models = await import("@/lib/db/models/catalog");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([models.Product.syncIndexes(), models.ProductVersion.syncIndexes()]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await Promise.all([
    models.Product.deleteMany({}),
    models.ProductVersion.deleteMany({}),
    models.ProductFile.deleteMany({}),
    // Audit rows too. Without this, "writes no audit row when nothing changed"
    // counts rows left by the test before it and fails for the wrong reason.
    mongoose.connection.collection("auditLogs").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── helpers */

async function product(name = "Atlas CRM") {
  const doc = await catalog.createDraft({ name, summary: "A CRM." }, ACTOR);
  return String(doc._id);
}

/** A version with a package on it, so it can actually be released. */
async function releasableVersion(productId: string, version: string) {
  const created = await versionService.createVersion({ productId, version }, ACTOR);
  await models.ProductFile.create({
    productId: new mongoose.Types.ObjectId(productId),
    versionId: created._id,
    kind: "application_package",
    filename: `atlas-${version}.zip`,
    storageKey: `innovatrix/test/products/${productId}/versions/${String(created._id)}/x.zip`,
    sizeBytes: 2048,
    contentType: "application/zip",
    scanStatus: "clean",
  });
  return String(created._id);
}

/* ────────────────────────────────────────────── versions */

describe("releasing", () => {
  it("refuses a version with nothing to download", async () => {
    const productId = await product();
    const version = await versionService.createVersion({ productId, version: "1.0.0" }, ACTOR);

    // The failure this prevents looks like success: the page says 1.0.0 is
    // available, the customer pays, and there is no artefact.
    await expect(versionService.releaseVersion(String(version._id), ACTOR)).rejects.toThrow(
      /no application package/i,
    );
  });

  it("sets releasedAt once and points the product at it", async () => {
    const productId = await product();
    const versionId = await releasableVersion(productId, "1.0.0");

    const released = await versionService.releaseVersion(versionId, ACTOR);
    expect(released.releasedAt).toBeInstanceOf(Date);

    const owner = await models.Product.findById(productId).lean();
    expect(String(owner?.currentVersionId)).toBe(versionId);
  });

  it("only moves the current-version pointer forward", async () => {
    const productId = await product();
    const twoZero = await releasableVersion(productId, "2.0.0");
    await versionService.releaseVersion(twoZero, ACTOR);

    // A backported patch on the old major, released afterwards. It is a real
    // release — it is not the current version.
    const backport = await releasableVersion(productId, "1.9.1");
    await versionService.releaseVersion(backport, ACTOR);

    const owner = await models.Product.findById(productId).lean();
    expect(String(owner?.currentVersionId)).toBe(twoZero);
  });

  it("lets exactly one of two simultaneous releases win", async () => {
    const productId = await product();
    const versionId = await releasableVersion(productId, "1.0.0");

    const results = await Promise.allSettled([
      versionService.releaseVersion(versionId, ACTOR),
      versionService.releaseVersion(versionId, ACTOR),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("falls back to the next newest release when the current one is deprecated", async () => {
    const productId = await product();
    const oneZero = await releasableVersion(productId, "1.0.0");
    await versionService.releaseVersion(oneZero, ACTOR);
    const oneOne = await releasableVersion(productId, "1.1.0");
    await versionService.releaseVersion(oneOne, ACTOR);

    await versionService.deprecateVersion(oneOne, ACTOR);

    // Not left pointing at a version we have just told people not to use.
    const owner = await models.Product.findById(productId).lean();
    expect(String(owner?.currentVersionId)).toBe(oneZero);
  });
});

describe("immutability after release — §45", () => {
  it("refuses to change anything that alters what a customer gets", async () => {
    const productId = await product();
    const versionId = await releasableVersion(productId, "1.0.0");
    await versionService.releaseVersion(versionId, ACTOR);

    await expect(
      versionService.updateVersion(
        versionId,
        { minimumRequirements: "Now needs PHP 9" },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      fieldErrors: { minimumRequirements: expect.any(Array) },
    });
  });

  it("still allows the notes to be corrected", async () => {
    const productId = await product();
    const versionId = await releasableVersion(productId, "1.0.0");
    await versionService.releaseVersion(versionId, ACTOR);

    const updated = await versionService.updateVersion(
      versionId,
      { changelog: "Also fixes the CSV export." },
      ACTOR,
    );
    expect(updated.changelog).toBe("Also fixes the CSV export.");
  });

  it("refuses to delete a released version", async () => {
    const productId = await product();
    const versionId = await releasableVersion(productId, "1.0.0");
    await versionService.releaseVersion(versionId, ACTOR);

    await expect(versionService.deleteVersion(versionId, ACTOR)).rejects.toThrow(
      /released and cannot be deleted/i,
    );
  });

  it("rejects a duplicate version number", async () => {
    const productId = await product();
    await versionService.createVersion({ productId, version: "1.0.0" }, ACTOR);

    await expect(
      versionService.createVersion({ productId, version: "1.0.0" }, ACTOR),
    ).rejects.toThrow(/already exists/i);
  });

  it("shows customers only released versions", async () => {
    const productId = await product();
    await versionService.createVersion({ productId, version: "2.0.0-rc.1" }, ACTOR);
    const shipped = await releasableVersion(productId, "1.0.0");
    await versionService.releaseVersion(shipped, ACTOR);

    const visible = await versionService.listCustomerVersions(productId);
    expect(visible.map((v) => v.version)).toEqual(["1.0.0"]);
  });
});

/* ────────────────────────────────────────────── demo credentials */

describe("demo credentials — §9, §89", () => {
  const PLAINTEXT = "correct-horse-battery-staple";

  it("stores the password as ciphertext, nowhere in the document as text", async () => {
    const productId = await product();

    await demoService.saveDemo(
      productId,
      {
        exposure: "owners_only",
        credentials: [
          { role: "Administrator", username: "admin@demo.test", password: PLAINTEXT },
        ],
      },
      ACTOR,
    );

    // The raw document, straight from the driver — not through Mongoose casting
    // and not through any view.
    const raw = await mongoose.connection
      .collection("products")
      .findOne({ _id: new mongoose.Types.ObjectId(productId) });

    // Walk the whole thing. A plaintext that leaked into some *other* field
    // would pass a check that only looked at `passwordCipher`.
    expect(JSON.stringify(raw)).not.toContain(PLAINTEXT);

    const cipher = raw?.demo?.credentials?.[0]?.passwordCipher;
    expect(cipher).toMatchObject({
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
      keyVersion: expect.any(Number),
    });
    expect(cipher.ciphertext).not.toContain(PLAINTEXT);
  });

  it("decrypts for a viewer who qualifies, and returns null for one who does not", async () => {
    const productId = await product();
    await demoService.saveDemo(
      productId,
      {
        exposure: "owners_only",
        credentials: [{ role: "Administrator", password: PLAINTEXT }],
      },
      ACTOR,
    );

    const owner = await demoService.revealCredentials(productId, {
      isAuthenticated: true,
      ownsProduct: true,
      isStaff: false,
    });
    expect(owner?.credentials[0]?.password).toBe(PLAINTEXT);

    const stranger = await demoService.revealCredentials(productId, {
      isAuthenticated: true,
      ownsProduct: false,
      isStaff: false,
    });
    expect(stranger).toBeNull();
  });

  it("keeps the stored password when the field is left blank on re-edit", async () => {
    const productId = await product();
    await demoService.saveDemo(
      productId,
      {
        exposure: "authenticated",
        credentials: [
          { role: "Administrator", password: PLAINTEXT },
          { role: "Viewer", password: "viewer-pass" },
        ],
      },
      ACTOR,
    );

    // Correcting one row's label, with both password fields empty — which is
    // what the form always submits, because it never pre-fills them.
    await demoService.saveDemo(
      productId,
      {
        exposure: "authenticated",
        credentials: [{ role: "Administrator", label: "Full access" }, { role: "Viewer" }],
      },
      ACTOR,
    );

    const after = await demoService.revealCredentials(productId, {
      isAuthenticated: false,
      ownsProduct: false,
      isStaff: true,
    });
    // The bug this prevents wipes every password on an unrelated edit, silently.
    expect(after?.credentials.map((c) => c.password)).toEqual([PLAINTEXT, "viewer-pass"]);
    expect(after?.credentials[0]?.label).toBe("Full access");
  });

  it("replaces the password when one is actually typed", async () => {
    const productId = await product();
    await demoService.saveDemo(
      productId,
      { exposure: "public", credentials: [{ role: "Admin", password: PLAINTEXT }] },
      ACTOR,
    );
    await demoService.saveDemo(
      productId,
      { exposure: "public", credentials: [{ role: "Admin", password: "new-one" }] },
      ACTOR,
    );

    const after = await demoService.revealCredentials(productId, {
      isAuthenticated: false,
      ownsProduct: false,
      isStaff: true,
    });
    expect(after?.credentials[0]?.password).toBe("new-one");
  });

  it("cannot open a ciphertext copied from another product", async () => {
    const first = await product("Atlas CRM");
    const second = await product("Tenancy");

    await demoService.saveDemo(
      first,
      { exposure: "public", credentials: [{ role: "Admin", password: PLAINTEXT }] },
      ACTOR,
    );

    const stolen = (await models.Product.findById(first).lean())?.demo?.credentials?.[0];
    await models.Product.updateOne(
      { _id: second },
      { $set: { "demo.credentials": [stolen], "demo.exposure": "public" } },
    );

    // AAD is the product id, so the copy does not decrypt into the other page.
    // Reported as a missing password rather than a 500 — see `openPassword`.
    const reveal = await demoService.revealCredentials(second, {
      isAuthenticated: false,
      ownsProduct: false,
      isStaff: true,
    });
    expect(reveal?.credentials[0]?.password).toBeUndefined();
  });

  it("keeps entered credentials out of the audit log", async () => {
    const productId = await product();
    await demoService.saveDemo(
      productId,
      {
        exposure: "public",
        credentials: [{ role: "Admin", username: "admin@demo.test", password: PLAINTEXT }],
      },
      ACTOR,
    );

    const rows = await mongoose.connection
      .collection("auditLogs")
      .find({ action: "product.demo_updated" })
      .toArray();

    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(PLAINTEXT);
    expect(serialised).not.toContain("admin@demo.test");
    expect(serialised).not.toContain("ciphertext");
    // What it *does* record: enough to answer "who changed what, when".
    expect(rows[0]?.after).toMatchObject({
      exposure: "public",
      roles: ["Admin"],
      rotated: 1,
    });
  });
});

/* ────────────────────────────────────────────── testing checklist */

describe("testing checklist — §47", () => {
  it("stamps who checked an item and when, and leaves untouched rows alone", async () => {
    const productId = await product();
    const doc = await models.Product.findById(productId);

    const items = testingService.checklistFor(doc!).map((entry) => ({
      item: entry.item,
      status: entry.status,
    }));

    await testingService.saveChecklist(
      productId,
      items.map((entry, index) =>
        index === 0 ? { ...entry, status: "pass" as const } : entry,
      ),
      ACTOR,
    );

    const first = await models.Product.findById(productId).lean();
    const stampedAt = first?.testingChecklist?.[0]?.checkedAt;
    expect(stampedAt).toBeInstanceOf(Date);
    expect(String(first?.testingChecklist?.[0]?.checkedByUserId)).toBe(ACTOR.userId);
    expect(first?.testingChecklist?.[1]?.checkedAt).toBeUndefined();

    // Re-saving with a change to item 2 must not relabel item 1 as checked
    // today by whoever opened the page.
    await testingService.saveChecklist(
      productId,
      items.map((entry, index) =>
        index === 0
          ? { ...entry, status: "pass" as const }
          : index === 1
            ? { ...entry, status: "fail" as const }
            : entry,
      ),
      ACTOR,
    );

    const second = await models.Product.findById(productId).lean();
    expect(second?.testingChecklist?.[0]?.checkedAt).toEqual(stampedAt);
    expect(second?.testingChecklist?.[1]?.status).toBe("fail");
  });

  it("adds §47 items introduced after the product was created", async () => {
    const productId = await product();
    await models.Product.updateOne(
      { _id: productId },
      { $set: { testingChecklist: [{ item: "Installation", status: "pass" }] } },
    );

    const doc = await models.Product.findById(productId);
    const merged = testingService.checklistFor(doc!);

    // Otherwise a product drafted before an item existed would never be asked
    // about it, and would pass the gate without it.
    expect(merged.map((entry) => entry.item)).toContain("Security review");
    expect(merged.find((entry) => entry.item === "Installation")?.status).toBe("pass");
  });

  it("writes no audit row when nothing changed", async () => {
    const productId = await product();
    const doc = await models.Product.findById(productId);
    const items = testingService
      .checklistFor(doc!)
      .map((entry) => ({ item: entry.item, status: entry.status }));

    await testingService.saveChecklist(productId, items, ACTOR);

    const rows = await mongoose.connection.collection("auditLogs").countDocuments({
      action: "product.testing_updated",
      subjectId: new mongoose.Types.ObjectId(productId),
    });
    expect(rows).toBe(0);
  });
});
