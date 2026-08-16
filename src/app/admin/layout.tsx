import { AccountMenu } from "@/components/shell/account-menu";
import { AppShell } from "@/components/shell/app-shell";
import { requireAnyPermissionOrRedirect } from "@/lib/auth/dal";
import { ADMIN_PERMISSIONS, adminNavFor } from "@/lib/navigation";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Admin area — §4.
 *
 * Guarded by `requireAnyPermission(ADMIN_PERMISSIONS)` rather than a role
 * check. §77 is explicit that there is no universal admin flag, so "may enter
 * the admin area" is defined as *holding at least one permission that opens a
 * screen in it* — a list derived from the navigation itself, so the two can
 * never disagree.
 *
 * The consequence is deliberate: someone with only `system.manage_jobs` gets in
 * and sees Jobs and nothing else. The nav filter and the per-page DAL calls do
 * the rest.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, permissions } = await requireAnyPermissionOrRedirect(ADMIN_PERMISSIONS);

  return (
    <AppShell
      density="dense"
      sections={adminNavFor(permissions)}
      homeHref="/admin"
      contextLabel="Admin"
      topBarEnd={<AccountMenu name={user.name} email={user.email} isStaff />}
    >
      {children}
    </AppShell>
  );
}
