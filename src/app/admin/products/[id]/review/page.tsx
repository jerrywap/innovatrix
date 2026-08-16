import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { PRODUCT_TRANSITIONS, nextStates } from "@/lib/db/states";
import { loadWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";
import { PublishPanel } from "@/features/products/components/publish-panel";

export const metadata: Metadata = { title: "Review" };

/**
 * The last step — §46.
 *
 * The states offered come from the ticket-02 transition map, so the UI cannot
 * present a move the service would refuse. The service still calls
 * `assertTransition` itself: this form is one caller, and a direct POST is
 * another.
 */
export default async function ReviewPage({ params }: PageProps<"/admin/products/[id]/review">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product, readiness } = await loadWizardProduct(id);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="review" />
      <PublishPanel
        productId={product.id}
        status={product.status}
        nextStates={nextStates(PRODUCT_TRANSITIONS, product.status)}
        gaps={readiness.gaps}
      />
    </div>
  );
}
