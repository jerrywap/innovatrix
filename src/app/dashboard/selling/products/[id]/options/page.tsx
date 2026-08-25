import type { Metadata } from "next";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { OptionsForm } from "@/features/products/components/options-form";
import { StepHeading } from "@/features/products/components/step-heading";
import { saveVendorOptionsAction } from "@/features/vendors/product-actions";

export const metadata: Metadata = { title: "Options" };

/**
 * Options, on the vendor surface — vendor ticket 04.
 *
 * The same form component staff use, with this surface's action and this vendor's
 * scope. Each step guards itself: a layout does not re-run on every navigation, and
 * the action behind this form is a public POST regardless.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/options">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="options" />
      <OptionsForm
        product={product}
        nextHref={stepHref(product.id, "seo", "vendor")}
        action={saveVendorOptionsAction}
      />
    </div>
  );
}
