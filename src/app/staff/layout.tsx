import { AccountMenu } from "@/components/shell/account-menu";
import { NotificationBell } from "@/components/shell/notification-bell";
import { AppShell } from "@/components/shell/app-shell";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { staffNavFor } from "@/lib/navigation";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Staff console — §4, §77.
 *
 * `requireStaff()` throws for anyone without an active staff profile, so a
 * customer who types `/staff` gets a refusal rather than a shell. The proxy
 * also redirects here, but only on the presence of a session cookie — it cannot
 * tell staff from customer without a database read, and it must not do one.
 *
 * Dense by default: this is a working surface, not a marketing one. The
 * customer dashboard is comfortable because it is visited occasionally; a queue
 * is read all day.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { user, permissions, roles } = await requireStaffOrRedirect();

  return (
    <AppShell
      density="dense"
      sections={staffNavFor(permissions)}
      contextLabel="Staff"
      topBarEnd={
        <>
          <span className="text-subtle hidden text-[12px] capitalize sm:block">
            {roles.map((role) => role.replace(/_/g, " ")).join(" · ")}
          </span>
          <NotificationBell userId={user.id} href="/staff/notifications" />
          {/* No `isStaff`: the dropdown's "Staff console" link would point at
              the page you are already on. Crossing to /admin is in the sidebar. */}
          <AccountMenu name={user.name} email={user.email} isStaff={false} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
