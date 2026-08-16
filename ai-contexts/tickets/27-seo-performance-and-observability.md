# 27 — SEO, Performance & Observability

**Bucket:** §18 · **Depends on:** 08, 09 · **Blocks:** launch · **Size:** M
**Spec:** §93 (SEO), §94 (performance), §95 (observability)

## Why
The marketplace is a customer-acquisition channel, so §93's indexed pages are revenue surfaces. §94's rule —
"do not load thousands of products into the browser simply to filter them" — is a correctness requirement at
scale, not a nicety. §95 is what makes a payment failure discoverable before the customer emails.

## Read first
`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` and `14-metadata-and-og-images.md`.
Cache Components (`cacheComponents: true` + `use cache` + `cacheLife`/`cacheTag`) is **opt-in** in Next.js 16 and
changes the rendering model materially — decide once, here, and apply it consistently.

## Scope

### SEO (§93)
- `generateMetadata` on every public route: title, description, canonical, Open Graph, Twitter card.
  Product pages use the product's own SEO fields from ticket 06, falling back to generated copy.
- **JSON-LD**: `Product` + `Offer` on product pages, `BreadcrumbList` on category/industry pages,
  `Organization` site-wide. No `AggregateRating` until reviews actually exist.
- `app/sitemap.ts` — published products, categories, industries, services, static pages, with `lastModified`.
  Paginate if it exceeds 50k URLs.
- `app/robots.ts` — allow public, disallow `/dashboard`, `/staff`, `/admin`, `/api`, `/cart`, `/checkout`.
- Semantic HTML and a single `h1` per page; images have meaningful `alt`.
- Public product URLs are stable: changing a slug issues a 301 from the old one (keep a slug-history array).

### Caching decision
Recommended: **enable Cache Components**.
- Catalog reads (`getPublishedProducts`, `getProduct(slug)`, taxonomy) wrapped in `use cache` with
  `cacheLife('hours')` and `cacheTag('products')` / `cacheTag(\`product:\${id}\`)`.
- Invalidate on publish/unpublish/version release from the ticket-19 event handlers.
- Everything user-specific (cart, dashboard, staff) reads `cookies()` behind a `<Suspense>` boundary so the
  static shell still ships. Never wrap per-user data in a shared `use cache`.
- If Cache Components is **not** enabled, use the previous revalidation model consistently instead — the failure
  mode to avoid is a half-and-half codebase.

### Performance (§94)
- `next/image` everywhere with correct `sizes`; AVIF/WebP; blur placeholders on hero images.
- Pagination on every list — customer, staff and admin. No unbounded `find()` in any repository (assert in review).
- Projections: fetch only the fields a view needs.
- Verify the ticket-02 indexes cover every hot query; add a CI check that fails on a `COLLSCAN` in the
  slow-query log for known queries.
- `next/font` self-hosted; no render-blocking third-party scripts on public pages.
- Bundle budget: alert if the public route's first-load JS exceeds an agreed ceiling.

### Observability (§95)
- **Error tracking**: Sentry on server and client, with release tagging and source maps.
- **Structured logging** (pino) with a request id propagated through services; never log secrets, card data,
  licence keys or demo credentials.
- **Payment monitoring**: alert on failed webhook verification, on payments pending > 30 min, and on any
  `requires_review` payment (ticket 13).
- **Job monitoring**: alert on dead-letter growth and on oldest-pending age (ticket 25).
- **AI monitoring**: token spend per day, error rate, refusal rate, p95 latency.
- Uptime checks on `/`, `/marketplace`, and a `/api/health` that verifies database and storage connectivity.

## Acceptance criteria
- [ ] Lighthouse on a product page: Performance ≥ 90, SEO 100, Accessibility ≥ 95.
- [ ] Product JSON-LD passes Google's Rich Results test.
- [ ] `sitemap.xml` lists only published products and updates within the cache window after publishing.
- [ ] `robots.txt` blocks every authenticated area.
- [ ] Renaming a product slug 301s the old URL.
- [ ] The caching strategy is applied consistently — no route mixes the two models.
- [ ] Publishing a product invalidates the cached catalog within the documented window.
- [ ] No repository method can return an unbounded result set.
- [ ] A deliberately thrown server error appears in Sentry with request id and release.
- [ ] Simulating a stuck payment fires the alert.
- [ ] No secret or credential appears anywhere in the logs (grep a day of staging logs).

---

## Carried over from ticket 04 — the public surface is dynamic

`(public)/layout.tsx` calls `getSession()` so the header can render "Dashboard"
rather than "Sign in" on the **first paint**, with no flash and no JavaScript. The
cost is that `headers()` is read in the layout, so `/`, `/marketplace`, `/pricing`
and the rest are server-rendered per request instead of prerendered as static:

```
before ticket 04:  ○ /            (Static)
after  ticket 04:  ƒ /            (Dynamic)
```

That is the right default for correctness and the wrong one for the two pages
that matter most to SEO and to first-visit latency. It was accepted rather than
worked around, because the alternatives are worse in isolation:

- **A client-side session island** makes the pages static again and reintroduces
  the flash of the wrong header, plus a request on every page view.
- **No session in the header** means a signed-in customer is invited to sign in.

The real fix is **partial prerendering** — a static shell with the auth-dependent
corner of the header as a dynamic hole. In Next.js 16 that means Cache Components
(`use cache` / `cacheLife` / `cacheTag`), which is an architecture-wide decision
that belongs here rather than in a shell ticket.

Scope for this ticket:
- [ ] Evaluate `cacheComponents: true` and PPR for the `(public)` segment.
- [ ] Wrap the session-dependent header slot in Suspense so the shell prerenders.
- [ ] Confirm `/` and `/marketplace` return to static (or PPR) in the build output.
- [ ] Measure first-visit latency before and after — the point is the number, not
      the badge in the route table.

