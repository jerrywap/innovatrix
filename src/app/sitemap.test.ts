import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATIC_PATHS } from "./sitemap";

/**
 * Every static sitemap URL resolves to a route that exists — §93.
 *
 * ## Why this needed a test
 *
 * The sitemap listed `/about` and `/contact` and neither route existed. The
 * build was clean throughout: `typedRoutes` turns a `<Link>` to a missing route
 * into a compile error, and it cannot see inside a template string. So the one
 * file whose entire job is telling crawlers where the pages are was advertising
 * two 404s, and nothing in the toolchain could say so.
 *
 * A crawler that finds 404s in a sitemap does not just skip them — it discounts
 * the file, which affects the URLs that *are* real.
 *
 * ## Only the static half
 *
 * Product and taxonomy URLs are generated from the database and are correct by
 * construction: a slug that is in the collection is a page. The hand-written
 * list is the part where a typo survives.
 */

const APP = join(process.cwd(), "src", "app");

/** `/services` → `src/app/(public)/services/page.tsx`, whatever the group. */
const ROUTE_GROUPS = ["", "(public)", "(auth)"];

function routeExists(path: string): boolean {
  const segment = path === "/" ? "" : path.replace(/^\//, "");

  return ROUTE_GROUPS.some((group) => existsSync(join(APP, group, segment, "page.tsx")));
}

describe("sitemap", () => {
  it("lists at least the pages we know are public", () => {
    // Guards the guard: an empty list would satisfy every assertion below.
    expect(STATIC_PATHS.length).toBeGreaterThan(4);
  });

  it("points every static URL at a route that exists", () => {
    const missing = STATIC_PATHS.map(([path]) => path).filter((path) => !routeExists(path));
    expect(missing).toEqual([]);
  });

  it("finds the route files it is looking for, rather than passing on a bad path", () => {
    // If `routeExists` were broken it would return true for everything and the
    // test above would pass on a sitemap full of nonsense.
    expect(routeExists("/marketplace")).toBe(true);
    expect(routeExists("/definitely-not-a-route")).toBe(false);
  });

  it("has no duplicates and no trailing slashes", () => {
    const paths = STATIC_PATHS.map(([path]) => path);

    expect(new Set(paths).size).toBe(paths.length);
    // `/services` and `/services/` are two URLs to a crawler and one page to us.
    expect(paths.filter((path) => path !== "/" && path.endsWith("/"))).toEqual([]);
  });
});
