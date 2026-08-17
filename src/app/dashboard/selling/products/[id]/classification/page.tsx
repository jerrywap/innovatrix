import type { Metadata } from "next";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadTaxonomyOptions, loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { ClassificationForm } from "@/features/products/components/classification-form";
import { StepHeading } from "@/features/products/components/step-heading";
import { saveVendorClassificationAction } from "@/features/vendors/product-actions";

export const metadata: Metadata = { title: "Classification" };

/**
 * Classification, on the vendor surface — vendor ticket 04.
 *
 * Its action is the one that re-derives `products.facets`, which on this surface has
 * to preserve the `vend:` term as well as the taxonomy ones. That is handled in
 * `saveClassification`, which reads the vendor slug from the document rather than
 * trusting the caller — see the comment there for why nothing else would survive.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/classification">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const [{ product }, options] = await Promise.all([
    loadVendorWizardProduct(id, vendorId),
    loadTaxonomyOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="classification" />
      <ClassificationForm
        product={product}
        options={options}
        nextHref={stepHref(product.id, "content", "vendor")}
        action={saveVendorClassificationAction}
      />
    </div>
  );
}
