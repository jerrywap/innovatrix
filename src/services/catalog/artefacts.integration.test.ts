import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Delivery methods — vendor ticket 06.
 *
 * The network half lives in `npm run vendors:probe` and the address filter is a unit
 * test. What needs a database is the part that decides whether a customer can be offered
 * a download:
 *
 *  1. **A version cannot reach `released` while its artefact is not stored.** This is the
 *     criterion that stops `ProductVersionReleased` telling entitled customers a
 *     download is ready before the bytes have arrived.
 *  2. **Ownership derives through the product**, for versions and files, and answers 404.
 *  3. **The token is sealed and never readable from an ordinary query.**
 *
 * ## These touch DNS
 *
 * `saveArtefactSource` validates the URL with the same `assertFetchable` the job uses,
 * and that resolves the host — so the fixtures use `example.com`, which is IANA-reserved
 * and resolves to a public address. `example.test` does *not* resolve, which is correct
 * behaviour from the filter and made three of these fail until the fixture changed.
 */

let mongoose: typeof import("mongoose").default;
let versionService: typeof import("./version-service");
let artefactService: typeof import("./artefact-service");
let ownership: typeof import("./ownership");
let catalog: typeof import("@/lib/db/models/catalog");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");

const VENDOR = "7c00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "7c00c46f6c887b38e2f0e0a2";
const USER = "7c00c46f6c887b38e2f0e0b1";
const PRODUCT = "7c00c46f6c887b38e2f0e0c1";
const FIRST_PARTY = "7c00c46f6c887b38e2f0e0c2";
const VERSION = "7c00c46f6c887b38e2f0e0d1";

const ACTOR = { type: "vendor", userId: USER, vendorId: VENDOR, name: "Ada" } as const;
const SCOPE = { vendorId: VENDOR };

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "artefacts_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  versionService = await import("./version-service");
  artefactService = await import("./artefact-service");
  ownership = await import("./ownership");
  catalog = await import("@/lib/db/models/catalog");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await catalog.Product.syncIndexes();
  await catalog.ProductVersion.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await catalog.Product.deleteMany({});
  await catalog.ProductVersion.deleteMany({});
  await catalog.ProductFile.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
});

async function seed() {
  await catalog.Product.create([
    {
      _id: PRODUCT,
      name: "Northwind Dispatch",
      slug: "northwind-dispatch",
      summary: "Dispatch tooling.",
      status: "draft",
      vendorId: VENDOR,
      vendorSlug: "northwind-labs",
      vendorName: "Northwind Labs",
      deliveryMethod: "vendor_hosted",
    },
    // No vendor — the control. Absence must not read as "mine".
    { _id: FIRST_PARTY, name: "Atlas", slug: "atlas", summary: "Ours.", status: "published" },
  ]);

  await catalog.ProductVersion.create({
    _id: VERSION,
    productId: PRODUCT,
    version: "1.0.0",
    status: "draft",
  });

  await catalog.ProductFile.create({
    productId: PRODUCT,
    versionId: VERSION,
    kind: "application_package",
    storageKey: "innovatrix/test/products/x/versions/y/pkg.zip",
    filename: "pkg.zip",
    contentType: "application/zip",
    sizeBytes: 1024,
    scanStatus: "pending",
  });
}

/* ────────────────────────────────────────────── the release gate */

