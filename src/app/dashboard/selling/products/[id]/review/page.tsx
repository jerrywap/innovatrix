import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";
import { SubmitPanel } from "@/features/vendors/components/submit-panel";
import { TemplateSiblingPanel } from "@/features/products/components/template-sibling-panel";
import { stepHref } from "@/features/products/steps";
import {
  createVendorTemplateSiblingAction,
  unlinkVendorTemplateSiblingAction,
} from "@/features/vendors/product-actions";
import { ReviewHistory } from "@/features/vendors/components/review-history";
import { products } from "@/repositories/product.repository";
import { toVendorReviewNotes } from "@/services/catalog/product-view";
import { ATTESTATION_TEXT } from "@/services/catalog/review-service";

export const metadata: Metadata = { title: "Review" };

/**
 * The last step — vendor ticket 05.
 *
 * A vendor does not publish. They move a product to `submitted` and a reviewer takes
 * it from there, so this page has one control and a history rather than a publish
 * panel.
 *
 * The gaps come from the same `computeReadiness()` call the staff publish gate uses,
 * which is what makes "why can't I submit" answerable without a support thread: a
 * vendor sees the same checklist a reviewer does, and each gap links to the step that
 * fixes it.
 *
 * ## Why the document is read again
 *
 * `loadVendorWizardProduct` returns `AdminProductView`, which has no `reviewNotes` —
 * and it should not gain them, because the same view feeds the staff wizard where the
 * internal notes are readable. So the notes come from the document through
 * `toVendorReviewNotes()`, which is the projection that **cannot** carry
 * `internalNote`. The read is scoped, so this is not a way to read another vendor's
 * feedback.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/review">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product, readiness } = await loadVendorWizardProduct(id, vendorId);

  const doc = await products.findScoped(id, { vendorId });
  if (!doc) notFound();

  // The other half of the pair, both scoped to this vendor. `findTemplateSiblingOf`
  // is not scoped itself, so the catalogue check plus the fact that the sibling was
  // created under this vendor's scope is what keeps it theirs; the link only ever
  // navigates within their own wizard.
  const sibling =
    (doc.catalogue ?? "script") === "script" ? await products.findTemplateSiblingOf(id) : null;
  const linkedScript = doc.scriptListingId
    ? await products.findScoped(String(doc.scriptListingId), { vendorId })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="review" />

      {readiness.gaps.length > 0 && (
        <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Before you submit</h2>
          <p className="text-muted-foreground text-[13px]">
            Each of these links to the step that fixes it. A reviewer sees the same list.
          </p>
          <ReadinessGaps gaps={readiness.gaps} productId={product.id} surface="vendor" />
        </div>
      )}

      <SubmitPanel
        productId={product.id}
        status={product.status}
        isPublishable={readiness.isPublishable}
        attestationText={ATTESTATION_TEXT}
      />

      <TemplateSiblingPanel
        productId={product.id}
        catalogue={doc.catalogue ?? "script"}
        licencePackageCount={doc.licencePackages.length}
        hrefFor={(productId) => stepHref(productId, "basics", "vendor")}
        action={createVendorTemplateSiblingAction}
        unlinkAction={unlinkVendorTemplateSiblingAction}
        {...(sibling
          ? {
              sibling: {
                id: String(sibling._id),
                name: sibling.name,
                slug: sibling.slug,
                status: sibling.status,
              },
            }
          : {})}
        {...(linkedScript
          ? {
              linkedScript: {
                id: String(linkedScript._id),
                name: linkedScript.name,
                slug: linkedScript.slug,
                status: linkedScript.status,
              },
            }
          : {})}
      />

      <ReviewHistory notes={toVendorReviewNotes(doc)} />
    </div>
  );
}
