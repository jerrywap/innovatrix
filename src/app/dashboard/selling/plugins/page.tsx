import type { Metadata } from "next";
import { Suspense } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { listPending } from "@/services/checkout/provisioning-service";
import { PluginQueue } from "@/features/vendors/components/plugin-queue";

export const metadata: Metadata = { title: "Plugins" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Paid plugins somebody has bought and nobody has handed over yet.
 *
 * ## Why this screen exists at all
 *
 * A plugin is sold as an add-on and delivered *off* this platform: what the
 * customer receives is a key, a licence code, or an account on a third-party API
 * the script already talks to. So there is no artefact to attach and no download
 * to point at, and "delivered" is not something the platform can work out. This
 * is where the obligation lives until a person discharges it.
 *
 * ## The vendor is shown a line, never a customer
 *
 * There is no orders or customers screen under `/dashboard/selling`, deliberately
 * — a vendor does not learn who bought their product. So this lists **order
 * lines**, and marking one provided posts into the thread the buyer already
 * reads. The platform is the only thing that knows both halves, which is what
 * makes the mediation structural rather than a rule somebody has to remember.
 *
 * Readable and actionable by any active member, like Reviews and Support: handing
 * over a key is support work, and what the two-role model protects is the payout
 * account.
 */
export default async function Page() {
  // Guard first, before any JSX — the refusal has to be decided before the
  // first flush or the shell commits a 200.
  const { vendorId } = await requireVendorOrForbid();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plugins"
        description="Plugins customers have paid for and are waiting on. Send what each one needs, then mark it provided — what you write is what they receive."
      />

      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Queue vendorId={vendorId} />
      </Suspense>
    </div>
  );
}

async function Queue({ vendorId }: { vendorId: string }) {
  const rows = await listPending({ vendorId });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nothing waiting"
        description="When somebody buys one of your paid plugins, it appears here until you've sent them what it needs."
      />
    );
  }

  return <PluginQueue rows={rows} />;
}