describe("a version cannot be released while its artefact is not here", () => {
  it.each(["pending", "fetching"] as const)("refuses while the fetch is %s", async (status) => {
    await seed();
    await catalog.ProductVersion.updateOne(
      { _id: VERSION },
      { $set: { artefactSource: { status, url: "https://example.com/p.zip" } } },
    );

    // The package file exists, so this is specifically the source check firing — without
    // it, `ProductVersionReleased` would tell entitled customers a download is ready.
    await expect(versionService.releaseVersion(VERSION, ACTOR, SCOPE)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );

    expect((await catalog.ProductVersion.findById(VERSION).lean())!.status).toBe("draft");
  });

  it("refuses after a failure, and repeats the reason the vendor needs", async () => {
    await seed();
    await catalog.ProductVersion.updateOne(
      { _id: VERSION },
      {
        $set: {
          artefactSource: {
            status: "failed",
            url: "https://example.com/p.zip",
            failureReason: "checksum did not match",
          },
        },
      },
    );

    await expect(versionService.releaseVersion(VERSION, ACTOR, SCOPE)).rejects.toThrow(
      /checksum did not match/,
    );
  });

  it("allows the release once the artefact is stored", async () => {
    await seed();
    await catalog.ProductVersion.updateOne(
      { _id: VERSION },
      { $set: { artefactSource: { status: "stored", url: "https://example.com/p.zip" } } },
    );

    const released = await versionService.releaseVersion(VERSION, ACTOR, SCOPE);
    expect(released.status).toBe("released");
    expect(released.releasedAt).toBeInstanceOf(Date);
  });

  it("leaves an archive-method version alone — it has no source to wait for", async () => {
    await seed();
    // The fixture product is `vendor_hosted`, so the method has to be set for this to be
    // the case it names. It said "archive" and tested the other method for a while.
    await catalog.Product.updateOne({ _id: PRODUCT }, { $set: { deliveryMethod: "archive" } });

    // No `artefactSource` at all, which is what a direct upload looks like.
    const released = await versionService.releaseVersion(VERSION, ACTOR, SCOPE);
    expect(released.status).toBe("released");
  });

  /*
   * The reported defect: a vendor tried the repository method, the fetch 404'd, they
   * switched back to `archive` and uploaded a package — and release refused for ever,
   * quoting a URL that is no longer part of how this product is delivered. Worse, they
   * could not clear it: `DeliverySource` renders only for the two remote methods, so under
   * `archive` the failed source is not on the screen at all.
   */
  it("ignores a failed source left over from a method the product no longer uses", async () => {
    await seed();
    await catalog.Product.updateOne({ _id: PRODUCT }, { $set: { deliveryMethod: "archive" } });
    await catalog.ProductVersion.updateOne(
      { _id: VERSION },
      {
        $set: {
          artefactSource: {
            status: "failed",
            repositoryUrl: "https://github.com/someone/abandoned",
            tag: "abc",
            failureReason: "That URL answered 404.",
          },
        },
      },
    );

    const released = await versionService.releaseVersion(VERSION, ACTOR, SCOPE);
    expect(released.status).toBe("released");
  });

  it("refuses a remote-method version with no source, naming what is missing", async () => {
    await seed();
    // `vendor_hosted` from the fixture, and nothing filled in. This used to fall through to
    // "upload an application package", which names a control the screen does not have under
    // either remote method.
    await expect(versionService.releaseVersion(VERSION, ACTOR, SCOPE)).rejects.toThrow(
      /nowhere to fetch from/,
    );
  });
});

/* ────────────────────────────────────────────── ownership through the product */

