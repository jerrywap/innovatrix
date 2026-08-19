import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { platformCommissionBasisPoints } from "@/services/vendors/commission-service";
import { PlatformCommissionForm } from "@/features/vendors/components/commission-form";

export const metadata: Metadata = { title: "Commission" };

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The platform commission rate — vendor ticket 07.
 *
 * ## Its own route rather than a panel on Payments setup
 *
 * The natural home looked like `/admin/settings/payments`, since `PaymentSettings` is
 * where the rate is stored. But that page is gated on `payment_provider.configure`, which
 * `marketplace_manager` does not hold — and the commission rate is a *commercial*
 * decision, so putting it there would have meant either widening that permission (giving
 * whoever sets our cut the provider configuration too) or granting a permission for a page
 * rather than for a capability. A separate route keeps each screen gated on the thing it
 * actually does.
 *
 * Guard first in this component's own body, then stream the read — the refusal is decided
 * before the first flush, so a 403 carries a 403.
 */
export default async function Page() {
  await requirePermissionOrForbid("vendor.manage_commission");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Commission" description="What CoSetup keeps on a third-party sale." />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Rate />
      </Suspense>
    </div>
  );
}

async function Rate() {
  const basisPoints = await platformCommissionBasisPoints();

  // Basis points are the storage unit; a person sets a percentage. Integer division by
  // 100 rather than a float multiply, so 3000 is 30 and not 29.999999999999996.
  return <PlatformCommissionForm percent={basisPoints / 100} />;
}
