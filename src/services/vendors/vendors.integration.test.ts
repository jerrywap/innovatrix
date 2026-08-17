import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Vendor identity, verification and membership — vendor tickets 01–03.
 *
 * Only the properties a real database has to enforce are here. Everything
 * decidable in memory is a unit test; these are the ones where the guarantee *is*
 * an index or a transaction:
 *
 *  1. **Applying is atomic.** A vendor without an owner has payout details nobody
 *     may change and nobody who can accept a new agreement version, and no sweep
 *     can reliably repair one later.
 *  2. **One active vendor per user**, by partial unique index — the constraint that
 *     removes the switcher from the shell.
 *  3. **A concurrent decision produces one winner**, because the guarded
 *     `findOneAndUpdate({ _id, status: from })` is the mechanism, not a re-read.
 *  4. **An invitation cannot be accepted by the wrong person, twice, or late.**
 */

let mongoose: typeof import("mongoose").default;
let vendorService: typeof import("./vendor-service");
let memberService: typeof import("./member-service");
let vendors: typeof import("@/lib/db/models/vendors");
let identity: typeof import("@/lib/db/models/identity");
let communication: typeof import("@/lib/db/models/communication");
let errors: typeof import("@/lib/errors");

const USER_A = "7a00c46f6c887b38e2f0e0a1";
const USER_B = "7a00c46f6c887b38e2f0e0a2";
const USER_C = "7a00c46f6c887b38e2f0e0a3";
const STAFF = "7a00c46f6c887b38e2f0e0f1";

const APPLICATION = {
  displayName: "Northwind Labs",
  contactEmail: "hello@northwind.test",
  country: "GB",
  pitch: "We build inventory and logistics tooling for small distributors. ".repeat(2),
};

const STAFF_ACTOR = { type: "staff", userId: STAFF, name: "Sam" } as const;

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "vendors_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;
  vendorService = await import("./vendor-service");
  memberService = await import("./member-service");
  vendors = await import("@/lib/db/models/vendors");
  identity = await import("@/lib/db/models/identity");
  communication = await import("@/lib/db/models/communication");
  errors = await import("@/lib/errors");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();

  // The partial unique index on `userId` is the whole point of test 2, and
  // Mongoose only creates it when asked.
  await vendors.Vendor.syncIndexes();
  await vendors.VendorMember.syncIndexes();
  await vendors.VendorInvitation.syncIndexes();
  await vendors.VendorDocument.syncIndexes();

  await identity.User.create([
    {
      _id: USER_A,
      email: "a@northwind.test",
      name: "Ada",
      emailVerified: true,
      isStaff: false,
      locale: "en-GB",
      deletedAt: null,
    },
    {
      _id: USER_B,
      email: "b@northwind.test",
      name: "Ben",
      emailVerified: true,
      isStaff: false,
      locale: "en-GB",
      deletedAt: null,
    },
    {
      _id: USER_C,
      email: "c@elsewhere.test",
      name: "Cai",
      emailVerified: true,
      isStaff: false,
      locale: "en-GB",
      deletedAt: null,
    },
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  await vendors.Vendor.deleteMany({});
  await vendors.VendorMember.deleteMany({});
  await vendors.VendorInvitation.deleteMany({});
  await vendors.VendorDocument.deleteMany({});
  // The model refuses every delete, so this goes through the collection handle.
  await communication.AuditLog.collection.deleteMany({});
});

const applyAsA = () => vendorService.apply(APPLICATION, { id: USER_A, name: "Ada" });

/* ────────────────────────────────────────────── applying */

