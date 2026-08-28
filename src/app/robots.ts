import type { MetadataRoute } from "next";
import { serverEnv } from "@/config/env";

/**
 * robots.txt — §93.
 *
 * ## Staging must not be indexed
 *
 * A staging deployment that ranks is worse than one that does not exist: it
 * competes with production for the same terms and shows unfinished work to
 * customers. So indexing is allowed **only** when `APP_URL` is the production
 * origin — derived rather than configured, because a separate flag is a thing
 * to forget when a new environment is spun up.
 *
 * ## The disallow list is about crawl budget, not secrecy
 *
 * `/admin`, `/staff` and `/dashboard` are all behind the DAL; a crawler cannot
 * see them whatever this file says. Excluding them stops the crawler spending
 * its budget on redirects to the login page.
 */
export default function robots(): MetadataRoute.Robots {
  const env = serverEnv();
  const origin = env.APP_URL.replace(/\/$/, "");
  const isProduction = env.NODE_ENV === "production" && !origin.includes("localhost");

  if (!isProduction) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/staff",
          "/dashboard",
          "/api/",
          // Search results are `noindex` at the page level too; this saves the
          // crawler the round trip to find that out.
          "/marketplace?q=",
          // Same reasoning, same page component, other catalogue.
          "/templates?q=",
          /*
             The cross-catalogue search — and the one whose page-level `noindex`
             is real, carried as a literal in `search/page.tsx`.

             The **query form only**, deliberately. A blanket `/search` disallow
             would stop the crawler ever reading that `noindex`, which is how a
             URL ends up indexed as a bare link with no snippet. Disallow the
             infinite half; leave the bare path crawlable and let the page say it
             does not want indexing.
          */
          "/search?q=",
          /*
            The demo frame holder. Every one of these is a bar around somebody
            else's site, and what content it does have belongs to the product
            page it came from — so it is `noindex` at the page level too, and
            this saves the crawler a round trip per product to find that out.

            A prefix rather than one query shape: the whole subtree is
            uninteresting, not part of it.
          */
          "/preview",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
