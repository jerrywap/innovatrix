import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/dates";
import { requireVendorOwner } from "@/lib/auth/dal";
import { listMembers, listPendingInvitations } from "@/services/vendors/member-service";
import { TeamManager } from "@/features/vendors/components/team-manager";

export const metadata: Metadata = { title: "Vendor team" };

/**
 * The vendor team — vendor ticket 03.
 *
 * Reachable from Settings and advertised nowhere else: not in the navigation, no
 * badge, no empty state suggesting a solo vendor ought to have colleagues. A
 * vendor is usually one person and the common case must not be walked through the
 * rare one.
 *
 * `requireVendorOwner()` rather than `requireVendorOrForbid()` — this is the
 * membership list, which is one of the three things only the owner touches.
 */
export default async function Page() {
  const { vendorId, user } = await requireVendorOwner();

  const [members, invitations] = await Promise.all([
    listMembers(vendorId),
    listPendingInvitations(vendorId),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who else can act for this vendor account."
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Settings", href: "/dashboard/selling/settings" },
          { label: "Team" },
        ]}
      />

      <TeamManager
        members={members.map((member) => ({
          id: member.id,
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          status: member.status,
          isYou: member.userId === user.id,
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: formatDateTime(invitation.expiresAt),
        }))}
      />
    </div>
  );
}