describe("applying", () => {
  it("creates the vendor and its owner membership together", async () => {
    const vendor = await applyAsA();

    const members = await vendors.VendorMember.find({ vendorId: vendor._id }).lean();
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe("owner");
    expect(members[0]!.status).toBe("active");
    expect(String(members[0]!.userId)).toBe(USER_A);
  });

  it("never leaves a vendor without an owner", async () => {
    // The property, stated as the invariant rather than as a happy path: for every
    // vendor in the collection there is an active owner. A solo vendor is a vendor
    // with one member, so nothing downstream needs to branch on "has a team".
    await applyAsA();

    const allVendors = await vendors.Vendor.find({}).lean();
    for (const vendor of allVendors) {
      const owners = await vendors.VendorMember.countDocuments({
        vendorId: vendor._id,
        role: "owner",
        status: "active",
      });
      expect(owners).toBe(1);
    }
  });

  it("records the accepted agreement version and who accepted it", async () => {
    const vendor = await applyAsA();

    expect(vendor.agreement?.version).toBe(vendorService.VENDOR_AGREEMENT_VERSION);
    expect(String(vendor.agreement?.acceptedByUserId)).toBe(USER_A);
  });

  it("derives a slug and suffixes a collision rather than refusing", async () => {
    const first = await applyAsA();
    expect(first.slug).toBe("northwind-labs");

    // A second applicant with the same trading name has done nothing wrong, and
    // the slug is not what they came here to choose.
    await vendors.VendorMember.deleteMany({ userId: USER_A });
    const second = await vendorService.apply(APPLICATION, { id: USER_A });
    expect(second.slug).toBe("northwind-labs-2");
  });

  it("refuses a second vendor for the same person", async () => {
    await applyAsA();
    await expect(applyAsA()).rejects.toThrow(errors.ConflictError);
  });

  /**
   * The index, not the service check, is the guarantee. The service's own
   * pre-check exists so the applicant gets a sentence rather than a duplicate-key
   * error — it is not what makes the constraint true, and a second code path
   * writing a membership must still be refused.
   */
  it("enforces one active membership per user at the index, not just in the service", async () => {
    const vendor = await applyAsA();

    await expect(
      vendors.VendorMember.create({
        vendorId: vendor._id,
        userId: USER_A,
        role: "member",
        status: "active",
      }),
    ).rejects.toThrow(/duplicate key/i);
  });

  /**
   * The partial filter is what makes the constraint survivable. Without it, being
   * removed from one vendor would bar somebody from every other vendor forever.
   */
  it("lets a revoked member join a different vendor later", async () => {
    const vendor = await applyAsA();
    await vendors.VendorMember.updateOne(
      { vendorId: vendor._id, userId: USER_A },
      { $set: { status: "revoked" } },
    );

    const second = await vendorService.apply(
      { ...APPLICATION, displayName: "Southwind" },
      { id: USER_A },
    );

    const active = await vendors.VendorMember.countDocuments({
      userId: USER_A,
      status: "active",
    });
    expect(active).toBe(1);
    expect(String(second._id)).not.toBe(String(vendor._id));
  });

  it("writes an audit row naming the vendor as the subject", async () => {
    const vendor = await applyAsA();

    const rows = await communication.AuditLog.find({ action: "vendor.applied" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectType).toBe("vendor");
    expect(String(rows[0]!.subjectId)).toBe(String(vendor._id));
  });
});

/* ────────────────────────────────────────────── deciding */

describe("deciding an application", () => {
  it("refuses a rejection with no reason the applicant can read", async () => {
    const vendor = await applyAsA();
    await expect(
      vendorService.transition(String(vendor._id), "rejected", STAFF_ACTOR),
    ).rejects.toThrow(errors.ValidationError);
  });

  it("refuses to verify before identity is approved", async () => {
    const vendor = await applyAsA();
    await vendorService.transition(String(vendor._id), "in_review", STAFF_ACTOR);

    // The gate on listing a product is identity verification, and "verified"
    // without it would hand somebody the listing surface on nobody's evidence.
    await expect(
      vendorService.transition(String(vendor._id), "verified", STAFF_ACTOR),
    ).rejects.toThrow(errors.ValidationError);
  });

  it("refuses an illegal edge rather than writing it", async () => {
    const vendor = await applyAsA();
    await expect(
      vendorService.transition(String(vendor._id), "verified", STAFF_ACTOR),
    ).rejects.toThrow(errors.StateTransitionError);

    const after = await vendors.Vendor.findById(vendor._id).lean();
    expect(after!.status).toBe("applied");
  });

  it("walks an application through to verified and stamps the date", async () => {
    const vendor = await applyAsA();
    const id = String(vendor._id);

    await vendorService.transition(id, "in_review", STAFF_ACTOR);
    await vendorService.decideVerification(
      id,
      { level: "identity", outcome: "approved", documentHashes: ["abc"] },
      { ...STAFF_ACTOR },
    );
    const verified = await vendorService.transition(id, "verified", STAFF_ACTOR);

    expect(verified.status).toBe("verified");
    expect(verified.verifiedAt).toBeInstanceOf(Date);
  });

  /**
   * Two reviewers clicking at once. The guard is
   * `findOneAndUpdate({ _id, status: from })` — a read-then-write would let both
   * succeed and write two audit rows for one decision.
   */
  it("produces one winner and one clean conflict when two reviewers decide at once", async () => {
    const vendor = await applyAsA();
    const id = String(vendor._id);

    const results = await Promise.allSettled([
      vendorService.transition(id, "in_review", STAFF_ACTOR),
      vendorService.transition(id, "in_review", STAFF_ACTOR),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(errors.ConflictError);

    // And exactly one audit row, which is the part a re-read would get wrong.
    const rows = await communication.AuditLog.countDocuments({
      action: "vendor.status_changed",
    });
    expect(rows).toBe(1);
  });

  it("keeps the decision after the documents are gone", async () => {
    const vendor = await applyAsA();
    const id = String(vendor._id);

    await vendorService.decideVerification(
      id,
      { level: "identity", outcome: "approved", documentHashes: ["hash-1", "hash-2"] },
      { ...STAFF_ACTOR },
    );

    const after = await vendors.Vendor.findById(id).lean();
    expect(after!.verification.identity.status).toBe("approved");
    expect(after!.verificationDecisions).toHaveLength(1);
    // The checksums are the only remaining evidence of *what* was read.
    expect(after!.verificationDecisions[0]!.documentHashes).toEqual(["hash-1", "hash-2"]);
    expect(String(after!.verificationDecisions[0]!.byUserId)).toBe(STAFF);
  });

  it("appends decisions rather than overwriting them", async () => {
    const vendor = await applyAsA();
    const id = String(vendor._id);

    await vendorService.decideVerification(
      id,
      { level: "identity", outcome: "rejected", documentHashes: [], note: "Photo unreadable" },
      { ...STAFF_ACTOR },
    );
    await vendorService.decideVerification(
      id,
      { level: "identity", outcome: "approved", documentHashes: ["hash"] },
      { ...STAFF_ACTOR },
    );

    const after = await vendors.Vendor.findById(id).lean();
    // The second decision is only comprehensible next to the first.
    expect(after!.verificationDecisions).toHaveLength(2);
    expect(after!.verificationDecisions[0]!.outcome).toBe("rejected");
    expect(after!.verification.identity.status).toBe("approved");
  });

  it("refuses a rejected level with no note", async () => {
    const vendor = await applyAsA();
    await expect(
      vendorService.decideVerification(
        String(vendor._id),
        { level: "business", outcome: "rejected", documentHashes: [] },
        { ...STAFF_ACTOR },
      ),
    ).rejects.toThrow(errors.ValidationError);
  });
});

/* ────────────────────────────────────────────── membership */

describe("team membership", () => {
  const invite = async (vendorId: string, email: string) =>
    memberService.invite(
      vendorId,
      { email, role: "member" },
      { type: "vendor", userId: USER_A, vendorId },
    );

  const acceptedBy = (id: string, user: { id: string; email: string; verified?: boolean }) =>
    memberService.acceptInvitation(id, {
      id: user.id,
      email: user.email,
      emailVerified: user.verified ?? true,
    });

  it("attaches the membership on acceptance and closes the invitation", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");

    const member = await acceptedBy(String(invitation._id), {
      id: USER_B,
      email: "b@northwind.test",
    });

    expect(member.role).toBe("member");
    expect(member.status).toBe("active");

    const closed = await vendors.VendorInvitation.findById(invitation._id).lean();
    expect(closed!.status).toBe("accepted");
  });

  it("refuses acceptance by a different address than the one invited", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");

    await expect(
      acceptedBy(String(invitation._id), { id: USER_C, email: "c@elsewhere.test" }),
    ).rejects.toThrow(errors.ForbiddenError);
  });

  it("refuses acceptance on an unverified email", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");

    // §75, and more so here: a member is one promotion away from the payout account.
    await expect(
      acceptedBy(String(invitation._id), {
        id: USER_B,
        email: "b@northwind.test",
        verified: false,
      }),
    ).rejects.toThrow(errors.ForbiddenError);
  });

  it("refuses an expired invitation", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");

    await vendors.VendorInvitation.updateOne(
      { _id: invitation._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await expect(
      acceptedBy(String(invitation._id), { id: USER_B, email: "b@northwind.test" }),
    ).rejects.toThrow(errors.ValidationError);
  });

  it("hides an expired invitation from the accept page entirely", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");
    await vendors.VendorInvitation.updateOne(
      { _id: invitation._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    // A link that has been spent looks exactly like one that never existed.
    expect(await memberService.findOpenInvitation(String(invitation._id))).toBeNull();
  });

  it("cannot be accepted twice", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");
    await acceptedBy(String(invitation._id), { id: USER_B, email: "b@northwind.test" });

    await expect(
      acceptedBy(String(invitation._id), { id: USER_B, email: "b@northwind.test" }),
    ).rejects.toThrow();

    const members = await vendors.VendorMember.countDocuments({ userId: USER_B });
    expect(members).toBe(1);
  });

  it("refuses to invite somebody who already belongs to another vendor", async () => {
    const vendorA = await applyAsA();
    const vendorB = await vendorService.apply(
      { ...APPLICATION, displayName: "Southwind" },
      { id: USER_B },
    );

    await expect(invite(String(vendorA._id), "b@northwind.test")).rejects.toThrow(
      errors.ConflictError,
    );
    expect(String(vendorB._id)).not.toBe(String(vendorA._id));
  });

  it("refuses to remove the last owner", async () => {
    const vendor = await applyAsA();
    const [owner] = await vendors.VendorMember.find({ vendorId: vendor._id }).lean();

    await expect(
      memberService.revokeMember(String(vendor._id), String(owner!._id), STAFF_ACTOR),
    ).rejects.toThrow(errors.ValidationError);
  });

  it("revokes rather than deletes, so who had access survives", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");
    const member = await acceptedBy(String(invitation._id), {
      id: USER_B,
      email: "b@northwind.test",
    });

    await memberService.revokeMember(String(vendor._id), String(member._id), STAFF_ACTOR);

    const after = await vendors.VendorMember.findById(member._id).lean();
    expect(after).not.toBeNull();
    expect(after!.status).toBe("revoked");
  });

  /**
   * One action, because the intermediate states — two owners, or none — are each a
   * bug somebody would otherwise have to clean up by hand.
   */
  it("transfers ownership without ever having two owners or none", async () => {
    const vendor = await applyAsA();
    const vendorId = String(vendor._id);
    const invitation = await invite(vendorId, "b@northwind.test");
    const member = await acceptedBy(String(invitation._id), {
      id: USER_B,
      email: "b@northwind.test",
    });

    await memberService.transferOwnership(vendorId, String(member._id), USER_A, STAFF_ACTOR);

    const owners = await vendors.VendorMember.find({
      vendorId: vendor._id,
      role: "owner",
    }).lean();
    expect(owners).toHaveLength(1);
    expect(String(owners[0]!.userId)).toBe(USER_B);

    const previous = await vendors.VendorMember.findOne({
      vendorId: vendor._id,
      userId: USER_A,
    }).lean();
    expect(previous!.role).toBe("member");
  });

  it("audits a transfer with both parties named", async () => {
    const vendor = await applyAsA();
    const vendorId = String(vendor._id);
    const invitation = await invite(vendorId, "b@northwind.test");
    const member = await acceptedBy(String(invitation._id), {
      id: USER_B,
      email: "b@northwind.test",
    });

    await memberService.transferOwnership(vendorId, String(member._id), USER_A, STAFF_ACTOR);

    const row = await communication.AuditLog.findOne({
      action: "vendor_member.ownership_transferred",
    }).lean();
    expect(row!.before).toMatchObject({ ownerUserId: USER_A });
    expect(row!.after).toMatchObject({ ownerUserId: USER_B });
  });

  it("never puts a token or an invitation id in an audit row", async () => {
    const vendor = await applyAsA();
    const invitation = await invite(String(vendor._id), "b@northwind.test");

    const row = await communication.AuditLog.findOne({
      action: "vendor_member.invited",
    }).lean();
    const serialised = JSON.stringify(row);
    expect(serialised).toContain("b@northwind.test");
    expect(serialised).not.toContain(String(invitation._id));
  });
});

