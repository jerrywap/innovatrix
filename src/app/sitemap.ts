import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { serverEnv } from "@/config/env";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { getTaxonomyIndex } from "@/services/marketplace";
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // `use cache`, not `export const revalidate` — Cache Components rejects
  // route-segment config outright, and this is the replacement rather than a
  // workaround. Tagged with the catalogue so publishing a product refreshes
  // the sitemap instead of waiting out a window.
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG);
  cacheLife(CACHE_PROFILE.listing);

  const origin = serverEnv().APP_URL.replace(/\/$/, "");

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/marketplace`, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/custom-software`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/services`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/pricing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/about`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${origin}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];

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
  const products = await Product.find({ status: "published", deletedAt: null })
    .sort({ publishedAt: -1 })
    .limit(MAX_PRODUCTS)
    .select({ slug: 1, updatedAt: 1 })
    .lean<Array<{ slug: string; updatedAt?: Date }>>();

  return [
    ...staticPages,
    ...landingPages,
    ...products.map((product) => ({
      url: `${origin}/marketplace/${product.slug}`,
      ...(product.updatedAt ? { lastModified: product.updatedAt } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
