import Link from "next/link";
import { AccountMenu } from "@/components/shell/account-menu";
import { NotificationBell } from "@/components/shell/notification-bell";
import { AppShell } from "@/components/shell/app-shell";
import { CompleteSetup } from "@/features/auth/components/complete-setup";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { redirect } from "next/navigation";
import {
  getSession,
  listUserOrganizations,
  loginDestination,
  requireOrgOrNull,
  requireVendorOrNull,
} from "@/lib/auth/dal";
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
 *
 * ## A staff member here is a wrong turn, not an error
 *
 * `requireOrg()` throws for a signed-in user with no organisation, on the
 * reasoning that every *customer* gets a personal one at registration. A
 * **staff** account has none — measured, not assumed: `super@innovatrix.test`
 * got a **500 on every page under `/dashboard`**, because a thrown
 * `ForbiddenError` from a page reaches `error.tsx` rather than becoming a 403.
 *
 * The DAL's own table says a layout should redirect on a wrong turn, and this
 * is the mirror of the redirect `/staff` already does in the other direction —
 * `/dashboard?denied=staff`. Sending them to `/staff` is the useful answer;
 * a stack trace is not.
 *
 * Two hazards, both handled rather than hoped past:
 *
 * - `requireOrgOrNull` **swallows `NEXT_REDIRECT`**, which its own comment
 *   warns is wrong in a page. Recovered here: a `null` is followed by an
 *   explicit session check, so a signed-out visitor still reaches `/login`.
 * - Redirecting *everyone* org-less to `/staff` would **loop** — a non-staff
 *   account would be bounced straight back by `requireStaffOrRedirect`. Only a
 *   staff account is sent there; anyone else gets an explanation, because for
 *   them it really is a broken signup and a redirect would hide it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await requireOrgOrNull();

  if (!context) {
    const session = await getSession();
    // `loginDestination()`, not `/login`: a *stale* cookie sent to `/login` is
    // bounced straight back here by the proxy, which guards on cookie presence
    // rather than validity — an infinite redirect. See the DAL and
    // `api/auth/stale-session`.
    if (!session) redirect(await loginDestination());
    if (session.user.isStaff) redirect("/staff");

    /*
     * Recoverable, rather than a dead end with an apology.
     *
     * Every account here reached this state the same way: §76's organization was
     * created in exactly one place, `registerAction`, and Google never reached
     * it. The hook in `auth.ts` fixes that at session creation — but somebody
     * *already holding a session* keeps a session row stamped
     * `activeOrganizationId: null` until they sign out or it expires, and this
     * screen is what they see in the meantime.
     *
     * The button is a POST. Doing the repair here, during render, would be a GET
     * that creates an organization — and Next prefetches links on hover and in
     * the viewport, so merely having a link to `/dashboard` on screen would fire
     * it. See `completeAccountSetupAction`.
     */
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="font-display text-[20px] tracking-[-0.02em]">
          Your account isn&rsquo;t set up yet
        </h1>
        <p className="text-muted-foreground text-[14px]">
          It has no organisation attached, which shouldn&rsquo;t happen. We can finish that now
          &mdash; it takes a moment and nothing you&rsquo;ve done is lost.
        </p>
        <div className="mt-2">
          <CompleteSetup />
        </div>
        <p className="text-subtle text-[12.5px]">
          If that doesn&rsquo;t work, get in touch and we&rsquo;ll sort it out.
        </p>
      </div>
    );
  }

  const { user, organization, organizationId, role } = context;
  const [organizations, vendor] = await Promise.all([
    listUserOrganizations(),
    // Vendor ticket 01: whether to draw the Vendor group, and whether it includes the
    // owner-only settings link. One indexed lookup, `cache()`d in the DAL, and *only* about
    // the chrome — the segment's own pages establish their scope for themselves and must never
    // read it from here.
    requireVendorOrNull(),
  ]);

  return (
    <AppShell
      sections={customerNavFor(role, {
        isVendor: vendor !== null,
        // Both, from the same context. A `member` sees the workspace and not the payout
        // account, which is the one capability the two-role model exists to separate.
        isVendorOwner: vendor?.role === "owner",
      })}
      contextLabel={organization.isPersonal ? undefined : organization.name}
      banner={!user.emailVerified ? <VerifyEmailBanner /> : undefined}
      topBarEnd={
        <>
          <OrgSwitcher organizations={organizations} activeId={organizationId} />
          <NotificationBell userId={user.id} href="/dashboard/notifications" />
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
