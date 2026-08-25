import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { OptionsForm } from "@/features/products/components/options-form";

export const metadata: Metadata = { title: "Options" };

export default async function Page({ params }: PageProps<"/admin/products/[id]/options">) {
  // Each step guards itself. A layout does not re-run on every navigation, and
  // the action behind this form is a public POST regardless.
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="options" />
      <OptionsForm product={product} nextHref={stepHref(product.id, "seo")} />
    </div>
  );
}
