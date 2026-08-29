import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { aiUnavailableReason } from "@/features/products/ai-availability";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { SeoForm } from "@/features/products/components/seo-form";

export const metadata: Metadata = { title: "SEO" };

export default async function Page({ params }: PageProps<"/admin/products/[id]/seo">) {
  // Each step guards itself. A layout does not re-run on every navigation, and
  // the action behind this form is a public POST regardless.
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);
  const aiUnavailable = await aiUnavailableReason();

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="seo" />
      <SeoForm
        product={product}
        nextHref={stepHref(product.id, "review")}
        {...(aiUnavailable ? { aiUnavailable } : {})}
      />
    </div>
  );
}
