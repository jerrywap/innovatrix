import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { aiUnavailableReason } from "@/features/products/ai-availability";
import { stepHref } from "@/features/products/steps";
import { BasicsForm } from "@/features/products/components/basics-form";
import { StepHeading } from "@/features/products/components/step-heading";

export const metadata: Metadata = { title: "Basics" };

export default async function BasicsPage({ params }: PageProps<"/admin/products/[id]/basics">) {
  // The layout guards the chrome; this guards the screen. Next.js does not
  // re-run a layout on every navigation, so a page cannot rely on one.
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);
  const aiUnavailable = await aiUnavailableReason();

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="basics" />
      <BasicsForm
        product={product}
        nextHref={stepHref(product.id, "classification")}
        {...(aiUnavailable ? { aiUnavailable } : {})}
      />
    </div>
  );
}
