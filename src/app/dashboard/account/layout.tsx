import { PageHeader } from "@/components/page-header";
import { requireOrgOrNull, requireUser } from "@/lib/auth/dal";
import { AccountTabs } from "@/features/account/components/account-tabs";

/**
 * The account shell — four sibling routes under one rail.
 *
 * **This guard does not protect the pages.** Next does not re-run a layout on
 * every navigation, and every action underneath is a public POST regardless. Each
 * page calls the DAL for itself and each action re-checks; this call is what makes
 * the chrome correct, exactly as the product wizard's layout says of itself.
 *
 * `requireOrgOrNull` rather than `requireOrg`: this decides whether to *draw* the
 * billing tab, and a customer with no organisation set up should see the other
 * three rather than a redirect. The billing page itself refuses with a 403.
 */
export default async function AccountLayout({ children }: LayoutProps<"/dashboard/account">) {
  const [user, org] = await Promise.all([requireUser(), requireOrgOrNull()]);

  const canSeeBilling =
    org !== null && (org.role === "owner" || org.role === "admin" || org.role === "billing");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Account" description={`Signed in as ${user.email}.`} />

      <AccountTabs canSeeBilling={canSeeBilling} />

      {children}
    </div>
  );
}
