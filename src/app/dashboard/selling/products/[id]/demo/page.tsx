import type { Metadata } from "next";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { DemoForm } from "@/features/products/components/demo-form";
import { StepHeading } from "@/features/products/components/step-heading";
import { saveVendorDemoAction } from "@/features/vendors/product-actions";

export const metadata: Metadata = { title: "Demo" };

/**
 * Demo configuration, on the vendor surface — vendor ticket 04.
 *
 * `loadVendorWizardProduct` returns `AdminProductView`, which has **no credentials
 * field at all** — only roles and a `hasPassword` flag. That is what keeps ciphertext
 * out of this page's RSC payload here exactly as on the staff surface: not a decision
 * made in the form, but the absence of anything to send.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/demo">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="demo" />
      <DemoForm
        product={product}
        nextHref={stepHref(product.id, "testing", "vendor")}
        action={saveVendorDemoAction}
      />
    </div>
  );
}
