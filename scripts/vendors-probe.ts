/**
 * The vendor lifecycle, end to end, against the configured database.
 *
 *   npm run vendors:probe
 *
 * Vendor tickets 01–03. The integration suite proves the same rules against an
 * ephemeral replica set; this runs them against the database the dev server
 * actually reads, so the screens can be opened afterwards and looked at. That is
 * the gap it fills — a test can assert a status field, and only a person can tell
 * you the status screen reads like a sentence.
 *
 * Idempotent: it removes the vendor it made last time before making a new one, so
 * it can be re-run while iterating on the screens.
 */
import "dotenv/config";

const SEED_EMAIL = "amara@brightpath.test";

async function main() {
  const { connectToDatabase } = await import("@/lib/db/client");
  const { User } = await import("@/lib/db/models/identity");
  const { Vendor, VendorMember, VendorInvitation } = await import("@/lib/db/models/vendors");
  const vendorService = await import("@/services/vendors/vendor-service");
  const memberService = await import("@/services/vendors/member-service");

  const pass = (m: string) => console.log(`  ✓ ${m}`);
  const fail = (m: string) => {
    console.log(`  ✗ ${m}`);
    process.exitCode = 1;
  };

  await connectToDatabase();

  const user = await User.findOne({ email: SEED_EMAIL }).lean<{
    _id: unknown;
    name?: string;
  }>();
  if (!user) {
    console.error(`No seeded user ${SEED_EMAIL}. Run \`npm run db:seed\` first.`);
    process.exit(1);
  }
  const userId = String(user._id);

  // Clean up the previous run.
  for (const member of await VendorMember.find({ userId }).lean()) {
    await VendorInvitation.deleteMany({ vendorId: member.vendorId });
    await Vendor.deleteOne({ _id: member.vendorId });
  }
  await VendorMember.deleteMany({ userId });

  console.log(`applicant : ${SEED_EMAIL}\n`);

  /* 1. apply */
  const vendor = await vendorService.apply(
    {
      displayName: "Brightpath Tools",
      contactEmail: SEED_EMAIL,
      country: "GB",
      pitch:
        "We build lightweight inventory and dispatch tooling for independent " +
        "distributors, mostly PHP and Postgres, biased toward things that run on " +
        "cheap hosting.",
    },
    { id: userId, ...(user.name ? { name: user.name } : {}) },
  );
  const id = String(vendor._id);

  vendor.status === "applied"
    ? pass(`applied — slug ${vendor.slug}`)
    : fail(`expected applied, got ${vendor.status}`);

  vendor.agreement?.version
    ? pass(`agreement ${vendor.agreement.version} recorded against the applicant`)
    : fail("no agreement recorded");

  /* 2. the owner membership exists, because a vendor without one is unrepairable */
  const members = await VendorMember.find({ vendorId: vendor._id }).lean();
  members.length === 1 && members[0]!.role === "owner" && members[0]!.status === "active"
    ? pass("owner membership created in the same transaction")
    : fail(`expected one active owner, got ${JSON.stringify(members.map((m) => m.role))}`);

  /* 3. one vendor per person */
  try {
    await vendorService.apply(
      {
        displayName: "Second Go",
        contactEmail: SEED_EMAIL,
        country: "GB",
        pitch: "x".repeat(50),
      },
      { id: userId },
    );
    fail("a second vendor was allowed for the same person");
  } catch {
    pass("a second vendor for the same person is refused");
  }

  /* 4. the verification gate on `verified` */
  await vendorService.transition(id, "in_review", staff(userId));
  pass("moved to in_review");

  try {
    await vendorService.transition(id, "verified", staff(userId));
    fail("verified without identity approval — the listing gate is open");
  } catch {
    pass("cannot verify before identity is approved");
  }

  await vendorService.decideVerification(
    id,
    { level: "identity", outcome: "approved", documentHashes: ["probe-hash"] },
    { ...staff(userId) },
  );
  pass("identity approved");

  const verified = await vendorService.transition(id, "verified", staff(userId));
  verified.status === "verified" && verified.verifiedAt
    ? pass("verified, and the date is stamped")
    : fail("verification did not complete");

  /* 5. an invitation, and the wrong-recipient refusal */
  const invitation = await memberService.invite(
    id,
    { email: "someone-else@example.test", role: "member" },
    { type: "vendor", userId, vendorId: id },
  );
  pass(`invitation created, expires ${invitation.expiresAt.toISOString()}`);

  try {
    await memberService.acceptInvitation(String(invitation._id), {
      id: userId,
      email: SEED_EMAIL,
      emailVerified: true,
    });
    fail("an invitation was accepted by the wrong address");
  } catch {
    pass("an invitation cannot be accepted by a different address");
  }

  console.log(
    [
      "",
      `vendor id : ${id}`,
      "",
      "Now look at these while signed in as the applicant:",
      "  /dashboard/selling              — the overview, with a Selling group in the nav",
      "  /dashboard/selling/verification — identity approved, business outstanding",
      "  /dashboard/selling/settings     — profile, with the slug fixed",
      "  /dashboard/selling/team         — the invitation waiting to be accepted",
      "",
      "And as market@innovatrix.test:",
      `  /staff/vendor-applications/${id}`,
      "",
      process.exitCode ? "PROBE FAILED" : "probe complete — all checks passed",
    ].join("\n"),
  );

  process.exit(process.exitCode ?? 0);
}

/** A staff actor. The probe has no staff session, so it borrows the applicant's id. */
function staff(userId: string) {
  return { type: "staff" as const, userId, name: "Probe" };
}

main().catch((e) => {
  console.error("\nprobe error:", e);
  process.exit(1);
});
