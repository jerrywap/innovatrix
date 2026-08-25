/**
 * Security headers — §88, ticket 26.
 *
 * Plain data, imported by `next.config.ts`. It lives here rather than inline in
 * the config so the reasoning has room, and so a test can read it.
 *
 * **Not** `server-only`: `next.config.ts` is evaluated by the Next CLI outside
 * the RSC graph, and `server-only` throws there. Nothing in this file is a
 * secret — it is a list of header values that ship to every browser anyway.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * The storage origin the browser uploads to, or `null`.
 *
 * ## Why `connect-src` needs it at all
 *
 * **Bytes never pass through the Next.js server** — that is an architectural constraint in
 * `AGENTS.md`, not a preference: a presigned `PUT` goes browser→S3 directly, because proxying a
 * 2GB release artefact through this process's memory and request timeout does not work, and a
 * Server Action's body limit is something a phone photograph clears without trying.
 *
 * So every upload in this app is a cross-origin `fetch` to the storage host, and `connect-src`
 * decides whether the browser will make it. It said `'self'` — with the comment "the browser talks
 * to us and to nobody else", which was true when it was written and stopped being true the moment
 * the first presigned upload shipped.
 *
 * The symptom was maximally misleading: the browser refuses the request *before* it goes out, so
 * `fetch` rejects with `TypeError: Failed to fetch` and there is no status, no response and no S3
 * access log entry to look at. Every server-side check passes — the signature, the bucket policy,
 * the CORS preflight — because curl and Node ignore CSP entirely. Four upload components were
 * broken this way, in a codebase where the CORS measurement had been repeated three times.
 *
 * `img-src` already allowed `https:`, which is why nobody noticed: *displaying* a stored image
 * worked, and only writing was blocked.
 *
 * ## Derived, and narrow
 *
 * The exact bucket host, not `https:` and not `*.amazonaws.com` — a `connect-src` wide enough to
 * cover every S3 bucket on earth is a `connect-src` that has stopped doing its job. Built the same
 * way `publicObjectUrl()` builds it, from the same three variables:
 *
 * - `STORAGE_ENDPOINT` set (R2, MinIO) ⇒ that origin, verbatim.
 * - absent ⇒ AWS's virtual-hosted form, `https://<bucket>.s3.<region>.amazonaws.com`.
 *
 * `null` when the variables are absent — a build with no storage configured emits no entry rather
 * than allowlisting `https://undefined.s3.undefined.amazonaws.com`.
 */
function storageOrigin(): string | null {
  const endpoint = process.env.STORAGE_ENDPOINT?.trim();
  if (endpoint) {
    try {
      // The origin only. The bucket path segment is irrelevant to a CSP, which matches on origin.
      return new URL(endpoint).origin;
    } catch {
      return null;
    }
  }

  const bucket = process.env.STORAGE_BUCKET?.trim();
  const region = process.env.STORAGE_REGION?.trim() || "us-east-1";
  return bucket ? `https://${bucket}.s3.${region}.amazonaws.com` : null;
}

/**
 * ## The CSP decision, and the thing that decided it
 *
 * The strict answer is a per-request nonce with `'strict-dynamic'`, minted in
 * `proxy.ts`. Next's own guide is unambiguous that we cannot have it:
 *
 * > **Partial Prerendering (PPR) is incompatible** with nonce-based CSP since
 * > static shell scripts won't have access to the nonce.
 *
 * `cacheComponents: true` means PPR by default across this app — it is the
 * caching architecture ticket 08 chose and ticket 27 finishes. A nonce would
 * make **every page dynamic**: no static shell, no CDN caching, a full render
 * per request on `/` and `/marketplace`, which are the two pages whose latency
 * is a revenue number. Trading that for a CSP is not obviously the safer
 * choice, and it is certainly not a free one.
 *
 * So: `'unsafe-inline'` in `script-src`, and this comment rather than a
 * pretence otherwise. What that costs is real — an injected inline `<script>`
 * would run — and what still stands between an attacker and one is React's
 * escaping, the `escape()` in the notification template, and the fact that no
 * user-supplied HTML is rendered unescaped anywhere in the app.
 *
 * ### The way out, when it is not experimental
 *
 * Next 16 has `experimental.sri`, which hashes scripts at build time and keeps
 * static generation. That is the combination we want and it is marked
 * experimental in the version we are on. Revisit at the next major: turning it
 * on means deleting `'unsafe-inline'` from the line below and adding four lines
 * to `next.config.ts`.
 *
 * ### `style-src` keeps `'unsafe-inline'` regardless
 *
 * Tailwind emits a stylesheet, but Next inlines critical CSS and several Radix
 * primitives set `style` attributes for positioning. There is no version of
 * this app that works without it, nonce or not.
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    // See above. `'unsafe-eval'` in development only: React uses `eval` to
    // reconstruct server error stacks in the browser, and without it every
    // dev-time error is a blank overlay.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the blur placeholders `next/image` inlines; `https:` because
    // product media lives on the storage host and seeded art on picsum, and
    // both are already allowlisted for the optimizer in `next.config.ts`.
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    /*
     * Us, and the storage host we upload to. See `storageOrigin()` for why the second one is not
     * optional and what its absence broke.
     *
     * Payment providers are still called server-side; there is no client SDK to allowlist, and
     * nothing else in the app talks to a third party from the browser.
     */
    [
      "connect-src 'self'",
      storageOrigin(),
      // The dev server's HMR socket.
      isDev ? "ws: wss:" : null,
    ]
      .filter(Boolean)
      .join(" "),
    /*
     * One embedded host, and nothing embeds us.
     *
     * This was `'none'`, with a comment saying nothing is embedded. That stopped
     * being true when a vendor could put a YouTube walkthrough on a listing.
     *
     * `youtube-nocookie.com` rather than `youtube.com`: same player, and it sets
     * no tracking cookie until the visitor actually presses play. The narrower
     * host is also the whole point of naming one — `frame-src https:` would let
     * any injected URL become a frame, which is most of what this directive is
     * for.
     *
     * `frame-ancestors` is unaffected and is the header that actually stops
     * clickjacking — it governs who may embed *us*. `X-Frame-Options` below is for
     * the browsers that predate it.
     */
    "frame-src https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // A form that posts off-origin is an exfiltration primitive.
    "form-action 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Applied to every response.
 *
 * `Strict-Transport-Security` is deliberately **not** in the shared list — see
 * below.
 */
export function securityHeaders(): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },

    // MIME sniffing turns an uploaded text file that a browser decides is HTML
    // into stored XSS. There is no case for ever omitting this.
    { key: "X-Content-Type-Options", value: "nosniff" },

    // Superseded by `frame-ancestors` above, kept for older browsers. The two
    // agree; where they disagree the CSP wins, which is the right way round.
    { key: "X-Frame-Options", value: "DENY" },

    // Send the full URL within our own origin and only the origin outside it.
    // A dashboard URL contains ids, and a referrer is a leak nobody audits.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    // Nothing here needs a camera, a microphone or a location, so nothing gets
    // one — including anything embedded, which is the point of the empty lists.
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
      ].join(", "),
    },

    /*
     * HSTS, production only.
     *
     * Sending it in development would be actively harmful: the browser pins
     * `localhost` to https for two years, and every other project on this
     * machine that serves http://localhost stops loading. That is not
     * hypothetical — it is a well-known way to break a development machine, and
     * it is not undone by removing the header.
     *
     * No `preload` yet. Preloading is effectively irreversible and needs a
     * deliberate submission, which belongs with the production domain rather
     * than with a header list.
     */
    ...(isDev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]),
  ];
}
