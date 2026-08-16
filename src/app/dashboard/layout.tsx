import Link from "next/link";
import { AccountMenu } from "@/components/shell/account-menu";
import { AppShell } from "@/components/shell/app-shell";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { listUserOrganizations, requireOrg } from "@/lib/auth/dal";
import { customerNavFor } from "@/lib/navigation";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Customer shell — §4, §28.
 *
 * `requireOrg()` is the gate. It redirects a signed-out visitor to login and
 * throws for anyone whose membership has gone, and it re-reads that membership
 * on every request rather than trusting the session — which is what makes
 * "remove a member" take effect immediately.
 *
 * **The layout's check does not protect the pages under it.** Next.js does not
 * re-run a layout for every navigation, and a server action is reachable by
 * direct POST regardless of what any layout did. Each page and each action
 * calls the DAL for itself; this call is what makes the *chrome* correct.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, organization, organizationId, role } = await requireOrg();
  const organizations = await listUserOrganizations();

  return (
    <AppShell
      sections={customerNavFor(role)}
      homeHref="/dashboard"
      contextLabel={organization.isPersonal ? undefined : organization.name}
      banner={!user.emailVerified ? <VerifyEmailBanner /> : undefined}
      topBarEnd={
        <>
          <OrgSwitcher organizations={organizations} activeId={organizationId} />
          <AccountMenu name={user.name} email={user.email} isStaff={user.isStaff} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

/**
 * §75: an unverified customer may browse and may not check out. Saying so here,
 * once, beats discovering it at the payment step — and the banner is the only
 * place the difference is visible before then.
 */
function VerifyEmailBanner() {
  return (
    <div className="border-signal/25 bg-signal-soft border-t px-4 py-2.5 lg:px-8">
      <p className="text-signal-text text-[13px]">
        Confirm your email address to complete a purchase.{" "}
        <Link href="/verify-email" className="font-medium underline underline-offset-2">
          Send the link again
        </Link>
      </p>
    </div>
  );
}
