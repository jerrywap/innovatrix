import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { DemoForm } from "@/features/products/components/demo-form";

export const metadata: Metadata = { title: "Demo" };

/**
 * Demo configuration — §9.
 *
 * `loadWizardProduct` returns `AdminProductView`, which has **no credentials
 * field at all** — only roles and a `hasPassword` flag. That is what keeps
 * ciphertext out of this page's RSC payload: not a decision made in the form,
 * but the absence of anything to send.
 */
export default async function Page({ params }: PageProps<"/admin/products/[id]/demo">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="demo" />
      <DemoForm product={product} nextHref={stepHref(product.id, "testing")} />
    </div>
  );
}
