import type { Types } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import type { EntitlementDoc } from "@/lib/db/models/commerce";
import { VALID_ENV } from "@/test/env";
import { checkCharacter } from "@/lib/licence-key";

/**
 * A fixed key that actually passes validation.
 *
 * Hard-coding one and hoping does not work: `activateLicence` rejects a bad
 * check character as `invalid_format` before it ever reaches the database, so a
 * made-up key makes every activation test fail for the wrong reason. Computed
 * from the body, so it follows the checksum if the checksum changes.
 */
// No `I`, `O`, `0` or `1` — they are not in the alphabet, and `checkCharacter`
// returns "" for an unknown character rather than skipping it, which produces a
// 19-character key that fails validation for a reason nothing prints.
const TEST_KEY_BODY = "TESTLCENCE23456";
const TEST_KEY = `INVX-${[0, 4, 8, 12]
  .map((at) => (TEST_KEY_BODY + checkCharacter(TEST_KEY_BODY)).slice(at, at + 4))
  .join("-")}`;

/**
 * Org scoping, against a real database — tickets 14 and 15.
 *
 * `rules.test.ts` covers the download decision as pure logic, which is where
 * that belongs. What it cannot cover is the property the whole feature rests
 * on: **an entitlement is proof of purchase, and one organisation must never
 * see another's.** That failure needs two organisations and real queries, and
 * it is silent — a leak returns a 200 with somebody else's software on it.
 *
 * So every read here is run twice: once by the organisation that owns the
 * thing, and once by one that does not.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./entitlement-service");
let activation: typeof import("./activation-service");
let commerce: typeof import("@/lib/db/models/commerce");
let catalog: typeof import("@/lib/db/models/catalog");
let errors: typeof import("@/lib/errors");

const OWNER = "6a80c46f6c887b38e2f0e0b4";
const STRANGER = "6a80c46f6c887b38e2f0e0c9";

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "entitlements_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./entitlement-service");
  activation = await import("./activation-service");
  commerce = await import("@/lib/db/models/commerce");
  catalog = await import("@/lib/db/models/catalog");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    commerce.Entitlement.syncIndexes(),
    commerce.Licence.syncIndexes(),
    catalog.Product.syncIndexes(),
    catalog.ProductVersion.syncIndexes(),
    catalog.ProductFile.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await Promise.all([
    commerce.Entitlement.deleteMany({}),
    commerce.Licence.deleteMany({}),
    catalog.Product.deleteMany({}),
    catalog.ProductVersion.deleteMany({}),
    catalog.ProductFile.deleteMany({}),
    mongoose.connection.collection("downloads").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

const OID = () => new mongoose.Types.ObjectId();
const oid = (value: string) => new mongoose.Types.ObjectId(value);

const YEAR = 365 * 864e5;

/** A published product with one released version and one downloadable file. */
async function published(slug: string, releasedAt = new Date(Date.now() - YEAR)) {
  const product = await catalog.Product.create({
    slug,
    name: slug,
    summary: `${slug} summary`,
    status: "published",
    prices: [{ currency: "GBP", amount: 29_999 }],
  });

  const version = await catalog.ProductVersion.create({
    productId: product._id,
    version: "1.0.0",
    status: "released",
    releasedAt,
  });

  const file = await catalog.ProductFile.create({
    productId: product._id,
    versionId: version._id,
    kind: "application_package",
    filename: `${slug}-1.0.0.zip`,
    storageKey: `innovatrix/test/products/${product._id}/versions/${version._id}/a.zip`,
    sizeBytes: 1024,
    contentType: "application/zip",
  });

  return { product, version, file };
}

/**
 * `overrides` is spelled out rather than a `Record<string, unknown>` spread:
 * spreading an index signature into `Model.create()` collapses the overload to
 * `never`, and the resulting errors point at the call site rather than here.
 */
