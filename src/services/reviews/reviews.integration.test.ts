import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Reviews — vendor ticket 10.
 *
 * The properties that make a rating worth believing, each asserted against the service rather
 * than a screen:
 *
 *  1. **Only a purchase can review**, and only once, by unique index.
 *  2. **Only the author edits**, and the edit is visible.
 *  3. **A vendor can reply and report, and nothing else** — no hide, no remove, no edit.
 *  4. **Aggregates are recomputed from the reviews**, so hiding one changes the average
 *     immediately and nothing can drift.
 *  5. **A vendor's rating is the mean of the reviews**, not the mean of the products' means.
 */

let mongoose: typeof import("mongoose").default;
let reviews: typeof import("./review-service");
let reviewModels: typeof import("@/lib/db/models/reviews");
let catalog: typeof import("@/lib/db/models/catalog");
let commerce: typeof import("@/lib/db/models/commerce");
let vendors: typeof import("@/lib/db/models/vendors");
let communication: typeof import("@/lib/db/models/communication");
let identity: typeof import("@/lib/db/models/identity");
let errors: typeof import("@/lib/errors");

const VENDOR = "7f00c46f6c887b38e2f0e0a1";
const ORG = "7f00c46f6c887b38e2f0e0b1";
const OTHER_ORG = "7f00c46f6c887b38e2f0e0b2";
const USER = "7f00c46f6c887b38e2f0e0c1";
const OTHER_USER = "7f00c46f6c887b38e2f0e0c2";
const PRODUCT = "7f00c46f6c887b38e2f0e0d1";
const SECOND_PRODUCT = "7f00c46f6c887b38e2f0e0d2";
const ORDER = "7f00c46f6c887b38e2f0e0e1";

const CUSTOMER = { type: "customer", userId: USER, name: "Ada Lovelace" } as const;
const OTHER_CUSTOMER = { type: "customer", userId: OTHER_USER, name: "Bo Nkemelu" } as const;
const STAFF = { type: "staff", userId: OTHER_USER, name: "Sam" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "reviews_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  reviews = await import("./review-service");
  reviewModels = await import("@/lib/db/models/reviews");
  catalog = await import("@/lib/db/models/catalog");
  commerce = await import("@/lib/db/models/commerce");
  vendors = await import("@/lib/db/models/vendors");
  communication = await import("@/lib/db/models/communication");
  identity = await import("@/lib/db/models/identity");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await reviewModels.Review.syncIndexes();
  await reviewModels.ReviewReport.syncIndexes();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await reviewModels.Review.deleteMany({});
  await reviewModels.ReviewReport.deleteMany({});
  await catalog.Product.deleteMany({});
  await commerce.Entitlement.deleteMany({});
  await commerce.Download.deleteMany({});
  await vendors.Vendor.deleteMany({});
  await identity.User.deleteMany({});
  await communication.AuditLog.collection.deleteMany({});
});

/* ────────────────────────────────────────────── fixtures */

async function seed() {
  await identity.User.create([
    { _id: USER, name: "Ada Lovelace", email: "ada@example.com", emailVerified: true },
    { _id: OTHER_USER, name: "Bo Nkemelu", email: "bo@example.com", emailVerified: true },
  ]);

  await vendors.Vendor.create({
    _id: VENDOR,
    displayName: "Northwind Labs",
    slug: "northwind-labs",
    contactEmail: "ada@northwind.test",
    country: "GB",
    pitch: "Dispatch tooling.",
    appliedAt: new Date(),
    status: "verified",
  });

  await catalog.Product.create([
    {
      _id: PRODUCT,
      name: "Northwind Dispatch",
      slug: "northwind-dispatch",
      summary: "Dispatch tooling.",
      status: "published",
      vendorId: VENDOR,
      vendorSlug: "northwind-labs",
      vendorName: "Northwind Labs",
    },
    {
      _id: SECOND_PRODUCT,
      name: "Northwind Invoicing",
      slug: "northwind-invoicing",
      summary: "Invoices.",
      status: "published",
      vendorId: VENDOR,
      vendorSlug: "northwind-labs",
      vendorName: "Northwind Labs",
    },
  ]);
}

/** An active entitlement, which is the whole purchase gate. */
async function entitlement(
  overrides: {
    id?: string;
    productId?: string;
    organizationId?: string;
    status?: "active" | "suspended" | "revoked";
    lineId?: string;
  } = {},
) {
  const created = await commerce.Entitlement.create({
    ...(overrides.id ? { _id: overrides.id } : {}),
    organizationId: overrides.organizationId ?? ORG,
    productId: overrides.productId ?? PRODUCT,
    orderId: ORDER,
    orderLineId: overrides.lineId ?? `line-${Math.random().toString(36).slice(2, 8)}`,
    status: overrides.status ?? "active",
  });
  return String(created._id);
}

