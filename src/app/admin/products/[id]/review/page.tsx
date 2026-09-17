import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { PRODUCT_TRANSITIONS, nextStates, restoreTargetFor } from "@/lib/db/states";
import { loadWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";
import { PublishPanel } from "@/features/products/components/publish-panel";
import { TemplateSiblingPanel } from "@/features/products/components/template-sibling-panel";
import { unofferedCurrencies } from "@/services/payments/offered-currencies";
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
        /*
          The graph lists six ways out of `archived` because six statuses can
          archive; exactly one is right for this document. Narrowing here rather
          than in the panel keeps the panel a renderer of whatever it is handed,
          and `transition()` refuses the other five regardless — this decides what
          is *drawn*, not what is allowed.

          A delisted product offers nothing: it is put back by reinstating its
          vendor, which is a different screen and a different decision.
        */
        nextStates={
          product.status !== "archived"
            ? nextStates(PRODUCT_TRANSITIONS, product.status)
            : product.listingSuppressed
              ? []
              : [restoreTargetFor(product.archivedFrom)]
        }
        {...(product.listingSuppressed ? { delisted: true } : {})}
        gaps={readiness.gaps}
      />
      <TemplateSiblingPanel
        productId={product.id}
        catalogue={product.catalogue}
        licencePackageCount={product.licencePackages.length}
        unoffered={await unofferedCurrencies()}
        {...(sibling
          ? {
              sibling: {
                id: String(sibling._id),
                name: sibling.name,
                status: sibling.status,
                href: stepHref(String(sibling._id), "basics", "admin"),
              },
            }
          : {})}
        {...(linkedScript
          ? {
              linkedScript: {
                id: String(linkedScript._id),
                name: linkedScript.name,
                status: linkedScript.status,
                href: stepHref(String(linkedScript._id), "basics", "admin"),
              },
            }
          : {})}
      />
    </div>
  );
}
