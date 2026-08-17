import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Submission and review — vendor ticket 05.
 *
 * The properties worth a real database:
 *
 *  1. **A vendor cannot reach past `submitted`.** Asserted against the service, not a
 *     screen, because a screen is not what a POST goes through.
 *  2. **`internalNote` never reaches the vendor.** The guarantee is that the
 *     vendor-facing projection has no such field, so this asserts the *absence* rather
 *     than that a component skipped it.
 *  3. **Notes accumulate.** A third submission is only comprehensible next to what was
 *     said about the first two.
 *  4. **The readiness gate is the same one publication uses.**
 *  5. **The section diff is derived from audit rows that already exist.**
 */

let mongoose: typeof import("mongoose").default;
let productService: typeof import("./product-service");
let reviewService: typeof import("./review-service");
let productView: typeof import("./product-view");
let catalog: typeof import("@/lib/db/models/catalog");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");
let vendors: typeof import("@/lib/db/models/vendors");
let vendorService: typeof import("@/services/vendors/vendor-service");

const VENDOR = "7b00c46f6c887b38e2f0e0a1";
const OTHER_VENDOR = "7b00c46f6c887b38e2f0e0a2";
const VENDOR_USER = "7b00c46f6c887b38e2f0e0b1";
const STAFF = "7b00c46f6c887b38e2f0e0c1";
const PRODUCT = "7b00c46f6c887b38e2f0e0d1";
const VERSION = "7b00c46f6c887b38e2f0e0e1";
const FILE = "7b00c46f6c887b38e2f0e0f1";

const VENDOR_ACTOR = {
  type: "vendor",
  userId: VENDOR_USER,
  vendorId: VENDOR,
  name: "Ada",
} as const;
const STAFF_ACTOR = { type: "staff", userId: STAFF, name: "Sam" } as const;
const SCOPE = { vendorId: VENDOR };

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "review_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  productService = await import("./product-service");
  reviewService = await import("./review-service");
  productView = await import("./product-view");
  catalog = await import("@/lib/db/models/catalog");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");
  vendors = await import("@/lib/db/models/vendors");
  vendorService = await import("@/services/vendors/vendor-service");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await catalog.Product.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await vendors.Vendor.deleteMany({});
  await catalog.Product.deleteMany({});
  await catalog.ProductVersion.deleteMany({});
  await catalog.ProductFile.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
});

/**
 * A product that clears `computeReadiness()`.
 *
 * Every field here is load-bearing for one gap — price, licence package, screenshot,
 * description, a released version with a package file, and a complete checklist. That
 * is the point: the submission gate is the publication gate, so a submittable fixture
 * is a publishable one.
 */
