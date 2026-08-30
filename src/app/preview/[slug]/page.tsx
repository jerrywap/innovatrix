import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductDetail, screenshots } from "@/services/marketplace/detail";
import { PreviewTargets, embeddable } from "@/features/preview/targets";
import { ScreenshotStage } from "@/features/preview/components/screenshot-stage";
import { productHref } from "@/config/catalogue";

export async function generateMetadata({
  params,
}: PageProps<"/preview/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductDetail(slug);
  if (!product) return { title: "Preview" };

  return {
    title: `Preview ${product.name}`,
    /*
     * `noindex, follow`, as a literal.
     *
     * The page is a frame around somebody else's site plus a bar; on its own it
     * is thin, and what content it has belongs to the product page it came from.
     * `follow` because every link on it — the logo, the close control — leads
     * back into pages that *should* be crawled.
     *
     * `robots.ts` also disallows `/preview`, which saves the crawler the round
     * trip to find this out. The two agree deliberately: the disallow is about
     * crawl budget, this is about indexing.
     */
    robots: { index: false, follow: true },
  };
}

/**
 * A product's demo, framed and branded — instead of sending the visitor away.
 *
 * ## What this replaces
 *
 * "Try the demo" was an outbound `target="_blank"` anchor: the visitor left
 * CoSetup, landed on a vendor's server with no way back but the Back button, and
 * had no way to see a template at phone width. This keeps them here, puts our
 * bar around it, and adds the width switcher that a template catalogue needs to
 * be useful at all.
 *
 * ## Two stages, and most of the catalogue gets the second
 *
 * Five of a thousand published products have a demo URL and **none of the 135
 * templates does**. So a product with no live demo previews its screenshots
 * rather than 404ing, and that path reads no session at all — which is why the
 * overwhelming majority of these pages prerender completely.
 *
 * ## The guard is in this function's own body
 *
 * `loading-boundaries.test.ts` asserts exactly that: a `notFound()` inside a
 * `<Suspense>` renders under `200 OK`, because the status line is committed once
 * the shell is flushed. It also means **no `loading.tsx` may be added** at or
 * above this segment.
 */
export default async function Page({ params }: PageProps<"/preview/[slug]">) {
  const { slug } = await params;
  const product = await getProductDetail(slug);
  if (!product) notFound();

  const publicUrl =
    product.demo.publicUrl && embeddable(product.demo.publicUrl)
      ? product.demo.publicUrl
      : undefined;

  /*
   * The live-demo stage is the only half that needs to know who is asking — the
   * customer and admin views are gated — so it is the only half behind a
   * boundary. Everything else here comes from one cached read.
   *
   * The fallback is a skeleton of the same shape rather than the public-only
   * stage: rendering a frame and then replacing it a moment later would load the
   * demo twice, and the second load would throw away the first.
   */
  if (publicUrl) {
    return (
      <Suspense fallback={<StageSkeleton />}>
        <PreviewTargets product={product} publicUrl={publicUrl} />
      </Suspense>
    );
  }

  return (
    <ScreenshotStage
      images={screenshots(product.media).map(({ url, alt }) => ({ url, alt }))}
      productName={product.name}
      productHref={productHref(product.slug)}
      brand={<Brand />}
    />
  );
}

/** The bar's height and the stage's shape, so nothing jumps when the session lands. */
function StageSkeleton() {
  return (
    <>
      <div className="border-border bg-surface h-[53px] shrink-0 border-b" />
      <div className="bg-surface-muted/40 min-h-0 flex-1 p-3 sm:p-4">
        <Skeleton className="size-full rounded-xl" />
      </div>
    </>
  );
}
