import { connectToDatabase } from "@/lib/db/client";
import { Notification } from "@/lib/db/models/communication";
import { Organization, User } from "@/lib/db/models/identity";
import { dispatch, unreadCount } from "@/services/notifications/notification-service";

/**
 * `tsx --conditions=react-server --env-file=.env.local scripts/notify-probe.ts`
 *
 * Fires two real events against the dev database and prints who was told.
 *
 * The point is the half a unit test cannot check: that audience resolution
 * finds the actual seeded people, that the staff-by-permission query returns
 * the roles you expect, and that the dev email transport writes something
 * readable to `.dev-emails/`.
 */

async function main() {
  await connectToDatabase();

  const org = await Organization.findOne({ slug: "brightpath-care" }).lean<{
    _id: unknown;
    name: string;
  }>();
  if (!org) throw new Error("Run `npm run db:seed` first.");

  const organizationId = String(org._id);
  const before = await Notification.countDocuments({});

  console.log(`\norganisation: ${org.name}`);

  // A billing notice: owner/admin/billing only, and essential so preferences
  // cannot suppress it.
  const invoice = await dispatch(
    "InvoiceIssued",
    {
      invoiceId: "6a81ee79d6799890fc6487ee",
      reference: "INV-2026-9001",
      organizationId,
      portion: "deposit",
      total: 540_000,
      currency: "GBP",
    },
    { organizationId },
  );

  // A staff queue notice: everybody holding `request.view_all`.
  const work = await dispatch(
    "WorkReadyToStart",
    {
      requestId: "000000000000000000000001",
      reference: "REQ-2026-9002",
      organizationId,
      quoteId: "000000000000000000000002",
      invoiceId: "6a81ee79d6799890fc6487ee",
    },
    { organizationId },
  );

  console.log(`InvoiceIssued    → ${invoice.written} written, ${invoice.skipped} skipped`);
  console.log(`WorkReadyToStart → ${work.written} written, ${work.skipped} skipped`);

  const rows = await Notification.find({})
    .sort({ createdAt: -1 })
    .limit(before + 20)
    .lean<
      Array<{
        recipientUserId: unknown;
        title: string;
        href?: string;
        category: string;
        emailSentAt?: Date;
      }>
    >();

  console.log("\nrecipients:");
  for (const row of rows.slice(0, 10)) {
    const user = await User.findById(row.recipientUserId)
      .select({ email: 1, isStaff: 1 })
      .lean<{ email: string; isStaff: boolean }>();
    console.log(
      `  ${user?.isStaff ? "staff " : "cust  "} ${user?.email ?? "?"}` +
        `\n         ${row.title}\n         ${row.href} · ${row.category}` +
        ` · email ${row.emailSentAt ? "sent" : "NOT sent"}`,
    );
  }

  const amara = await User.findOne({ email: "amara@brightpath.test" }).lean<{ _id: unknown }>();
  if (amara) console.log(`\namara unread: ${await unreadCount(String(amara._id))}`);

  // Re-fire the first one. The dedupe index should make this a no-op.
  const again = await dispatch(
    "InvoiceIssued",
    {
      invoiceId: "6a81ee79d6799890fc6487ee",
      reference: "INV-2026-9001",
      organizationId,
      portion: "deposit",
      total: 540_000,
      currency: "GBP",
    },
    { organizationId },
  );
  console.log(`\nre-fired InvoiceIssued → ${again.written} written, ${again.skipped} skipped`);

  process.exit(0);
}

void main();
