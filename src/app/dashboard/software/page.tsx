import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrg } from "@/lib/auth/dal";
import { listOwnedSoftware } from "@/services/entitlements/entitlement-service";
import { SoftwareCard } from "@/features/software/components/software-card";
import { PURCHASES_LABEL } from "@/lib/navigation";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { tipOfferFor } from "@/services/tips/tip-service";

export const metadata: Metadata = { title: PURCHASES_LABEL };

/**
 * My Purchases — §29.
 *
 * The long-term relationship between a customer and what they bought, and the
 * anchor for every §105 upsell. Scoped to the **active organisation** through
 * `requireOrg`, so switching organisations changes the list — the repository
 * refuses to build the query without a scope, which is what makes that a fact
 * rather than a convention.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={PURCHASES_LABEL}
        description="What you own, what's included, and what's new since you bought it."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Owned />
      </Suspense>
    </div>
  );
}

async function Owned() {
  const { organizationId } = await requireOrg();
  const owned = await listOwnedSoftware(organizationId);

  if (owned.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Nothing here yet"
        description="Software you buy shows up here, with your licence keys, downloads and updates."
        action={
          <Link
            href="/marketplace"
            className="bg-foreground text-background rounded-full px-4 py-2 text-[13px] font-medium"
          >
            Browse the marketplace
          </Link>
        }
      />
    );
  }

  /*
   * The tip offer, resolved **once per vendor** rather than once per card.
   *
   * A library of twenty products from two vendors is two commission lookups, not
   * twenty — the same reasoning as `listOwnedSoftware`'s four bulk queries a few
   * lines above, and the reason the card is handed the answer instead of asking
   * for it.
   *
   * A vendor whose rate cannot be resolved simply gets no button; a tip screen
   * that cannot state the split honestly should not be shown at all.
   */
  const currency = await resolveStorefrontCurrency();
  const vendors = new Map(
    owned
      .map((item) => item.product.vendor)
      .filter((vendor): vendor is { id: string; name: string } => !!vendor)
      .map((vendor) => [vendor.id, vendor.name]),
  );
  const offers = new Map(
    await Promise.all(
      [...vendors].map(
        async ([id, name]) =>
          [id, await tipOfferFor({ vendorId: id, vendorName: name, currency })] as const,
      ),
    ),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {owned.map((entitlement) => {
        const vendorId = entitlement.product.vendor?.id;
        const offer = vendorId ? offers.get(vendorId) : undefined;

        return (
          <SoftwareCard
            key={entitlement.id}
            entitlement={entitlement}
            {...(offer
              ? {
                  tip: {
                    currency: offer.currency,
                    options: offer.options,
                    commissionBasisPoints: offer.commissionBasisPoints,
                  },
                }
              : {})}
          />
        );
      })}
    </div>
  );
}
