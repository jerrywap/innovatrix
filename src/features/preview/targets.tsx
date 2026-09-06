import "server-only";
import { getSession } from "@/lib/auth/dal";
import { revealDemoUrls } from "@/services/catalog/demo-service";
import { viewerOwnsProduct, type ProductDetail } from "@/services/marketplace/detail";
import { frameabilityOf } from "@/services/marketplace/frameability";
import { PreviewBrand } from "./components/preview-brand";
import { PreviewStage, type PreviewTarget } from "./components/preview-stage";
import type { PreviewImage } from "./components/screenshot-viewer";
import { productHref } from "@/config/catalogue";

/**
 * Which demo addresses this viewer may be handed, resolved before anything
 * client-side exists.
 *
 * ## The gate is here, not in the component below it
 *
 * `demo-panel.tsx` states the rule and it applies unchanged:
 *
 * > Rendering `{canSee && <Credentials rows={rows} />}` satisfies the UI and
 * > fails the criterion — React serialises everything in scope for a client
 * > component's props.
 *
 * So `PreviewStage` is handed a list containing **only** what this viewer is
 * entitled to. There is no `canSee` flag, no full list to filter in the browser,
 * and nothing in scope near the boundary that a later refactor could pass along
 * by accident.
 *
 * ## Uncached, and suspended by the caller
 *
 * It reads the session, so it varies by viewer and must never share a cache
 * entry — the same rule `DemoPanel` records about itself. The page wraps it in a
 * `<Suspense>` so the shell still prerenders; that boundary is what keeps
 * `/preview/[slug]` a partially-prerendered route rather than a dynamic one.
 *
 * ## The frameability probe rides along in here
 *
 * Ticket 31. It belongs on this side of the boundary for two reasons: it is
 * uncached I/O with a three-second ceiling, which is exactly what the
 * `<Suspense>` above it exists to keep off the shell; and the gated targets are
 * not known until the session is, so probing earlier would mean probing the
 * public URL here and the other two somewhere else.
 *
 * `frameabilityOf` runs them concurrently, so three targets cost one timeout
 * rather than three, and its cache is keyed per URL — the usual case, where all
 * three addresses share a host that answers quickly, is one round trip and two
 * cache hits.
 */
export async function PreviewTargets({
  product,
  publicUrl,
  images,
}: {
  product: ProductDetail;
  /** Already known to be an embeddable https URL — see `embeddable()`. */
  publicUrl: string;
  /** The product's screenshots, for a target that turns out to be unframeable. */
  images: readonly PreviewImage[];
}) {
  const session = await getSession();
  const organizationId = session?.activeOrganizationId ?? undefined;

  const gated = await revealDemoUrls(product.id, {
    isAuthenticated: Boolean(session),
    ownsProduct: await viewerOwnsProduct(organizationId, product.id),
    isStaff: session?.user.isStaff ?? false,
    ...(session?.user.id ? { userId: session.user.id } : {}),
    ...(organizationId ? { organizationId } : {}),
  });

  const addresses: Array<Omit<PreviewTarget, "frameable">> = [
    { id: "public", label: "Public", url: publicUrl },
  ];

  // `gated` is `null` for a viewer who does not qualify — there is nothing to
  // filter, because nothing was returned.
  if (gated?.customerUrl && embeddable(gated.customerUrl)) {
    addresses.push({ id: "customer", label: "Customer", url: gated.customerUrl });
  }
  if (gated?.adminUrl && embeddable(gated.adminUrl)) {
    addresses.push({ id: "admin", label: "Admin", url: gated.adminUrl });
  }

  const verdicts = await frameabilityOf(addresses.map(({ url }) => url));

  /*
   * `!== "blocked"` rather than `=== "allowed"`, and the difference is the whole
   * of ticket 31's item 6. `unknown` means the probe learned nothing — a
   * timeout, a WAF, a host we declined to contact — and turning that into a
   * fallback would replace a working demo with a message saying it does not
   * work. Only a verdict earned from the headers a browser would read removes
   * the frame.
   */
  const targets: PreviewTarget[] = addresses.map((address) => ({
    ...address,
    frameable: verdicts.get(address.url) !== "blocked",
  }));

  return (
    <PreviewStage
      targets={targets}
      images={images}
      productName={product.name}
      productHref={productHref(product.slug)}
      brand={<PreviewBrand />}
    />
  );
}

/**
 * Can this address go in the frame at all?
 *
 * **`https:` only.** `optionalUrl` validates a demo URL with a bare `z.url()`,
 * which accepts `http://` — and an `http` frame on an https page is blocked as
 * mixed content, or silently rewritten by `upgrade-insecure-requests` to an
 * address that may not answer. Either way the visitor gets a blank rectangle and
 * no explanation, so a non-https target is treated as having no frame rather than
 * a broken one.
 *
 * `URL` throws on anything it cannot parse, and this runs on a value somebody
 * typed into a form.
 */
export function embeddable(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
