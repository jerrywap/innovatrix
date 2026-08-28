import "server-only";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { getSession } from "@/lib/auth/dal";
import { isSaved } from "@/services/marketplace/saved";
import {
  screenshots,
  viewerOwnsProduct,
  type ProductDetail,
} from "@/services/marketplace/detail";
import { PurchasePanel } from "./purchase-panel";
import { SaveButton } from "./save-button";

/**
 * The request-dependent wrapper around the purchase panel.
 *
 * Its own module so the panel stays a pure client component fed by props. This
 * reads `cookies()` and the session — both dynamic — and lives behind the
 * page's Suspense boundary, which is what keeps the rest of the product page
 * prerenderable.
 */
export async function PurchaseSection({ product }: { product: ProductDetail }) {
  const currency = await resolveStorefrontCurrency();
  const session = await getSession();

  const saved = session ? await isSaved(session.user.id, product.id) : false;

  /*
   * Whether they already have it — so the free CTA can say "Download again"
   * rather than offering a second claim.
   *
   * Drawing only. `claimFreeProduct` runs the same check server-side and answers
   * with the existing entitlement, because this one is a prop in an RSC payload
   * and the action is a public POST either way.
   */
  const owned = await viewerOwnsProduct(session?.activeOrganizationId ?? undefined, product.id);

  return (
    <PurchasePanel
      productId={product.id}
      slug={product.slug}
      currency={currency}
      licencePackages={product.licencePackages}
      addons={product.addons}
      customisable={product.customization.available}
      signedIn={Boolean(session)}
      owned={owned}
      // From `publicDemoView`, which has no credentials field at all — so
      // there is nothing here that could cross into the client bundle.
      demo={{
        ...(product.demo.publicUrl ? { publicUrl: product.demo.publicUrl } : {}),
        hasCredentials: product.demo.hasCredentials,
        roleCount: product.demo.roles.length,
        /*
         * Computed here, where the whole `ProductDetail` is in hand, and passed
         * as a boolean. The panel is a client component deliberately handed a
         * three-field view of the demo; sending it the media array so it could
         * ask this question itself would put every screenshot URL in the RSC
         * payload to answer a yes-or-no.
         *
         * Both halves matter: a live demo is the good case, and a screenshot is
         * the case that covers the other 99.5% of the catalogue.
         */
        previewable: Boolean(product.demo.publicUrl) || screenshots(product.media).length > 0,
      }}
      {...(product.customization.typicalTurnaround
        ? { typicalTurnaround: product.customization.typicalTurnaround }
        : {})}
      saveButton={
        <SaveButton
          productId={product.id}
          slug={product.slug}
          initiallySaved={saved}
          signedIn={Boolean(session)}
        />
      }
    />
  );
}
