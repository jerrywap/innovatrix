import "server-only";
import { revalidateTag, updateTag } from "next/cache";

/**
 * Cache tags for the catalogue, and the one place invalidation happens.
 *
 * ## Why the tags live in a module of their own
 *
 * Every cached catalogue read tags itself from here, and every write
 * invalidates from here. A tag is a string, so the failure mode without this is
 * a typo: `cacheTag("catalog")` on the read and `updateTag("catalogue")` on the
 * write, and the marketplace quietly serves a published product's old state
 * until the revalidate window expires. Nothing errors.
 *
 * ## `updateTag` versus `revalidateTag`
 *
 * They are not interchangeable, and the difference is visible to an admin:
 *
 * - **`updateTag`** — Server Actions only. Expires immediately, so the *next*
 *   request waits for fresh data. This is what "I clicked publish and the
 *   product is there" requires.
 * - **`revalidateTag`** — anywhere else (route handlers, webhooks). Marks stale
 *   with stale-while-revalidate semantics, so a reader may still get the old
 *   value once. Fine for a background refresh, wrong for a user's own edit.
 *
 * Note `revalidateTag(tag)` with one argument is deprecated in Next.js 16; the
 * profile argument is required here.
 */

/** Anything that changes what the marketplace lists. */
export const CATALOG_TAG = "catalog";
/** Categories, industries, technologies — read on nearly every public page. */
export const TAXONOMY_TAG = "taxonomy";

/** One product's detail page. Scoped so editing one product doesn't dump the grid. */
export function productTag(slug: string): string {
  return `product:${slug}`;
}

/**
 * One vendor's storefront — vendor ticket 11.
 *
 * Scoped like `productTag`, so renaming one vendor does not dump the catalogue. Publishing a
 * product *does* dump both, because the storefront lists products: see `catalogChanged`.
 */
export function vendorTag(slug: string): string {
  return `vendor:${slug}`;
}

/**
 * Invalidate one tag, taking the strongest option the caller's context allows.
 *
 * `updateTag` is **Server-Actions-only** and throws anywhere else. That matters
 * because the same service functions are called from more than one kind of
 * context: an admin action today, ticket 13's payment webhook and ticket 25's
 * jobs later. Making each caller remember which helper it is allowed to use is
 * a rule that will be got wrong, and the symptom — a throw from deep inside an
 * unrelated service — reads as a bug in the service.
 *
 * So: try the immediate one, fall back to the stale-while-revalidate one. An
 * action gets "the admin sees their change at once"; a webhook gets an
 * invalidation instead of an exception.
 */
function invalidate(tag: string): void {
  try {
    updateTag(tag);
  } catch {
    // Not in a Server Action. `revalidateTag` works everywhere; the only cost
    // is that one more reader may be served the previous value.
    revalidateTag(tag, "max");
  }
}

/**
 * After anything that changes what the marketplace lists — publish, unpublish,
 * edit, release.
 *
 * `slugs` invalidates those products' own pages as well as the listings. Pass
 * the **old** slug too when a slug changed, or the previous URL keeps serving a
 * cached page instead of the redirect.
 */
export function catalogChanged(slugs: readonly string[] = []): void {
  invalidate(CATALOG_TAG);
  for (const slug of slugs) invalidate(productTag(slug));
}

/**
 * After anything that changes a vendor's storefront — a profile edit, a
 * verification decision, a suspension.
 *
 * A product publish does **not** come through here: it calls `catalogChanged`,
 * and the storefront read tags itself with `CATALOG_TAG` as well as its own tag
 * precisely so it refreshes with the catalogue. Two tags on one read is cheaper
 * than every publish path having to know which vendor to invalidate.
 */
export function vendorChanged(slug: string): void {
  invalidate(vendorTag(slug));
}

/** After a taxonomy write. Also dumps the catalogue: facets carry slugs. */
export function taxonomyChanged(): void {
  invalidate(TAXONOMY_TAG);
  invalidate(CATALOG_TAG);
}

/**
 * How long a cached catalogue read may serve stale data if nothing invalidates
 * it. Writes invalidate explicitly, so these are the backstop for a change made
 * outside the app — a direct database edit, a restored backup.
 *
 * Ticket 27 has an acceptance criterion asking for these to be stated, so they
 * are named rather than sprinkled as literals.
 */
export const CACHE_PROFILE = {
  /** Taxonomy changes rarely and is read constantly. */
  taxonomy: { stale: 300, revalidate: 3600, expire: 86_400 },
  /** Listings — a new product should surface within the hour even unprompted. */
  listing: { stale: 60, revalidate: 900, expire: 86_400 },
  /**
   * A product page. **`stale: 0` on purpose.**
   *
   * Every other profile happily serves a slightly-old copy while it refreshes,
   * because a listing that is a minute behind is harmless. A product *page* is
   * different: ticket 09 requires that an unpublished or archived product
   * returns 404, and a non-zero `stale` means the first reader after a
   * withdrawal still gets the full page.
   *
   * That gap is real and was observed — a freshly started server served the
   * build-time HTML for a deprecated product once, then 404'd. In-process
   * `updateTag` from an admin action closes it immediately, but the fallback
   * path (a webhook, ticket 25's jobs, a direct edit) only marks stale, and
   * "withdrawn but still rendering" is not a state to be relaxed about.
   *
   * The cost is one revalidation check per reader once the window lapses,
   * which is exactly what `revalidate` already bounds.
   */
  product: { stale: 0, revalidate: 3600, expire: 86_400 },
} as const;
