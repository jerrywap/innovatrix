import type { Metadata } from "next";
import { publicEnv } from "@/config/public-env";

/**
 * Metadata for a public page — §93.
 *
 * ## Why a helper rather than a literal per page
 *
 * Every indexable page needs the same five things: a title, a description, a
 * canonical URL, an Open Graph block and a Twitter card. Written by hand seven
 * times, four of them end up with three of the five — which is exactly what the
 * audit found. `alternates.canonical` was on one route out of seventeen, and OG
 * on none.
 *
 * The canonical is the one that costs money when it is missing. `/marketplace`
 * and `/marketplace?sort=price` are the same page to a reader and two pages to
 * a crawler, and the ranking splits between them.
 *
 * ## Not for the product pages
 *
 * `/marketplace/[slug]` builds its metadata from the product's own SEO fields
 * with a generated fallback (ticket 06), which is more than this can express.
 * This is for the hand-written pages.
 */

export interface PageSeo {
  title: string;
  description: string;
  /** Absolute path, leading slash, no origin, no trailing slash. */
  path: string;
  /** Defaults to `website`; a long-form page can say `article`. */
  type?: "website" | "article";
}

export function pageMetadata({
  title,
  description,
  path,
  type = "website",
}: PageSeo): Metadata {
  const site = publicEnv.NEXT_PUBLIC_APP_NAME;

  return {
    title,
    description,
    // Relative, resolved against `metadataBase` in the root layout. Absolute
    // here would hard-code the origin into every page and be wrong in every
    // environment but one.
    alternates: { canonical: path },
    openGraph: {
      type,
      url: path,
      siteName: site,
      // The template in the root layout applies to `title` but **not** to
      // `openGraph.title` — Next does not thread it through, so a shared card
      // would read "Pricing" with no clue whose. Written out here instead.
      title: `${title} · ${site}`,
      description,
    },
    twitter: {
      // `summary_large_image` without an image renders as a bare summary, so
      // this is honest rather than aspirational until there are OG images.
      card: "summary",
      title: `${title} · ${site}`,
      description,
    },
  };
}
