import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";

export const metadata: Metadata = { title: "Review" };

/**
 * The last step — **read-only**, exactly as vendor ticket 04 specifies.
 *
 * A vendor does not publish. They move a product to `submitted` and a staff reviewer
 * takes it from there, which is vendor ticket 05's edge — so this page shows what is
 * left to do and nothing else until that ticket adds the submit control.
 *
 * The gaps come from the same `computeReadiness()` call the staff publish gate uses,
 * which is what makes "why can't I submit" answerable without a support thread: a
 * vendor sees the same checklist a reviewer does, and each gap links to the step that
 * fixes it.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/review">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product, readiness } = await loadVendorWizardProduct(id, vendorId);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="review" />

      <div className="border-border flex flex-col gap-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            {readiness.isPublishable ? "Ready to submit" : "Not ready yet"}
          </h2>
          <StatusBadge status={product.status} />
        </div>

        {readiness.gaps.length > 0 ? (
          <>
            <p className="text-muted-foreground text-[13px]">
              Each of these links to the step that fixes it. A reviewer sees the same list.
            </p>
            <ReadinessGaps gaps={readiness.gaps} productId={product.id} surface="vendor" />
          </>
        ) : (
          <p className="text-muted-foreground text-[13px]">
            Everything a reviewer checks is in place.
          </p>
        )}

        <p className="text-subtle border-border border-t pt-4 text-[12.5px] leading-relaxed">
          You do not publish your own products. When you submit, somebody here reads it and
          either puts it on sale or tells you what to change. Submitting is the next piece of
          work on this workspace.
        </p>
      </div>
    </div>
  );
}
