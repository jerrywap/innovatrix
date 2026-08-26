import type { Metadata } from "next";
import { Suspense } from "react";
import { pageMetadata } from "@/lib/seo";
import { Hero } from "@/features/home/components/hero";
import { Industries } from "@/features/home/components/industries";
import {
  FeaturedSoftware,
  SoftwareSkeleton,
} from "@/features/home/components/featured-software";
import {
  FeaturedTemplates,
  TemplatesSkeleton,
} from "@/features/home/components/featured-templates";
import { FreeSection, FreeSkeleton } from "@/features/home/components/free-section";
import { CustomBuild } from "@/features/home/components/custom-build";
import { Services } from "@/features/home/components/services";
import { Vendor } from "@/features/home/components/vendor";
import { ClosingCta } from "@/features/home/components/closing-cta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "CoSetup",
    description:
      "Ready-made applications, scripts and website templates — including free ones. Use them as they are, have them adapted, or commission exactly what you need, then have it installed, supported and maintained.",
    path: "/",
  }),
  // Absolute, because the root template would otherwise render "CoSetup · CoSetup".
  title: { absolute: "CoSetup — Software, set up for you" },
};

/**
 * The homepage — COS-7.
 *
 * ## Marketplace before company
 *
 * The order is the argument. A visitor meets the three things they can do, then
 * real named products, then real templates, then what is free, and only after all
 * of that the custom-build pitch, the services that follow a purchase, and the
 * vendor invitation. The version this replaced put its first real product in the
 * fourth band and had no template or vendor section at all.
 *
 * ## This function must stay synchronous
 *
 * It is what keeps `/` prerendering — the build prints `◐` rather than `ƒ` only
 * because nothing in this body awaits. Five bands read the catalogue and every one
 * of them sits behind its own `<Suspense>`, so the static shell — headline, search,
 * the three paths, all the copy — is in the first flush while the queries run.
 *
 * Per-band boundaries rather than one around the group: a slow template query
 * should not hold back the software grid above it, and each skeleton is sized to
 * the band it replaces so nothing below it shifts when the rows land.
 *
 * Anything priced is per-request regardless, because `resolveStorefrontCurrency()`
 * reads a cookie. That is an accepted cost, and the reason these are cheap is that
 * every read underneath is a `"use cache"` call tagged `CATALOG_TAG` — a publish
 * invalidates them, nothing else does.
 *
 * ## No `loading.tsx`
 *
 * A `(public)/loading.tsx` would sit above `marketplace/[slug]` and
 * `customize/[slug]`, both of which call `notFound()`, and flushing the shell
 * first would serve their 404 body under `200 OK`. `loading-boundaries.test.ts`
 * enforces that; in-page `<Suspense>` is the pattern here.
 */
export default function Home() {
  return (
    <>
      <Hero />

      <Suspense fallback={null}>
        <Industries />
      </Suspense>

      <Suspense fallback={<SoftwareSkeleton />}>
        <FeaturedSoftware />
      </Suspense>

      <Suspense fallback={<TemplatesSkeleton />}>
        <FeaturedTemplates />
      </Suspense>

      <Suspense fallback={<FreeSkeleton />}>
        <FreeSection />
      </Suspense>

      <CustomBuild />
      <Services />
      <Vendor />
      <ClosingCta />
    </>
  );
}
