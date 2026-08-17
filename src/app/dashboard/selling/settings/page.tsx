import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireVendorOwner } from "@/lib/auth/dal";
import { ProfileForm } from "@/features/vendors/components/profile-form";
import { AgreementNotice } from "@/features/vendors/components/agreement-notice";
import {
  VENDOR_AGREEMENT_VERSION,
  agreementIsCurrent,
} from "@/services/vendors/vendor-service";

export const metadata: Metadata = { title: "Vendor settings" };

/**
 * The vendor's own details — vendor tickets 01 and 03.
 *
 * Owner-only. A `member` may do everything about products and support, and
 * nothing about who the vendor *is* — the agreement is accepted here (vendor ticket 07),
 * and the payout account lands here in vendor ticket 09.
 *
 * The team link lives on this page and **only** on this page: it is not in the
 * navigation, carries no badge, and there is no empty-state nagging a solo vendor
 * to invite somebody. A one-person vendor can list, sell and get paid without ever
 * opening it.
 */
export default async function Page() {
  const { vendor } = await requireVendorOwner();

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader
        title="Vendor settings"
        description="How you appear to customers, and who else can act for you."
        breadcrumbs={[{ label: "Selling", href: "/dashboard/selling" }, { label: "Settings" }]}
      />

      {/*
        Vendor ticket 07. Above the profile form because it is the one thing on this screen
        that stops something happening — and below the header rather than in a banner across
        the whole workspace, because it is a settings decision the owner takes once.
      */}
      {!agreementIsCurrent(vendor) && (
        <AgreementNotice
          acceptedVersion={vendor.agreement?.version ?? null}
          currentVersion={VENDOR_AGREEMENT_VERSION}
        />
      )}

      <ProfileForm
        defaults={{
          displayName: vendor.displayName,
          contactEmail: vendor.contactEmail,
          summary: vendor.profile.summary ?? "",
          supportEmail: vendor.profile.supportEmail ?? "",
          websiteUrl: vendor.profile.websiteUrl ?? "",
        }}
        slug={vendor.slug}
      />

      <section className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div>
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Team</h2>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            Invite somebody to help with your products. Only you can change the payout account
            or these settings.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/selling/team">Manage team</Link>
        </Button>
      </section>
    </div>
  );
}
