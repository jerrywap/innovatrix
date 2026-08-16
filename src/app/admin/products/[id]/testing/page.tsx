import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { products } from "@/repositories/product.repository";
import { notFound } from "next/navigation";
import { checklistFor } from "@/services/catalog/testing-service";
import { loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { TestingForm } from "@/features/products/components/testing-form";

export const metadata: Metadata = { title: "Testing" };

/**
 * The §47 checklist.
 *
 * Reads the document rather than the view, because `checklistFor` merges in any
 * §47 item added since this product was created. A product drafted before
 * "Payment integrations" was added to the list would otherwise never be asked
 * about it and would pass the gate without it.
 */
export default async function Page({ params }: PageProps<"/admin/products/[id]/testing">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);

  await connectToDatabase();
  const doc = await products.findById(id);
  if (!doc) notFound();

  const checklist = checklistFor(doc).map((item) => ({
    item: item.item,
    status: item.status,
    ...(item.notes ? { notes: item.notes } : {}),
    ...(item.checkedAt ? { checkedAt: new Date(item.checkedAt).toISOString() } : {}),
  }));

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="testing" />
      <TestingForm
        product={product}
        checklist={checklist}
        nextHref={stepHref(product.id, "seo")}
      />
    </div>
  );
}
