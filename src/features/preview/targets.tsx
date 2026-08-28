import "server-only";
import { getSession } from "@/lib/auth/dal";
import { revealDemoUrls } from "@/services/catalog/demo-service";
import { viewerOwnsProduct, type ProductDetail } from "@/services/marketplace/detail";
import { Brand } from "@/components/shell/brand";
import { PreviewStage, type PreviewTarget } from "./components/preview-stage";

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
 */
export async function PreviewTargets({
  product,
  publicUrl,
}: {
  product: ProductDetail;
  /** Already known to be an embeddable https URL — see `embeddable()`. */
  publicUrl: string;
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

  const targets: PreviewTarget[] = [{ id: "public", label: "Public", url: publicUrl }];

  // `gated` is `null` for a viewer who does not qualify — there is nothing to
  // filter, because nothing was returned.
  if (gated?.customerUrl && embeddable(gated.customerUrl)) {
    targets.push({ id: "customer", label: "Customer", url: gated.customerUrl });
  }
  if (gated?.adminUrl && embeddable(gated.adminUrl)) {
    targets.push({ id: "admin", label: "Admin", url: gated.adminUrl });
  }

  return (
    <PreviewStage
      targets={targets}
      productName={product.name}
      productHref={`/marketplace/${product.slug}`}
      brand={<Brand />}
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