/* ────────────────────────────────────────────── cross-vendor isolation */

/**
 * The two-step upload's missing check, for vendor documents.
 *
 * A presigned `PUT` is issued, the browser uploads, and a second action records
 * the object. `assertKeyInPrefix` proves the key is in our bucket; it says nothing
 * about *whose* vendor it belongs to. Without the ownership check, vendor B hands
 * back a key pointing at vendor A's passport scan, has it attached to their own
 * record, and then reads it through the authorised route — which will happily serve
 * it, because by then the record says it is theirs.
 *
 * Here rather than in `storage.test.ts` because `assertVendorDocumentKey` binds to
 * the *bound* root from `storageContext()`, which needs the validated env this
 * suite already stubs.
 */
describe("cross-vendor document keys", () => {
  let storage: typeof import("@/services/storage");

  beforeAll(async () => {
    storage = await import("@/services/storage");
  });

  it("accepts a vendor's own key", () => {
    const key = storage.vendorDocumentPath(USER_A, "passport.pdf");
    expect(storage.assertVendorDocumentKey(key, USER_A)).toBe(key);
  });

  it("refuses a key belonging to another vendor", () => {
    const theirs = storage.vendorDocumentPath(USER_B, "passport.pdf");
    expect(() => storage.assertVendorDocumentKey(theirs, USER_A)).toThrow(/does not belong/i);
  });

  /**
   * In-prefix only proves it is one of ours. The bucket is shared with unrelated
   * live applications, so a key that is inside the environment root but outside this
   * vendor's branch must still be refused.
   */
  it("refuses an in-prefix key from a different branch entirely", () => {
    const productKey = storage.productMediaPath(USER_B, "shot.png");
    expect(() => storage.assertVendorDocumentKey(productKey, USER_A)).toThrow(
      /does not belong/i,
    );
  });

  it("refuses a sibling-prefix near miss", () => {
    // `vendors/{A}x/documents/` starts with `vendors/{A}` as a *string*.
    const root = storage.vendorDocumentPath(USER_A, "x.pdf").split("/vendors/")[0]!;
    const nearMiss = `${root}/vendors/${USER_A}x/documents/abc-x.pdf`;
    expect(() => storage.assertVendorDocumentKey(nearMiss, USER_A)).toThrow(/does not belong/i);
  });

  it("keeps a vendor's documents out of another vendor's list", async () => {
    const vendorA = await applyAsA();
    const vendorB = await vendorService.apply(
      { ...APPLICATION, displayName: "Southwind" },
      { id: USER_B },
    );

    await vendors.VendorDocument.create({
      vendorId: vendorA._id,
      level: "identity",
      kind: "government_id",
      storageKey: storage.vendorDocumentPath(String(vendorA._id), "id.pdf"),
      filename: "id.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      uploadedByUserId: USER_A,
      uploadedAt: new Date(),
    });

    const documentService = await import("./document-service");
    expect(await documentService.listDocuments(String(vendorA._id))).toHaveLength(1);
    // Create as A, ask as B, expect nothing.
    expect(await documentService.listDocuments(String(vendorB._id))).toHaveLength(0);
  });
});

describe("audit actor", () => {
  it("records a vendor actor as a vendor, with the vendor named", async () => {
    const vendor = await applyAsA();
    const vendorId = String(vendor._id);

    await memberService.invite(
      vendorId,
      { email: "b@northwind.test", role: "member" },
      { type: "vendor", userId: USER_A, vendorId },
    );

    const row = await communication.AuditLog.findOne({
      action: "vendor_member.invited",
    }).lean();
    // Not `customer` — this is the one collection that exists to be trustworthy
    // later, and a vendor acting on their own account recorded as a buyer is wrong
    // in exactly the place it matters.
    expect(row!.actorType).toBe("vendor");
    expect(String(row!.vendorId)).toBe(vendorId);
    expect(String(row!.actorUserId)).toBe(USER_A);
  });
});
