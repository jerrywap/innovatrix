import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadTaxonomyOptions, loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { ClassificationForm } from "@/features/products/components/classification-form";

export const metadata: Metadata = { title: "Classification" };

export default async function ClassificationPage({
  params,
}: PageProps<"/admin/products/[id]/classification">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const [{ product }, options] = await Promise.all([
    loadWizardProduct(id),
    loadTaxonomyOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="classification" />
      <ClassificationForm
        product={product}
        options={options}
        nextHref={stepHref(product.id, "content")}
      />
    </div>
  );
}