async function entitle(
  organizationId: string,
  productId: Types.ObjectId,
  versionId: Types.ObjectId,
  overrides: {
    status?: EntitlementDoc["status"];
    updatesUntil?: Date;
    supportUntil?: Date;
  } = {},
): Promise<EntitlementDoc> {
  const created = await commerce.Entitlement.create({
    organizationId: oid(organizationId),
    productId,
    orderId: OID(),
    orderLineId: `line-${String(productId).slice(-6)}`,
    status: overrides.status ?? "active",
    purchasedVersionId: versionId,
    updatesUntil: overrides.updatesUntil ?? new Date(Date.now() + YEAR),
    supportUntil: overrides.supportUntil ?? new Date(Date.now() + YEAR),
  });

  return created.toObject() as EntitlementDoc;
}

/* ────────────────────────────────────────────── tests */

describe("My Scripts is scoped to the active organisation — §29", () => {
  it("lists only the caller's own entitlements", async () => {
    const mine = await published("mine");
    const theirs = await published("theirs");

    await entitle(OWNER, mine.product._id, mine.version._id);
    await entitle(STRANGER, theirs.product._id, theirs.version._id);

    const owned = await service.listOwnedSoftware(OWNER);
    expect(owned.map((view) => view.product.slug)).toEqual(["mine"]);

    // And the reverse, because a filter that happens to be right in one
    // direction can still be wrong in the other.
    const other = await service.listOwnedSoftware(STRANGER);
    expect(other.map((view) => view.product.slug)).toEqual(["theirs"]);
  });

  it("returns nothing rather than everything for an organisation with no purchases", async () => {
    // The dangerous bug is an empty filter reading as "no constraint". A brand
    // new organisation seeing the entire entitlements collection would be
    // indistinguishable from an empty state in the UI right up until it wasn't.
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id);

    expect(await service.listOwnedSoftware(STRANGER)).toEqual([]);
  });

  it("refuses to fetch another organisation's entitlement by id", async () => {
    const mine = await published("mine");
    const entitlement = await entitle(OWNER, mine.product._id, mine.version._id);

    expect(await service.getOwnedSoftware(String(entitlement._id), OWNER)).not.toBeNull();
    // Null, not a redacted view: the page turns this into a 404, so a stranger
    // cannot even learn the id was real.
    expect(await service.getOwnedSoftware(String(entitlement._id), STRANGER)).toBeNull();
  });
});