describe("versions and files derive ownership from their product", () => {
  it("gives a vendor their own version", async () => {
    await seed();
    const { version, product } = await ownership.requireOwnedVersion(VERSION, SCOPE);
    expect(version.version).toBe("1.0.0");
    expect(String(product._id)).toBe(PRODUCT);
  });

  it("refuses another vendor's version as a 404", async () => {
    await seed();
    await expect(
      ownership.requireOwnedVersion(VERSION, { vendorId: OTHER_VENDOR }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a first-party product's version to any vendor", async () => {
    await seed();
    const [firstPartyVersion] = await catalog.ProductVersion.create([
      { productId: FIRST_PARTY, version: "9.0.0", status: "draft" },
    ]);

    await expect(
      ownership.requireOwnedVersion(String(firstPartyVersion!._id), SCOPE),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses another vendor's file as a 404", async () => {
    await seed();
    const file = await catalog.ProductFile.findOne({ productId: PRODUCT }).lean();

    await expect(
      ownership.requireOwnedFile(String(file!._id), { vendorId: OTHER_VENDOR }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a blank vendor scope rather than widening", async () => {
    await seed();
    const scope = await import("@/lib/auth/scope");
    await expect(
      ownership.requireOwnedVersion(VERSION, { vendorId: "" }),
    ).rejects.toBeInstanceOf(scope.ScopeError);
  });

  it("still lets staff read any version, by omitting the scope", async () => {
    await seed();
    const { version } = await ownership.requireOwnedVersion(VERSION, {});
    expect(version.version).toBe("1.0.0");
  });

  it("refuses a version-scoped write from the wrong vendor", async () => {
    await seed();
    await expect(
      versionService.releaseVersion(VERSION, ACTOR, { vendorId: OTHER_VENDOR }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });
});

/* ────────────────────────────────────────────── the source, and its token */

describe("recording an artefact source", () => {
  it("requires a checksum for a vendor-hosted package", async () => {
    await seed();

    // Without it, whatever is at that URL *today* becomes what customers download.
    await expect(
      artefactService.saveArtefactSource(
        { versionId: VERSION, method: "vendor_hosted", url: "https://example.com/p.zip" },
        ACTOR,
        SCOPE,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("requires a tag rather than accepting a branch by omission", async () => {
    await seed();
    await expect(
      artefactService.saveArtefactSource(
        {
          versionId: VERSION,
          method: "repository",
          repositoryUrl: "https://github.com/northwind/dispatch",
        },
        ACTOR,
        SCOPE,
      ),
    ).rejects.toThrow(/tag/i);
  });

  it("refuses a released version's source, because its artefact is frozen", async () => {
    await seed();
    await catalog.ProductVersion.updateOne({ _id: VERSION }, { $set: { status: "released" } });

    await expect(
      artefactService.saveArtefactSource(
        {
          versionId: VERSION,
          method: "vendor_hosted",
          url: "https://example.com/p.zip",
          checksumSha256: "a".repeat(64),
        },
        ACTOR,
        SCOPE,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  /**
   * The token is sealed and `select: false`, so an ordinary read cannot carry it out.
   * Asserted on the serialised document rather than on the field, because "absent from a
   * plain query" is the guarantee.
   */
  it("seals a repository token and keeps it out of an ordinary read", async () => {
    await seed();

    await artefactService.saveArtefactSource(
      {
        versionId: VERSION,
        method: "repository",
        repositoryUrl: "https://github.com/northwind/dispatch",
        tag: "v1.0.0",
        token: "ghp_averysecrettoken",
      },
      ACTOR,
      SCOPE,
    );

    const plain = await catalog.ProductVersion.findById(VERSION).lean();
    expect(JSON.stringify(plain)).not.toContain("ghp_averysecrettoken");
    expect(plain!.artefactSource?.tokenCipher?.ciphertext).toBeUndefined();

    // And it really was stored — sealed, and openable only with the version id as AAD.
    const withToken = await catalog.ProductVersion.findById(VERSION)
      .select("+artefactSource.tokenCipher")
      .lean();
    const cipher = withToken!.artefactSource!.tokenCipher!;
    expect(cipher.ciphertext).toBeTruthy();

    const { open } = await import("@/lib/crypto");
    expect(open(cipher, VERSION)).toBe("ghp_averysecrettoken");
    // Bound to this version: the same ciphertext on another version does not open.
    expect(() => open(cipher, "7c00c46f6c887b38e2f0e0d9")).toThrow();
  });

  it("never puts the token or the query string in an audit row", async () => {
    await seed();
    await artefactService.saveArtefactSource(
      {
        versionId: VERSION,
        method: "vendor_hosted",
        url: "https://example.com/p.zip?signature=secretvalue",
        checksumSha256: "b".repeat(64),
        token: "ghp_anothersecret",
      },
      ACTOR,
      SCOPE,
    );

    const rows = await communication.AuditLog.find({}).lean();
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain("ghp_anothersecret");
    expect(serialised).not.toContain("secretvalue");
    // The host is recorded, because "which server" is the useful fact.
    expect(serialised).toContain("example.com");
  });
});

/* ────────────────────────────────────────────── the forge URL */

describe("tarballUrlFor", () => {
  it("builds a GitHub tag tarball", () => {
    expect(
      artefactService.tarballUrlFor("https://github.com/northwind/dispatch", "v1.2.3"),
    ).toBe("https://codeload.github.com/northwind/dispatch/tar.gz/refs/tags/v1.2.3");
  });

  it("tolerates a .git suffix and a trailing slash", () => {
    expect(
      artefactService.tarballUrlFor("https://github.com/northwind/dispatch.git", "v1"),
    ).toContain("/northwind/dispatch/tar.gz/");
  });

  it("builds a GitLab archive URL", () => {
    expect(artefactService.tarballUrlFor("https://gitlab.com/nw/dispatch", "v2.0.0")).toBe(
      "https://gitlab.com/nw/dispatch/-/archive/v2.0.0/dispatch-v2.0.0.tar.gz",
    );
  });

  it("encodes a tag that would otherwise change the path", () => {
    // A tag is vendor input and lands in a URL path.
    expect(artefactService.tarballUrlFor("https://github.com/a/b", "../../etc")).toContain(
      "%2F",
    );
  });

  it("refuses a forge it cannot build a URL for, rather than guessing", () => {
    // A guess is a 404 an hour later inside a job.
    expect(() => artefactService.tarballUrlFor("https://bitbucket.org/a/b", "v1")).toThrow(
      /GitHub and GitLab/,
    );
  });
});