const scope = { organizationId: ORG };

/* ────────────────────────────────────────────── the purchase gate */

describe("only somebody who bought it", () => {
  it("accepts a review from an active entitlement", async () => {
    await seed();
    const id = await entitlement();

    const review = await reviews.submit(
      { entitlementId: id, rating: 5, title: "Excellent", body: "Did exactly what we needed." },
      scope,
      CUSTOMER,
    );

    expect(review.rating).toBe(5);
    expect(review.status).toBe("published");
    expect(String(review.productId)).toBe(PRODUCT);
    // Denormalised at write time so the vendor aggregate is one indexed query.
    expect(String(review.vendorId)).toBe(VENDOR);
  });

  it("refuses another organisation's entitlement, as a 404", async () => {
    await seed();
    const id = await entitlement({ organizationId: OTHER_ORG });

    await expect(
      reviews.submit(
        { entitlementId: id, rating: 5, body: "Not mine to review, but here we are." },
        scope,
        CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a suspended entitlement", async () => {
    await seed();
    const id = await entitlement({ status: "suspended" });

    await expect(
      reviews.submit(
        { entitlementId: id, rating: 1, body: "Refund me or I will review you badly." },
        scope,
        CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  /** The index, not a read-then-write: two tabs both pass a check, only one passes this. */
  it("allows one review per entitlement", async () => {
    await seed();
    const id = await entitlement();

    await reviews.submit(
      { entitlementId: id, rating: 4, body: "A perfectly reasonable first review." },
      scope,
      CUSTOMER,
    );

    await expect(
      reviews.submit(
        { entitlementId: id, rating: 1, body: "And a second one, which must be refused." },
        scope,
        CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(errors.ConflictError);

    expect(await reviewModels.Review.countDocuments({})).toBe(1);
  });

  it("allows a second review from a second purchase of the same product", async () => {
    await seed();
    const first = await entitlement({ lineId: "line-1" });
    const second = await entitlement({ lineId: "line-2" });

    await reviews.submit(
      { entitlementId: first, rating: 4, body: "The first licence we bought was fine." },
      scope,
      CUSTOMER,
    );
    await reviews.submit(
      { entitlementId: second, rating: 2, body: "The second one had a nastier install." },
      scope,
      CUSTOMER,
    );

    expect(await reviewModels.Review.countDocuments({})).toBe(2);
  });
});

/* ────────────────────────────────────────────── editing */

describe("editing", () => {
  async function aReview() {
    await seed();
    const id = await entitlement();
    return reviews.submit(
      { entitlementId: id, rating: 3, body: "Middling, and I may change my mind." },
      scope,
      CUSTOMER,
    );
  }

  it("lets the author edit, and marks it edited", async () => {
    const review = await aReview();

    const updated = await reviews.edit(
      String(review._id),
      { rating: 5, body: "They fixed it within a day. Revised upward." },
      CUSTOMER,
    );

    expect(updated.rating).toBe(5);
    expect(updated.editedAt).toBeInstanceOf(Date);
  });

  it("refuses anybody else, including staff", async () => {
    const review = await aReview();

    await expect(
      reviews.edit(
        String(review._id),
        { rating: 1, body: "Somebody else rewriting your opinion for you." },
        OTHER_CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    // Staff have no edit path at all — the only actor argument is the author, and the filter
    // is on `authorUserId`. There is deliberately no `moderate`-style override.
    await expect(
      reviews.edit(
        String(review._id),
        { rating: 1, body: "Staff rewriting a customer's words is not a capability." },
        { ...STAFF, userId: STAFF.userId },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("moves the aggregate when the rating changes", async () => {
    const review = await aReview();
    expect((await product()).ratingSum).toBe(3);

    await reviews.edit(
      String(review._id),
      { rating: 5, body: "Revised, and much happier." },
      CUSTOMER,
    );

    const after = await product();
    expect(after.ratingSum).toBe(5);
    expect(after.ratingCount).toBe(1);
  });
});

/* ────────────────────────────────────────────── the vendor */

describe("what a vendor may do", () => {
  async function aReview() {
    await seed();
    const id = await entitlement();
    return reviews.submit(
      { entitlementId: id, rating: 2, body: "The import step failed on a big CSV." },
      scope,
      CUSTOMER,
    );
  }

  it("responds once, publicly, and the edit is visible", async () => {
    const review = await aReview();

    const replied = await reviews.respond(
      String(review._id),
      "Fixed in 2.1 — thank you for the detail.",
      VENDOR,
      { type: "vendor", userId: USER, vendorId: VENDOR },
    );

    expect(replied.vendorResponse?.body).toBe("Fixed in 2.1 — thank you for the detail.");
    expect(replied.vendorResponse?.at).toBeInstanceOf(Date);
    expect(replied.vendorResponse?.editedAt).toBeUndefined();

    const edited = await reviews.respond(String(review._id), "Fixed in 2.1.", VENDOR, {
      type: "vendor",
      userId: USER,
      vendorId: VENDOR,
    });

    // The original timestamp survives; `editedAt` records the change. A response whose date
    // silently moved would read as a reply to something later.
    expect(edited.vendorResponse?.at.getTime()).toBe(replied.vendorResponse?.at.getTime());
    expect(edited.vendorResponse?.editedAt).toBeInstanceOf(Date);
  });

  it("cannot respond to another vendor's review", async () => {
    const review = await aReview();

    await expect(
      reviews.respond(String(review._id), "Not my product.", "7f00c46f6c887b38e2f0e0a9", {
        type: "vendor",
        userId: USER,
        vendorId: "7f00c46f6c887b38e2f0e0a9",
      }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("can report, which does not hide anything", async () => {
    const review = await aReview();

    const { reportCount, queued } = await reviews.report(
      String(review._id),
      { reason: "misleading", vendorId: VENDOR },
      { type: "vendor", userId: USER, vendorId: VENDOR },
    );

    expect(reportCount).toBe(1);
    expect(queued).toBe(false);

    // Still published, still in the aggregate. Reporting asks somebody to look; it is not a
    // veto, which is the whole point of the vendor not holding one.
    const after = await reviewModels.Review.findById(review._id).lean();
    expect(after!.status).toBe("published");
    expect((await product()).ratingCount).toBe(1);
  });

  /**
   * The asymmetry, asserted on the service.
   *
   * There is no vendor-facing moderation function to call, so what this proves is that the
   * guard exists for anybody who tries to add one — `assertNotVendorModeration` is exported
   * for exactly this.
   */
  it("cannot hide or remove", () => {
    expect(() =>
      reviews.assertNotVendorModeration({ type: "vendor", userId: USER, vendorId: VENDOR }),
    ).toThrow(errors.ForbiddenError);

    expect(() => reviews.assertNotVendorModeration(STAFF)).not.toThrow();
  });
});

/* ────────────────────────────────────────────── reporting and moderation */

describe("reporting", () => {
  async function aReview() {
    await seed();
    const id = await entitlement();
    return reviews.submit(
      { entitlementId: id, rating: 1, body: "Contains a link to buy watches, obviously spam." },
      scope,
      CUSTOMER,
    );
  }

  it("counts one report per person however often they click", async () => {
    const review = await aReview();

    await reviews.report(String(review._id), { reason: "spam" }, CUSTOMER);
    const second = await reviews.report(String(review._id), { reason: "spam" }, CUSTOMER);

    expect(second.reportCount).toBe(1);
    expect(await reviewModels.ReviewReport.countDocuments({})).toBe(1);
  });

  it("queues for staff once the threshold is crossed", async () => {
    const review = await aReview();
    // Three distinct 24-hex ids. Built by index rather than by hashing a letter, which is
    // how the first attempt produced a 25th character and a very confusing failure.
    const reporters = [0, 1, 2].map((index) => `7f00c46f6c887b38e2f0e0f${index}`);

    let last: Awaited<ReturnType<typeof reviews.report>> | undefined;
    for (const userId of reporters) {
      last = await reviews.report(
        String(review._id),
        { reason: "spam" },
        { type: "customer", userId },
      );
    }

    expect(last!.reportCount).toBe(reviewModels.REPORT_THRESHOLD);
    expect(last!.queued).toBe(true);

    // Queued, not hidden. A brigade must not be able to remove a review by voting.
    const after = await reviewModels.Review.findById(review._id).lean();
    expect(after!.status).toBe("published");
  });

  it("requires a note when the reason is 'other'", async () => {
    const review = await aReview();

    await expect(
      reviews.report(String(review._id), { reason: "other" }, CUSTOMER),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});

describe("moderation", () => {
  async function aReview(rating = 4) {
    await seed();
    const id = await entitlement();
    return reviews.submit(
      { entitlementId: id, rating, body: "A review that staff will act on shortly." },
      scope,
      CUSTOMER,
    );
  }

  it("hides a review and removes it from the aggregate immediately", async () => {
    const review = await aReview(4);
    expect((await product()).ratingCount).toBe(1);

    const hidden = await reviews.moderate(
      String(review._id),
      "hidden",
      "Names an individual member of staff.",
      STAFF,
    );

    expect(hidden.status).toBe("hidden");
    expect(hidden.moderationReason).toBe("Names an individual member of staff.");

    const after = await product();
    expect(after.ratingCount).toBeUndefined();
    expect(after.ratingSum).toBeUndefined();
  });

  it("restores it, and the aggregate comes back", async () => {
    const review = await aReview(4);
    await reviews.moderate(String(review._id), "hidden", "Looked at again.", STAFF);

    const restored = await reviews.moderate(String(review._id), "published", "", STAFF);

    expect(restored.status).toBe("published");
    expect(restored.moderationReason).toBeUndefined();
    expect((await product()).ratingCount).toBe(1);
  });

  it("refuses to hide or remove without a reason the author can read", async () => {
    const review = await aReview();

    await expect(
      reviews.moderate(String(review._id), "hidden", "   ", STAFF),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("keeps the row when removing, and audits it", async () => {
    const review = await aReview();

    await reviews.moderate(String(review._id), "removed", "Abusive, after a warning.", STAFF);

    // The row survives: a review nobody can find is still evidence in a dispute about what
    // was said.
    expect(await reviewModels.Review.countDocuments({})).toBe(1);

    const audit = await communication.AuditLog.findOne({ action: "review.moderated" }).lean();
    expect(audit).toBeTruthy();
    expect(String(audit!.subjectId)).toBe(String(review._id));
  });

  it("keeps a removed review out of every public read", async () => {
    const review = await aReview();
    await reviews.moderate(String(review._id), "removed", "Policy breach.", STAFF);

    expect(await reviews.listForProduct(PRODUCT)).toEqual([]);
    // And out of the vendor's list too — showing a vendor what we removed invites an argument
    // rather than a fix.
    expect(await reviews.listForVendor(VENDOR)).toEqual([]);
  });
});

/* ────────────────────────────────────────────── aggregates */

describe("aggregates", () => {
  it("stores a sum, a count and a distribution rather than an average", async () => {
    await seed();
    for (const rating of [5, 4, 4, 1]) {
      const id = await entitlement({ lineId: `line-${rating}-${Math.random()}` });
      await reviews.submit(
        { entitlementId: id, rating, body: `A ${rating} star review, for the distribution.` },
        scope,
        CUSTOMER,
      );
    }

    const row = await product();
    expect(row.ratingCount).toBe(4);
    expect(row.ratingSum).toBe(14);
    // One-star first.
    expect(row.ratingDistribution).toEqual([1, 0, 0, 2, 1]);
    // 14 / 4 = 3.5, derived and never stored.
    expect(reviews.averageRating(row.ratingSum, row.ratingCount)).toBe(3.5);
  });

  it("unsets the fields entirely when the last review goes", async () => {
    await seed();
    const id = await entitlement();
    const review = await reviews.submit(
      { entitlementId: id, rating: 5, body: "The only review this product will have." },
      scope,
      CUSTOMER,
    );

    await reviews.moderate(String(review._id), "hidden", "Suspected fake.", STAFF);

    const row = await product();
    // Absent, not zero: a zeroed average renders as a zero-star product and emits a
    // fabricated `AggregateRating`.
    expect(row.ratingCount).toBeUndefined();
    expect(row.ratingSum).toBeUndefined();
    expect(reviews.averageRating(row.ratingSum, row.ratingCount)).toBeNull();
  });

  /**
   * The vendor rating is the mean of the **reviews**.
   *
   * Two products: one with two fives, one with a single one-star. Averaging the products'
   * averages gives 3.0; the mean of the reviews gives 3.67. The second is what a buyer assumes
   * a seller rating means, and the first lets one review of an unpopular product cancel out
   * many of a popular one.
   */
  it("weights a vendor's rating by review count, not by product", async () => {
    await seed();

    for (const rating of [5, 5]) {
      const id = await entitlement({ lineId: `a-${rating}-${Math.random()}` });
      await reviews.submit(
        { entitlementId: id, rating, body: "Popular product, happy customer." },
        scope,
        CUSTOMER,
      );
    }

    const other = await entitlement({
      productId: SECOND_PRODUCT,
      lineId: `b-${Math.random()}`,
    });
    await reviews.submit(
      { entitlementId: other, rating: 1, body: "The other product was a disappointment." },
      scope,
      CUSTOMER,
    );

    const vendor = await vendors.Vendor.findById(VENDOR).lean();
    expect(vendor!.ratingCount).toBe(3);
    expect(vendor!.ratingSum).toBe(11);
    expect(reviews.averageRating(vendor!.ratingSum, vendor!.ratingCount)).toBe(3.7);
  });
});

/* ────────────────────────────────────────────── reading */

describe("what a reader sees", () => {
  it("shortens the author's name and never exposes an email", async () => {
    await seed();
    const id = await entitlement();
    await reviews.submit(
      { entitlementId: id, rating: 5, body: "A review whose author has a full name." },
      scope,
      CUSTOMER,
    );

    const [view] = await reviews.listForProduct(PRODUCT);
    expect(view!.authorName).toBe("Ada L.");
    expect(JSON.stringify(view)).not.toContain("@example.com");
  });

  it("records which version was reviewed", async () => {
    await seed();
    const [version] = await catalog.ProductVersion.create([
      { productId: PRODUCT, version: "1.4.0", status: "released", releasedAt: new Date() },
    ]);
    const created = await commerce.Entitlement.create({
      organizationId: ORG,
      productId: PRODUCT,
      orderId: ORDER,
      orderLineId: "line-version",
      status: "active",
      purchasedVersionId: version!._id,
    });

    const review = await reviews.submit(
      {
        entitlementId: String(created._id),
        rating: 2,
        body: "Broken on the version we bought.",
      },
      scope,
      CUSTOMER,
    );

    expect(review.versionAtReview).toBe("1.4.0");
  });
});

/* ────────────────────────────────────────────── the prompt */

describe("the review prompt", () => {
  async function anEntitlement(overrides: Record<string, unknown> = {}) {
    await seed();
    const created = await commerce.Entitlement.create({
      organizationId: ORG,
      productId: PRODUCT,
      orderId: ORDER,
      orderLineId: "line-prompt",
      status: "active",
      ...overrides,
    });
    return created;
  }

  it("does not ask before there is any sign of use", async () => {
    const created = await anEntitlement();

    expect(
      await reviews.shouldPrompt(
        { _id: created._id, status: "active", createdAt: new Date() },
        USER,
      ),
    ).toBe(false);
  });

  it("asks once a download has been recorded", async () => {
    const created = await anEntitlement();
    await commerce.Download.create({
      organizationId: ORG,
      entitlementId: created._id,
      productFileId: PRODUCT,
      userId: USER,
    });

    expect(
      await reviews.shouldPrompt(
        { _id: created._id, status: "active", createdAt: new Date() },
        USER,
      ),
    ).toBe(true);
  });

  it("asks after a few days even with no download", async () => {
    const created = await anEntitlement();
    const old = new Date(Date.now() - (reviews.PROMPT_AFTER_DAYS + 1) * 86_400_000);

    expect(
      await reviews.shouldPrompt({ _id: created._id, status: "active", createdAt: old }, USER),
    ).toBe(true);
  });

  it("stops asking once dismissed, permanently", async () => {
    const created = await anEntitlement();
    await reviews.dismissPrompt(String(created._id), scope);

    const after = await commerce.Entitlement.findById(created._id).lean();
    expect(after!.reviewPromptDismissedAt).toBeInstanceOf(Date);

    expect(
      await reviews.shouldPrompt(
        {
          _id: created._id,
          status: "active",
          createdAt: new Date(0),
          ...(after!.reviewPromptDismissedAt
            ? { reviewPromptDismissedAt: after!.reviewPromptDismissedAt }
            : {}),
        },
        USER,
      ),
    ).toBe(false);
  });

  it("stops asking once reviewed", async () => {
    const created = await anEntitlement();
    await reviews.submit(
      { entitlementId: String(created._id), rating: 5, body: "Already said my piece here." },
      scope,
      CUSTOMER,
    );

    expect(
      await reviews.shouldPrompt(
        { _id: created._id, status: "active", createdAt: new Date(0) },
        USER,
      ),
    ).toBe(false);
  });

  it("refuses to dismiss another organisation's prompt", async () => {
    const created = await anEntitlement({ organizationId: OTHER_ORG });

    await expect(reviews.dismissPrompt(String(created._id), scope)).rejects.toBeInstanceOf(
      errors.NotFoundError,
    );
  });
});

/* ────────────────────────────────────────────── helpers */

async function product() {
  const row = await catalog.Product.findById(PRODUCT).lean();
  return row as unknown as {
    ratingSum?: number;
    ratingCount?: number;
    ratingDistribution?: number[];
  };
}