describe("download authorisation — §66", () => {
  it("allows the owner and refuses everyone else with the same message", async () => {
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id);

    const authorised = await service.authoriseDownload(String(mine.file._id), OWNER);
    expect(String(authorised.file._id)).toBe(String(mine.file._id));

    await expect(
      service.authoriseDownload(String(mine.file._id), STRANGER),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("gives the same answer for a file that does not exist as for one you don't own", async () => {
    // Otherwise the endpoint is an existence oracle: probe ids until the error
    // changes shape and you have enumerated the catalogue's private files.
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id);

    const notYours = await service
      .authoriseDownload(String(mine.file._id), STRANGER)
      .catch((error: Error) => error);
    const notReal = await service
      .authoriseDownload(String(OID()), STRANGER)
      .catch((error: Error) => error);

    expect(notYours).toBeInstanceOf(errors.ForbiddenError);
    expect(notReal).toBeInstanceOf(errors.ForbiddenError);
    expect((notYours as Error).message).toBe((notReal as Error).message);
  });

  it("keeps the purchased version downloadable after the update window closes", async () => {
    // §45, through the whole stack rather than the pure rule: an expired window
    // must not repossess what somebody bought.
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id, {
      updatesUntil: new Date(Date.now() - YEAR),
    });

    await expect(service.authoriseDownload(String(mine.file._id), OWNER)).resolves.toBeTruthy();
  });

  it("refuses a newer version released after the window", async () => {
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id, {
      updatesUntil: new Date(Date.now() - 30 * 864e5),
    });

    const newer = await catalog.ProductVersion.create({
      productId: mine.product._id,
      version: "2.0.0",
      status: "released",
      releasedAt: new Date(),
    });
    const newerFile = await catalog.ProductFile.create({
      productId: mine.product._id,
      versionId: newer._id,
      kind: "application_package",
      filename: "mine-2.0.0.zip",
      storageKey: `innovatrix/test/products/${mine.product._id}/versions/${newer._id}/b.zip`,
      sizeBytes: 2048,
      contentType: "application/zip",
    });

    await expect(
      service.authoriseDownload(String(newerFile._id), OWNER),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("refuses a suspended entitlement, including its purchased version", async () => {
    const mine = await published("mine");
    await entitle(OWNER, mine.product._id, mine.version._id, { status: "suspended" });

    await expect(
      service.authoriseDownload(String(mine.file._id), OWNER),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });
});

describe("licence reads are scoped by organisation, activation is scoped by key — §65", () => {
  async function licensed(organizationId: string, activationLimit = 1) {
    const product = await published(`p-${organizationId.slice(-4)}`);
    const entitlement = await entitle(organizationId, product.product._id, product.version._id);
    const licence = await commerce.Licence.create({
      key: TEST_KEY,
      entitlementId: entitlement._id,
      organizationId: oid(organizationId),
      productId: product.product._id,
      type: "single_installation",
      activationLimit,
      activations: [],
      status: "active",
      supportExpiresAt: new Date(Date.now() + YEAR),
    });
    return { entitlement, licence };
  }

  it("will not hand a licence key to another organisation", async () => {
    const { entitlement } = await licensed(OWNER);

    expect(
      await activation.licenceForEntitlement(String(entitlement._id), OWNER),
    ).not.toBeNull();
    expect(
      await activation.licenceForEntitlement(String(entitlement._id), STRANGER),
    ).toBeNull();
  });

  it("masks the key in the list view and never sends the whole one", async () => {
    // The list is a page of tiles; the full key belongs only on the licence page
    // the customer navigated to on purpose.
    await licensed(OWNER);

    const [view] = await service.listOwnedSoftware(OWNER);
    expect(view!.licence!.maskedKey).toBe(`INVX-••••-••••-••••-${TEST_KEY.slice(-4)}`);
    expect(JSON.stringify(view)).not.toContain(TEST_KEY);
  });

  it("enforces the activation limit at the database, under a race", async () => {
    await licensed(OWNER, 1);

    // Both at once against one seat. The limit is an `$expr` inside the update
    // filter, so the winner is decided by the database rather than by whichever
    // request read the count first.
    const [a, b] = await Promise.all([
      activation.activateLicence({ key: TEST_KEY, instanceId: "a" }),
      activation.activateLicence({ key: TEST_KEY, instanceId: "b" }),
    ]);

    expect([a.valid, b.valid].filter(Boolean)).toHaveLength(1);

    const licence = await commerce.Licence.findOne({}).lean();
    expect(licence!.activations.filter((entry) => !entry.releasedAt)).toHaveLength(1);
  });

  it("is idempotent for the same instance and frees the slot on release", async () => {
    await licensed(OWNER, 1);
    const key = TEST_KEY;

    expect((await activation.activateLicence({ key, instanceId: "a" })).valid).toBe(true);
    expect((await activation.activateLicence({ key, instanceId: "a" })).valid).toBe(true);
    // Still one seat used — re-activating an instance is a reinstall, not a
    // second installation.
    expect((await activation.activateLicence({ key, instanceId: "b" })).valid).toBe(false);

    await activation.deactivateLicence({ key, instanceId: "a" });
    expect((await activation.activateLicence({ key, instanceId: "b" })).valid).toBe(true);

    // Released, not deleted: where software has been installed is the record.
    const licence = await commerce.Licence.findOne({}).lean();
    expect(licence!.activations).toHaveLength(2);
    expect(licence!.activations.filter((entry) => entry.releasedAt)).toHaveLength(1);
  });
});
