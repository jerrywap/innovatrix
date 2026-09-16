import "server-only";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { tipOfferFor } from "@/services/tips/tip-service";
import { getSession, loginDestination } from "@/lib/auth/dal";
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

  /*
   * Which of four viewers this is, decided here because this is where the
   * evidence is.
   *
   * `signedIn={Boolean(session)}` was the whole test, one line below a read of
   * `activeOrganizationId` — so a viewer with a session and no organisation got
   * the claim button, pressed it, and met `requireOrg`'s refusal in red. Staff
   * legitimately have no organisation and browse the marketplace, so this is a
   * standing state rather than a broken account, and the two need different
   * answers: see `GetItFree`.
   */
  const viewer = !session
    ? "signed-out"
    : session.user.isStaff
      ? "staff"
      : session.activeOrganizationId
        ? "customer"
        : "no-organisation";

  /*
   * The tip offer — resolved here, or not offered at all.
   *
   * Three conditions, and each removes a way the modal could be wrong:
   * a product with no vendor has nobody to tip; a viewer who is not a customer
   * cannot be charged (`requireOrg` would refuse the action); and the rate is
   * read once, server-side, so the figure the modal shows is the figure
   * `createTip` will snapshot.
   */
  const tip =
    product.vendor && viewer === "customer"
      ? {
          productName: product.name,
          ...(await tipOfferFor({
            vendorId: product.vendor.id,
            vendorName: product.vendor.name,
            currency,
          })),
        }
      : null;

  return (
    <PurchasePanel
      productId={product.id}
      slug={product.slug}
      currency={currency}
      licencePackages={product.licencePackages}
      addons={product.addons}
      customisable={product.customization.available}
      viewer={viewer}
      owned={owned}
      /*
       * Built here, not in the button, because only the server can see the
       * difference between "signed out" and "holding a dead cookie".
       *
       * `GetItFree` used to build its own with `loginPath(productPath)`, which
       * is the same hand-rolled copy the public header carried: right about
       * `?next=`, silent about a stale session. For an expired cookie the proxy
       * bounces `/login?next={this page}` straight back to this page, so the
       * button did nothing at all — see `public-header.tsx` for the full
       * mechanism. `loginDestination()` returns `/login?expired=1` in that case,
       * which is the one URL that clears the cookie.
       *
       * It reads the forwarded path itself, so it needs no argument: the page
       * the visitor should come back to is the one they are on.
       */
      signInHref={await loginDestination()}
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
      /*
        The tip offer, resolved on the server or absent.
        
        Absent means the modal never renders: a first-party product has no vendor
        to tip, and a viewer with no organisation cannot be charged. Deciding it
        here keeps the client component free of both questions — and keeps the
        commission rate, which is a vendor's private figure, out of the bundle for
        any product the viewer cannot tip anyway.
      */
      {...(tip ? { tip } : {})}
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
