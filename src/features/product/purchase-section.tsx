import "server-only";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { getSession } from "@/lib/auth/dal";
import { isSaved } from "@/services/marketplace/saved";
import type { ProductDetail } from "@/services/marketplace/detail";
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

  return (
    <PurchasePanel
      productId={product.id}
      slug={product.slug}
      currency={currency}
      licencePackages={product.licencePackages}
      addons={product.addons}
      customisable={product.customization.available}
      // From `publicDemoView`, which has no credentials field at all — so
      // there is nothing here that could cross into the client bundle.
      demo={{
        ...(product.demo.publicUrl ? { publicUrl: product.demo.publicUrl } : {}),
        hasCredentials: product.demo.hasCredentials,
        roleCount: product.demo.roles.length,
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
