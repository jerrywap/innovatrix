import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { TestingForm } from "@/features/products/components/testing-form";
import { StepHeading } from "@/features/products/components/step-heading";
import { saveVendorTestingAction } from "@/features/vendors/product-actions";
import { products } from "@/repositories/product.repository";
import { checklistFor } from "@/services/catalog/testing-service";

export const metadata: Metadata = { title: "Testing" };

/**
 * The §47 checklist, on the vendor surface — vendor ticket 04.
 *
 * Reads the document rather than the view, because `checklistFor` merges in any §47
 * item added since this product was created. A product drafted before an item was
 * added would otherwise never be asked about it and would clear the gate without it.
 *
 * The read is **scoped** — `findScoped`, not `findById` — so this page cannot become
 * a way to read another vendor's checklist, and the 404 is indistinguishable from a
 * product that does not exist.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/testing">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);

  const doc = await products.findScoped(id, { vendorId });
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
        nextHref={stepHref(product.id, "seo", "vendor")}
        action={saveVendorTestingAction}
      />
    </div>
  );
}
