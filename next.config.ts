import type { NextConfig } from "next";

/**
 * The host product media is served from, derived from the storage config.
 *
 * `next.config.ts` runs in Node, so reading the environment here is legitimate —
 * but it does mean the image allowlist differs between environments, which is
 * why it is computed in one named place rather than inlined.
 *
 * An S3-compatible `STORAGE_ENDPOINT` (R2, MinIO) is used verbatim; plain AWS
 * has no endpoint set, so the virtual-hosted host is derived from bucket and
 * region.
 */
function storageImageHost(): string | undefined {
  const endpoint = process.env.STORAGE_ENDPOINT?.trim();
  if (endpoint) {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return undefined;
    }
  }

  const bucket = process.env.STORAGE_BUCKET?.trim();
  const region = process.env.STORAGE_REGION?.trim();
  return bucket && region ? `${bucket}.s3.${region}.amazonaws.com` : undefined;
}

const imageHost = storageImageHost();

const nextConfig: NextConfig = {
  /**
   * Typed routes — the mechanism behind ticket 04's "deferred modules appear
   * nowhere in navigation".
   *
   * With this on, `<Link href="/projects">` is a **compile error** until
   * `app/projects` exists. That turns "no dead links" from something a reviewer
   * has to notice into something the build refuses to ship, and it is what
   * keeps a post-MVP module from being quietly linked before it is built.
   *
   * It also catches the ordinary version of the same mistake: a typo in a href,
   * or a route renamed without its links being updated.
   */
  typedRoutes: true,

  experimental: {
    /**
     * Enables `forbidden()` / `unauthorized()` and their `forbidden.tsx` /
     * `unauthorized.tsx` conventions.
     *
     * Needed because a plain `throw` from a page is caught by `error.tsx`, and
     * an error boundary renders **on the client with a 200**. A staff member
     * who opens a screen their role doesn't cover would get a blank pane with
     * no JavaScript, and every crawler and monitor would be told the refusal
     * succeeded. `forbidden()` renders server-side, returns a real 403, and
     * adds `noindex`.
     *
     * Marked experimental upstream. The exposure is confined to
     * `requirePermissionOrForbid()` in the DAL and one `forbidden.tsx` — if the
     * API changes, those are the only two places to revisit.
     */
    authInterrupts: true,
  },

  /**
   * Cache Components — `use cache`, `cacheLife`, `cacheTag`, and **PPR by
   * default**.
   *
   * Ticket 08 required an explicit caching decision. The deciding fact is that
   * the alternative is deprecated: in Next.js 16 `unstable_cache` is documented
   * as *replaced by* `use cache`, and the single-argument `revalidateTag(tag)`
   * is deprecated. Building the whole catalogue on the previous model would
   * mean writing it twice.
   *
   * PPR arriving with it is the other half. Ticket 04 traded the public pages
   * from static to dynamic so the header could render the right session state
   * on first paint, and deferred the fix to ticket 27. PPR *is* that fix: a
   * static shell with the session-dependent corner streamed in.
   *
   * Adoption is the documented incremental path — every route that existed
   * before this carries `instant = false`, which marks it *allowed to block*
   * and leaves its behaviour exactly as it was. New catalogue routes are built
   * natively. Ticket 27 finishes by removing those opt-outs.
   *
   * Two rules this imposes on new code:
   *   1. `searchParams`, `cookies()` and `headers()` are read **inside** a
   *      `<Suspense>` boundary, not at the top of a page, or the whole route
   *      blocks instead of prerendering a shell.
   *   2. A `use cache` function's arguments and return value must be
   *      serializable — so catalog reads return plain DTOs with string ids,
   *      never Mongoose documents carrying `ObjectId`.
   */
  cacheComponents: true,

  images: {
    formats: ["image/avif", "image/webp"],
    // Unsplash serves the placeholder screenshots until real product media is
    // uploaded (ticket 06); the storage host serves it afterwards.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      ...(imageHost ? [{ protocol: "https" as const, hostname: imageHost }] : []),
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [256, 384],
  },
};

export default nextConfig;
