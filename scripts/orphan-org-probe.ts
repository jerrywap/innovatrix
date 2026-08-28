/**
 * Who is signed up but has no organization — §76.
 *
 *   npm run auth:orphan-probe
 *
 * Every customer is supposed to get an organization at signup. For a long time
 * exactly one code path created one — `registerAction` — and Google never
 * reached it: OAuth completes inside Better Auth's own `/api/auth/callback/
 * google`, with no action of ours in the path. So every Google signup produced a
 * user with no membership, and `/dashboard` told them their account "isn't set
 * up yet, which shouldn't happen".
 *
 * The hook in `auth.ts` now creates one at session creation, which heals anybody
 * affected the next time they sign in. This answers the question that fix leaves
 * open: **who is affected right now, and will they heal on their own?**
 *
 * Read-only. It writes nothing, so it is safe against production. The repair is
 * the "Finish setting up" button on the dashboard's own screen — see
 * `repairMissingOrganization`.
 *
 * The categories matter because they heal differently:
 *
 * | Category | Heals by |
 * |---|---|
 * | staff | nothing to heal — staff correctly have no organization |
 * | social, no live session | signing in again; the hook fires at session creation |
 * | social, live session | the button, or signing out and back in |
 * | credential only | the button. `registerAction` failed after creating the user |
 * | no account row at all | the button. A callback that died between two writes |
 *
 * Only the first row is fine to leave alone.
 */
import "dotenv/config";

interface Row {
  email: string;
  category: string;
  created: string;
  liveSession: boolean;
}

async function main() {
  const { connectToDatabase } = await import("@/lib/db/client");
  const mongoose = (await import("mongoose")).default;

  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connecting.");

  const users = db.collection("users");
  const accounts = db.collection("accounts");
  const sessions = db.collection("sessions");

  const total = await users.countDocuments();

  /*
   * `$lookup` rather than a distinct-then-filter: the membership collection is
   * the authority on "has an organization", and doing it in the server keeps
   * this to one round trip on a database that may hold a lot of users.
   */
  const orphans = await users
    .aggregate<{ _id: unknown; email?: string; isStaff?: boolean; createdAt?: Date }>([
      {
        $lookup: {
          from: "organizationMembers",
          localField: "_id",
          foreignField: "userId",
          as: "membership",
        },
      },
      { $match: { membership: { $size: 0 } } },
      { $project: { email: 1, isStaff: 1, createdAt: 1 } },
      { $sort: { createdAt: 1 } },
    ])
    .toArray();

  const now = new Date();
  const rows: Row[] = [];

  for (const user of orphans) {
    const providers = await accounts.distinct("providerId", { userId: user._id });
    const social = providers.filter((p) => p !== "credential");

    // Unexpired only. An expired row is not what keeps somebody stuck — the hook
    // fires on their next sign-in, which is exactly what an expired session
    // forces.
    const liveSession =
      (await sessions.countDocuments(
        { userId: user._id, expiresAt: { $gt: now } },
        { limit: 1 },
      )) > 0;

    const category = user.isStaff
      ? "staff"
      : social.length > 0
        ? `social (${social.join(", ")})`
        : providers.length > 0
          ? "credential only"
          : "no account row";

    rows.push({
      email: String(user.email ?? "—"),
      category,
      created: user.createdAt ? user.createdAt.toISOString().slice(0, 10) : "—",
      liveSession,
    });
  }

  const affected = rows.filter((r) => r.category !== "staff");
  const selfHealing = affected.filter((r) => r.category.startsWith("social") && !r.liveSession);
  const needsButton = affected.filter((r) => !selfHealing.includes(r));

  console.log(`\n  users: ${total}`);
  console.log(`  without an organization: ${rows.length}`);
  console.log(`  of those, staff (expected): ${rows.length - affected.length}`);
  console.log(`  genuinely affected: ${affected.length}\n`);

  if (affected.length === 0) {
    console.log("  ✓ Nobody is stuck.\n");
  } else {
    console.table(
      affected.map((r) => ({
        email: r.email,
        category: r.category,
        created: r.created,
        "live session": r.liveSession ? "yes" : "no",
      })),
    );
    console.log(`\n  ${selfHealing.length} will heal on their next sign-in, unprompted.`);
    console.log(
      `  ${needsButton.length} need the "Finish setting up" button, or to sign out first.\n`,
    );
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
