import type { Metadata } from "next";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { MediaForm } from "@/features/products/components/media-form";
import { StepHeading } from "@/features/products/components/step-heading";
import { saveVendorMediaAction } from "@/features/vendors/product-actions";

export const metadata: Metadata = { title: "Media" };

/**
 * Media, on the vendor surface — vendor ticket 04.
 *
 * The same form component staff use, with this surface's action and this vendor's
 * scope. Each step guards itself: a layout does not re-run on every navigation, and
 * the action behind this form is a public POST regardless.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/media">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="media" />
      <MediaForm
        product={product}
        nextHref={stepHref(product.id, "pricing", "vendor")}
        action={saveVendorMediaAction}
      />
    </div>
  );
}