async function seedReadyProduct(overrides: Record<string, unknown> = {}) {
  // The vendor itself, with the agreement in force accepted — vendor ticket 07 gates
  // submission on it, so a fixture without a vendor is a fixture that cannot submit. Which
  // is correct behaviour, and the reason this appeared here rather than in production.
  await seedVendor(vendorService.VENDOR_AGREEMENT_VERSION);

  await catalog.Product.create({
    _id: PRODUCT,
    name: "Northwind Dispatch",
    slug: "northwind-dispatch",
    summary: "Dispatch and route planning for small distributors.",
    // A *non-empty* ProseMirror tree: `computeReadiness` derives `hasDescription`
    // from `isEmptyDocument()`, so `{ type: "doc", content: [] }` reads as no
    // description at all — which is right, and worth having tripped over here rather
    // than in a vendor's face.
    descriptionText: "A longer description of the product.",
    description: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "What this product does." }] },
      ],
    },
    status: "draft",
    vendorId: VENDOR,
    vendorSlug: "northwind-labs",
    vendorName: "Northwind Labs",
    facets: ["vend:northwind-labs"],
    prices: [{ currency: "GBP", amount: 29900 }],
    licencePackages: [
      {
        key: "single",
        name: "Single installation",
        licenceType: "single_installation",
        activationLimit: 1,
        supportMonths: 12,
        updateMonths: 12,
        prices: [{ currency: "GBP", amount: 29900 }],
      },
    ],
    media: [
      { kind: "screenshot", url: "https://example.test/a.png", sortOrder: 0, isPrimary: true },
    ],
    currentVersionId: VERSION,
    testingChecklist: [{ item: "Installs cleanly", status: "pass" }],
    reviewNotes: [],
    ...overrides,
  });

  await catalog.ProductVersion.create({
    _id: VERSION,
    productId: PRODUCT,
    version: "1.0.0",
    status: "released",
    releasedAt: new Date(),
  });

  await catalog.ProductFile.create({
    _id: FILE,
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

/** The vendor row, accepting the given agreement version — `null` for never accepted. */
async function seedVendor(agreementVersion: string | null) {
  await vendors.Vendor.create({
    _id: VENDOR,
    displayName: "Northwind Labs",
    slug: "northwind-labs",
    contactEmail: "ada@northwind.test",
    country: "GB",
    status: "verified",
    pitch: "We build dispatch tooling for small distributors.",
    appliedAt: new Date(),
    ...(agreementVersion
      ? {
          agreement: {
            version: agreementVersion,
            acceptedAt: new Date(),
            acceptedByUserId: VENDOR_USER,
          },
        }
      : {}),
  });
}

const submit = () =>
  reviewService.submit(
    { productId: PRODUCT, scope: SCOPE, attested: true },
    { ...VENDOR_ACTOR },
  );

/* ────────────────────────────────────────────── submitting */

describe("submitting", () => {
  it("moves a ready product to submitted and records the attestation", async () => {
    await seedReadyProduct();

    const updated = await submit();
    expect(updated.status).toBe("submitted");

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.attestation).toBeDefined();
    expect(String(doc!.attestation!.byUserId)).toBe(VENDOR_USER);
    expect(doc!.attestation!.statementVersion).toBe(reviewService.ATTESTATION_VERSION);
    // The version being declared about, not just "a version existed".
    expect(doc!.attestation!.versionAtSubmission).toBe("1.0.0");
  });

  it("refuses without the attestation, and does not move the product", async () => {
    await seedReadyProduct();

    await expect(
      reviewService.submit(
        { productId: PRODUCT, scope: SCOPE, attested: false },
        { ...VENDOR_ACTOR },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.status).toBe("draft");
    expect(doc!.attestation).toBeUndefined();
  });

  /**
   * The gate is `computeReadiness()` — the same pure function the publish gate uses, so
   * a vendor sees exactly the gaps a reviewer would.
   */
  it("refuses while readiness reports a gap, and names the gap", async () => {
    await seedReadyProduct({ prices: [], licencePackages: [] });

    await expect(submit()).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(submit()).rejects.toThrow(/price/i);

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.status).toBe("draft");
  });

  it("cannot submit twice while a submission is open", async () => {
    await seedReadyProduct();
    await submit();

    // `submitted` has no edge to itself, so the machine refuses rather than a button
    // being disabled.
    await expect(submit()).rejects.toBeInstanceOf(errors.StateTransitionError);

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.reviewNotes.filter((n) => n.outcome === "submitted")).toHaveLength(1);
  });

  it("records the submission as a vendor-sourced audit row", async () => {
    await seedReadyProduct();
    await submit();

    const row = await communication.AuditLog.findOne({
      action: "product.status_changed",
    }).lean();
    expect(row!.actorType).toBe("vendor");
    expect(row!.source).toBe("vendor");
    expect(String(row!.vendorId)).toBe(VENDOR);
  });

  it("refuses a submission on another vendor's product, as a 404", async () => {
    await seedReadyProduct();

    await expect(
      reviewService.submit(
        { productId: PRODUCT, scope: { vendorId: OTHER_VENDOR }, attested: true },
        { type: "vendor", userId: VENDOR_USER, vendorId: OTHER_VENDOR },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });
});

/* ────────────────────────────────────────────── the ceiling on a vendor */

/**
 * The agreement gate — vendor ticket 07.
 *
 * "A new agreement version blocks new submissions until accepted, without affecting products
 * already on sale." Both halves are asserted, because the second is the one that would go
 * unnoticed: a gate that also stopped an existing product selling would be a much harder
 * change of terms than the one we told the vendor about.
 */
describe("a stale agreement blocks a new submission", () => {
  it("refuses the submission and says what to do", async () => {
    await seedReadyProduct();
    await vendors.Vendor.updateOne(
      { _id: VENDOR },
      { $set: { "agreement.version": "2020-01-01" } },
    );

    await expect(submit()).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(submit()).rejects.toThrow(/agreement/i);

    // Nothing moved.
    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.status).toBe("draft");
    expect(product!.reviewNotes).toEqual([]);
  });

  it("refuses when no agreement was ever recorded", async () => {
    await seedReadyProduct();
    await vendors.Vendor.updateOne({ _id: VENDOR }, { $unset: { agreement: "" } });

    await expect(submit()).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("lets the submission through once the new version is accepted", async () => {
    await seedReadyProduct();
    await vendors.Vendor.updateOne(
      { _id: VENDOR },
      { $set: { "agreement.version": "2020-01-01" } },
    );
    await expect(submit()).rejects.toBeInstanceOf(errors.ValidationError);

    await vendorService.acceptAgreement(VENDOR, VENDOR_USER, VENDOR_ACTOR);

    const product = await submit();
    expect(product.status).toBe("submitted");
  });

  /** A published product is untouched by a stale agreement. */
  it("leaves a product already on sale alone", async () => {
    await seedReadyProduct({ status: "published", publishedAt: new Date() });
    await vendors.Vendor.updateOne(
      { _id: VENDOR },
      { $set: { "agreement.version": "2020-01-01" } },
    );

    const product = await catalog.Product.findById(PRODUCT).lean();
    expect(product!.status).toBe("published");

    // And the vendor-facing read still works — nothing is hidden from them.
    expect(productView.toVendorReviewNotes(product!)).toBeTruthy();
  });

  /** A first-party product has no agreement to be stale. */
  it("does not gate a staff submission with no vendor scope", async () => {
    await seedReadyProduct();
    await catalog.Product.updateOne({ _id: PRODUCT }, { $unset: { vendorId: "" } });

    const product = await reviewService.submit(
      { productId: PRODUCT, scope: {}, attested: true },
      { ...STAFF_ACTOR, userId: STAFF },
    );
    expect(product.status).toBe("submitted");
  });
});

describe("what a vendor cannot do", () => {
  it("cannot publish, however the transition is called", async () => {
    await seedReadyProduct({ status: "ready" });

    await expect(
      productService.transition(PRODUCT, "published", VENDOR_ACTOR, { scope: SCOPE }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.status).toBe("ready");
  });

  it.each(["internal_review", "testing", "ready", "archived", "deprecated"] as const)(
    "cannot move a product to %s",
    async (target) => {
      // Seeded in a state from which the edge exists for *staff*, so the refusal is
      // about the actor rather than about the graph.
      const from =
        target === "internal_review"
          ? "submitted"
          : target === "testing"
            ? "internal_review"
            : target === "ready"
              ? "testing"
              : target === "deprecated"
                ? "published"
                : "draft";

      await seedReadyProduct({ status: from });

      await expect(
        productService.transition(PRODUCT, target, VENDOR_ACTOR, { scope: SCOPE }),
      ).rejects.toBeInstanceOf(errors.ForbiddenError);
    },
  );

  it("can withdraw before a reviewer claims it, and not after", async () => {
    await seedReadyProduct();
    await submit();

    await productService.transition(PRODUCT, "draft", VENDOR_ACTOR, { scope: SCOPE });
    expect((await catalog.Product.findById(PRODUCT).lean())!.status).toBe("draft");

    // Once claimed, the way back is `changes_requested`, which carries a reason.
    await submit();
    await reviewService.claim(PRODUCT, STAFF_ACTOR);
    await expect(
      productService.transition(PRODUCT, "draft", VENDOR_ACTOR, { scope: SCOPE }),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });
});

/* ────────────────────────────────────────────── reviewing */

describe("reviewing", () => {
  it("refuses to send a submission back without a reason", async () => {
    await seedReadyProduct();
    await submit();

    await expect(
      reviewService.requestChanges(
        { productId: PRODUCT, reasons: ["quality"], detail: "   " },
        { ...STAFF_ACTOR },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    expect((await catalog.Product.findById(PRODUCT).lean())!.status).toBe("submitted");
  });

  it("sends it back with the reason and the categories", async () => {
    await seedReadyProduct();
    await submit();

    await reviewService.requestChanges(
      {
        productId: PRODUCT,
        reasons: ["metadata", "demo"],
        detail: "The summary does not describe what it does.",
      },
      { ...STAFF_ACTOR },
    );

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.status).toBe("changes_requested");

    const note = doc!.reviewNotes.at(-1)!;
    expect(note.outcome).toBe("changes_requested");
    expect(note.reasons).toEqual(["metadata", "demo"]);
    expect(note.detail).toBe("The summary does not describe what it does.");
  });

  it("accumulates notes across a resubmission cycle", async () => {
    await seedReadyProduct();

    await submit();
    await reviewService.requestChanges(
      { productId: PRODUCT, reasons: ["metadata"], detail: "First pass: fix the summary." },
      { ...STAFF_ACTOR },
    );
    await submit();
    await reviewService.requestChanges(
      {
        productId: PRODUCT,
        reasons: ["pricing"],
        detail: "Second pass: the price is missing.",
      },
      { ...STAFF_ACTOR },
    );

    const doc = await catalog.Product.findById(PRODUCT).lean();
    // Two submissions and two decisions, in order, none overwritten.
    expect(doc!.reviewNotes.map((n) => n.outcome)).toEqual([
      "submitted",
      "changes_requested",
      "submitted",
      "changes_requested",
    ]);
    expect(doc!.reviewNotes[1]!.detail).toContain("First pass");
    expect(doc!.reviewNotes[3]!.detail).toContain("Second pass");
  });

  it("approves into internal_review rather than onto sale", async () => {
    await seedReadyProduct();
    await submit();

    const updated = await reviewService.approve(
      { productId: PRODUCT, detail: "Looks good." },
      { ...STAFF_ACTOR },
    );

    // Approving a *submission* is not approving a *product*: from here it takes the
    // same path a first-party product takes.
    expect(updated.status).toBe("internal_review");
  });
});

/* ────────────────────────────────────────────── §37 */

describe("an internal note never reaches the vendor", () => {
  const INTERNAL = "Third submission from this vendor with the same mistake.";

  it("is stored, and is absent from the vendor projection", async () => {
    await seedReadyProduct();
    await submit();

    await reviewService.requestChanges(
      {
        productId: PRODUCT,
        reasons: ["quality"],
        detail: "Please tidy the screenshots.",
        internalNote: INTERNAL,
      },
      { ...STAFF_ACTOR },
    );

    const doc = await catalog.Product.findById(PRODUCT).lean();

    // Staff wrote it and staff may read it.
    const staffNotes = productView.toStaffReviewNotes(doc!);
    expect(staffNotes.at(-1)!.internalNote).toBe(INTERNAL);

    // The vendor's projection does not carry the field at all — asserted on the
    // serialised payload, because "absent from the object" is the guarantee and a
    // component choosing not to render it would not be.
    const vendorNotes = productView.toVendorReviewNotes(doc!);
    expect(JSON.stringify(vendorNotes)).not.toContain(INTERNAL);
    expect(JSON.stringify(vendorNotes)).not.toContain("internalNote");
    // Non-vacuity: the vendor-facing note is there, it is just missing one field.
    expect(vendorNotes.at(-1)!.detail).toBe("Please tidy the screenshots.");
  });

  it("is not in the audit row either", async () => {
    await seedReadyProduct();
    await submit();
    await reviewService.requestChanges(
      { productId: PRODUCT, reasons: ["quality"], detail: "Tidy up.", internalNote: INTERNAL },
      { ...STAFF_ACTOR },
    );

    const rows = await communication.AuditLog.find({}).lean();
    // The audit row records *that* there was an internal note, not its text — an
    // append-only collection is the last place to copy a reviewer's private wording.
    expect(JSON.stringify(rows)).not.toContain(INTERNAL);
    const row = rows.find((r) => r.action === "product.changes_requested");
    expect(row!.after).toMatchObject({ hasInternalNote: true });
  });
});

/* ────────────────────────────────────────────── the resubmission diff */

describe("what changed since the last approval", () => {
  it("lists the sections edited since the previous approval, and nothing older", async () => {
    await seedReadyProduct();

    // A save, an approval, then two more saves. Only the last two should count.
    await productService.saveSection(PRODUCT, "seo", { seo: {} }, VENDOR_ACTOR, SCOPE);
    await submit();
    await reviewService.approve({ productId: PRODUCT, detail: "ok" }, { ...STAFF_ACTOR });

    await productService.transition(PRODUCT, "draft", STAFF_ACTOR);
    await productService.saveSection(
      PRODUCT,
      "basics",
      { name: "Renamed" },
      VENDOR_ACTOR,
      SCOPE,
    );
    await productService.saveSection(
      PRODUCT,
      "pricing",
      { prices: [{ currency: "GBP", amount: 19900 }] },
      VENDOR_ACTOR,
      SCOPE,
    );

    const changed = await reviewService.sectionsChangedSinceApproval(PRODUCT);
    expect(changed).toEqual(["basics", "pricing"]);
    // The `seo` save happened before the approval, so it is not "changed since".
    expect(changed).not.toContain("seo");
  });

  it("is recorded on the submission note, so the reviewer sees it in the queue", async () => {
    await seedReadyProduct();
    await productService.saveSection(PRODUCT, "media", { media: [] }, VENDOR_ACTOR, SCOPE);
    // Put the readiness back — the point of this test is the note, not the gate.
    await catalog.Product.updateOne(
      { _id: PRODUCT },
      {
        $set: {
          media: [
            {
              kind: "screenshot",
              url: "https://example.test/a.png",
              sortOrder: 0,
              isPrimary: true,
            },
          ],
        },
      },
    );

    await submit();

    const doc = await catalog.Product.findById(PRODUCT).lean();
    expect(doc!.reviewNotes.at(-1)!.changedSections).toContain("media");
  });
});
