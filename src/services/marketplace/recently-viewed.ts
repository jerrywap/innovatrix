import { RECENTLY_VIEWED_COOKIE, RECENTLY_VIEWED_LIMIT } from "@/config/storefront";

/**
 * Recently viewed — §6, and the criterion that it survives a refresh without
 * an account.
 *
 * ## A cookie, not a database row
 *
 * "No account required" is the requirement, so there is nowhere else to put it.
 * That makes the cookie's contents **untrusted input** on the way back in —
 * anyone can set it to anything — and the parser below treats it that way.
 *
 * ## Slugs, not ids
 *
 * An `ObjectId` in a cookie leaks the internal identifier and its rough
 * creation time, and buys nothing: the read is by slug anyway, and the products
 * are all public. Slugs also survive a database restore with different ids.
 *
 * ## Pure, so the rules are testable
 *
 * The cookie *write* happens in the product page (ticket 09) and the *read* in
 * the rail; both go through these two functions, so the cap and the dedup
 * cannot differ between them.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

/** Parse the cookie. Anything unrecognisable is dropped, never thrown on. */
export function parseRecentlyViewed(value: string | undefined): string[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG.test(slug)),
    ),
  ].slice(0, RECENTLY_VIEWED_LIMIT);
}

/**
 * Put `slug` at the front, keeping the list capped.
 *
 * Re-visiting a product moves it to the front rather than adding a duplicate —
 * "recently viewed" is a set ordered by recency, not a history log.
 */
export function pushRecentlyViewed(current: string | undefined, slug: string): string[] {
  if (!SLUG.test(slug)) return parseRecentlyViewed(current);

  const existing = parseRecentlyViewed(current).filter((item) => item !== slug);
  return [slug, ...existing].slice(0, RECENTLY_VIEWED_LIMIT);
}

export function serialiseRecentlyViewed(slugs: readonly string[]): string {
  return slugs.join(",");
}

/**
 * The cookie options, in one place.
 *
 * `httpOnly: false` on purpose and worth saying why: this is a browsing
 * convenience with no security value, and a future client-side "clear my
 * history" control should be able to remove it without a round trip. There is
 * nothing in it that is not already public.
 *
 * `sameSite: "lax"` so following a shared link still shows the rail;
 * `secure` follows the deployment rather than being hard-coded, or local http
 * development silently stops storing it.
 */
export function recentlyViewedCookieOptions(secure: boolean) {
  return {
    name: RECENTLY_VIEWED_COOKIE,
    httpOnly: false,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
