import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { serverEnv } from "@/config/env";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { getTaxonomyIndex } from "@/services/marketplace";
import { storefrontSlugs } from "@/services/marketplace/storefront";
import { CACHE_PROFILE, CATALOG_TAG, TAXONOMY_TAG } from "@/services/catalog/cache";

/**
 * The sitemap — §93.
 *
 * ## Only what `robotsFor` would index
 *
 * A sitemap that lists URLs carrying `noindex` is a contradiction a crawler
 * resolves by trusting neither. So this contains exactly the three kinds of
 * page that are indexable: the listing, the category and industry landing
 * pages, and published products. No filter combinations, no search results, no
 * pagination.
 *
 * ## Bounded
 *
 * The protocol's limit is 50,000 URLs and this stops well short. A catalogue
 * that outgrows it needs a sitemap *index*, which is ticket 27's problem and
 * should be a deliberate change rather than a silently truncated file.
 */
const MAX_PRODUCTS = 5_000;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * The static half, as data so a test can walk it.
 *
 * Exported for `sitemap.test.ts`, which checks each path against `src/app`.
 * Every entry must be a real, public, indexable route — anything carrying
 * `noindex` (checkout, cart, the concept pages) belongs in `robots.ts`'s
 * disallow list rather than here, and a URL that 404s belongs nowhere.
 */
export const STATIC_PATHS: ReadonlyArray<[string, ChangeFrequency, number]> = [
  ["/", "weekly", 1],
  ["/marketplace", "daily", 0.9],
  ["/custom-software", "monthly", 0.8],
  ["/services", "monthly", 0.7],
  ["/pricing", "monthly", 0.7],
  /*
   * Vendor ticket 01. `/sell` is how a developer finds out they can sell here, and it was absent
   * from this list as well as from every visible link — so the one recruitment page on the site
   * was invisible to crawlers too. `0.6` rather than `0.7`: it is a real destination but a
   * narrower audience than the buyer-facing pages above it.
   */
  ["/sell", "monthly", 0.6],
  ["/terms", "yearly", 0.2],
  ["/terms/vendor", "yearly", 0.2],
  ["/privacy", "yearly", 0.2],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // `use cache`, not `export const revalidate` — Cache Components rejects
  // route-segment config outright, and this is the replacement rather than a
  // workaround. Tagged with the catalogue so publishing a product refreshes
  // the sitemap instead of waiting out a window.
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.listing);

  const origin = serverEnv().APP_URL.replace(/\/$/, "");

  /*
   * `/about` and `/contact` were here, and **neither route exists**.
   *
   * `typedRoutes` makes a `<Link>` to a missing route a compile error, and it
   * cannot see inside a template string — so the build was clean while the
   * sitemap advertised two 404s to every crawler that read it. Removed rather
   * than papered over with stub pages; `sitemap.test.ts` now asserts that every
   * path here resolves to a route file, so the next one is caught at test time
   * instead of by Search Console.
   */
  const staticPages: MetadataRoute.Sitemap = STATIC_PATHS.map(
    ([path, changeFrequency, priority]) => ({
      url: `${origin}${path}`,
      changeFrequency,
      priority,
    }),
  );

  const taxonomy = await getTaxonomyIndex();
  const landingPages: MetadataRoute.Sitemap = [
    ...taxonomy.category.map((term) => ({
      url: `${origin}/marketplace/category/${term.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...taxonomy.industry.map((term) => ({
      url: `${origin}/marketplace/industry/${term.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];

  await connectToDatabase();

  /*
   * Vendor storefronts — vendor ticket 11.
   *
   * The same two conditions the page itself applies: verified vendor, at least one published
   * product. They have to be the same, because a sitemap listing a URL that 404s is a
   * contradiction a crawler resolves by trusting neither — which is the failure
   * `sitemap.test.ts` was written after `/about` and `/contact` were advertised for weeks.
   */
  const storefronts = await storefrontSlugs();

  const products = await Product.find({ status: "published", deletedAt: null })
    .sort({ publishedAt: -1 })
    .limit(MAX_PRODUCTS)
    .select({ slug: 1, updatedAt: 1 })
    .lean<Array<{ slug: string; updatedAt?: Date }>>();

  return [
    ...staticPages,
    ...landingPages,
    ...storefronts.map((vendor) => ({
      url: `${origin}/vendors/${vendor.slug}`,
      // Weekly: a storefront changes when its vendor publishes something, and a daily hint on
      // a page that changes monthly trains a crawler to ignore the hint.
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...products.map((product) => ({
      url: `${origin}/marketplace/${product.slug}`,
      ...(product.updatedAt ? { lastModified: product.updatedAt } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
