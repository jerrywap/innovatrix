import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireVendorOwner } from "@/lib/auth/dal";
import { ProfileForm } from "@/features/vendors/components/profile-form";
import { AgreementNotice } from "@/features/vendors/components/agreement-notice";
import { PayoutAccountForm } from "@/features/vendors/components/payout-account-form";
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
          /*
           * Straight off the record, **not** through `loadVendorProfile` — that one
           * applies staff visibility, and a vendor whose cover has been hidden must
           * still see it in the control that sets it. Hiding it on the storefront and
           * blanking the field are different things; the second reads as data loss.
           */
          coverUrl: vendor.profile.coverUrl ?? "",
          logoUrl: vendor.profile.logoUrl ?? "",
        }}
        slug={vendor.slug}
      />

      {/*
        Vendor ticket 09. On this page because it is owner-only and this page already is —
        and the masking happens here rather than in the component, so the full account number
        never crosses the RSC boundary at all.
      */}
      <section className="border-border border-t pt-6">
        <PayoutAccountForm
          account={{
            ...(vendor.payout?.accountName ? { accountName: vendor.payout.accountName } : {}),
            ...(vendor.payout?.bankName ? { bankName: vendor.payout.bankName } : {}),
            ...(vendor.payout?.country ? { country: vendor.payout.country } : {}),
            ...(vendor.payout?.accountIdentifier
              ? { masked: mask(vendor.payout.accountIdentifier) }
              : {}),
          }}
          verificationStatus={vendor.verification.business.status}
        />
      </section>

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

/**
 * Last four characters only.
 *
 * Done here, on the server, so the full identifier is never in the payload — a masked value
 * computed in a client component would have to be sent the whole thing first.
 */
function mask(identifier: string): string {
  const trimmed = identifier.replace(/\s+/g, "");
  return trimmed.length <= 4 ? "••••" : `••••${trimmed.slice(-4)}`;
}
