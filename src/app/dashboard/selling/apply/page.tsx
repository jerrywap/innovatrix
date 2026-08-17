import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireVendorOrNull, requireVerifiedUser } from "@/lib/auth/dal";
import { VENDOR_AGREEMENT_VERSION } from "@/services/vendors/vendor-service";
import { ApplyForm } from "@/features/vendors/components/apply-form";

export const metadata: Metadata = { title: "Sell on Innovatrix" };

/**
 * Applying to become a vendor — vendor ticket 01.
 *
 * **Authenticated, not public.** The applicant is already a signed-up user: they
 * have an email the platform has verified, a user id for the owner membership to
 * hang off, and a session to audit the agreement acceptance against. A public form
 * would collect an identity the platform already holds and then have to reconcile
 * the two. `/sell` is the public page in front of this, and it is content.
 *
 * `requireVerifiedUser` throws `ForbiddenError` for an unverified address, which
 * reaches `error.tsx`. That is the right shape here rather than `forbidden()`: the
 * fix is "confirm your email", which the dashboard already nags about, and a 403
 * page would read as "you may never do this".
 */
export default async function Page() {
  const user = await requireVerifiedUser();

  // Already a vendor? The application is behind them. Sending them to the
  // overview is the useful answer; a refusal would be technically correct and
  // unhelpful.
  const existing = await requireVendorOrNull();
  if (existing) redirect("/dashboard/selling");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Sell on Innovatrix"
        description="Tell us who you are and what you build. Somebody reads every application."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sell" }]}
      />

      <ApplyForm defaultEmail={user.email} agreementVersion={VENDOR_AGREEMENT_VERSION} />
    </div>
  );
}
