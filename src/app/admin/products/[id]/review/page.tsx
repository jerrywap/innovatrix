import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { PRODUCT_TRANSITIONS, nextStates } from "@/lib/db/states";
import { loadWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";
import { PublishPanel } from "@/features/products/components/publish-panel";
import { TemplateSiblingPanel } from "@/features/products/components/template-sibling-panel";
import { stepHref } from "@/features/products/steps";
import { products } from "@/repositories/product.repository";

export const metadata: Metadata = { title: "Review" };

/**
 * The last step — §46.
 *
 * The states offered come from the ticket-02 transition map, so the UI cannot
 * present a move the service would refuse. The service still calls
 * `assertTransition` itself: this form is one caller, and a direct POST is
 * another.
 */
export default async function ReviewPage({ params }: PageProps<"/admin/products/[id]/review">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product, readiness } = await loadWizardProduct(id);

  /*
   * The other half of the pair, whichever half this is.
   *
   * One indexed read each way and only on an authoring screen, so no `<Suspense>`:
   * the guard above has already resolved and there is no `loading.tsx` over this
   * segment to flush a shell early.
   */
  const sibling =
    product.catalogue === "script" ? await products.findTemplateSiblingOf(product.id) : null;
  const linkedScript = product.scriptListingId
    ? await products.findById(product.scriptListingId)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="review" />
      <PublishPanel
        productId={product.id}
        status={product.status}
        nextStates={nextStates(PRODUCT_TRANSITIONS, product.status)}
        gaps={readiness.gaps}
      />
      <TemplateSiblingPanel
        productId={product.id}
        catalogue={product.catalogue}
        licencePackageCount={product.licencePackages.length}
        hrefFor={(productId) => stepHref(productId, "basics", "admin")}
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
    </div>
  );
}
