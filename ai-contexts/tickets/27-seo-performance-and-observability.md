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
- [ ] Lighthouse on a product page: Performance ≥ 90, SEO 100, Accessibility ≥ 95. — **needs a browser; ticket 29**
- [ ] Product JSON-LD passes Google's Rich Results test. — **needs a public URL; ticket 29**
- [x] `sitemap.xml` lists only published products and updates within the cache window after publishing.
- [x] `robots.txt` blocks every authenticated area.
- [x] Renaming a product slug 301s the old URL. — already true; `permanentRedirect` (308), which is the one that transfers ranking.
- [x] The caching strategy is applied consistently — no route mixes the two models.
- [x] Publishing a product invalidates the cached catalog within the documented window.
- [x] No repository method can return an unbounded result set.
- [x] A deliberately thrown server error is logged with a request id — via `onRequestError`, not Sentry. See below.
- [x] Simulating a stuck payment fires the alert.
- [x] No secret or credential appears anywhere in the logs — the logger redacts by key, sharing the audit log's rule.

## Carried over from ticket 04 — already resolved
- [x] Evaluate `cacheComponents: true` and PPR for the `(public)` segment.
- [x] Wrap the session-dependent header slot in Suspense so the shell prerenders.
- [x] Confirm `/` and `/marketplace` return to static (or PPR) in the build output.
- [x] Measure first-visit latency before and after.

---

## What shipped, and what did not

### Observability, without Sentry

`NEXT_PUBLIC_SENTRY_DSN` has been in `.env.example` since ticket 00 and there is
no account behind it. Wiring a client against credentials that do not exist
produces code nobody has run, so what shipped is the part that would otherwise
never get decided:

- **`src/lib/logger.ts`** — JSON lines, levels, a request id, and redaction that
  **reuses the audit log's rule** (moved to `src/lib/redact.ts` so there is one
  rule rather than two, one of which is weaker and nobody knows which).
  `log.exception` flattens an `Error`, because `JSON.stringify(error)` is `{}`
  — its properties are non-enumerable — so an unstructured logger records
  nothing for the one field anybody wanted.
- **`src/lib/alerts.ts`** — the *conditions*, with stable codes. `payment.stuck`,
  `payment.requires_review`, `job.dead_lettered`, `webhook.verification_failed`,
  `health.dependency_down`. A code is a routing rule the moment there is
  somewhere to route it; a message is not, because improving the wording would
  silently disable the alert built on it.
- **`onRequestError`** in `instrumentation.ts` — every uncaught server error, with
  the `digest` the error page asks the customer to quote. Without that, "quote
  this reference" was theatre. This is also the Sentry seam:
  `Sentry.captureRequestError` goes here and nothing else changes.
- **`/api/health`** — Mongo ping plus an S3 HEAD, 503 when either is down.

`console.error` survives in exactly one place — `app/error.tsx` — because it is
a Client Component and `@/lib/logger` imports `server-only`. The server side of
that same error is already recorded by `onRequestError` with the same digest, so
nothing is lost. The comment says so rather than promising a future fix.

### Three defects found by measuring

1. **`sitemap.ts` advertised `/about` and `/contact`, and neither route exists.**
   `typedRoutes` makes a `<Link>` to a missing route a compile error and cannot
   see inside a template string, so the build was clean while the one file whose
   job is telling crawlers where the pages are listed two 404s. A crawler that
   finds 404s in a sitemap discounts the whole file. Removed, and `sitemap.test.ts`
   now checks every static path against `src/app`.

2. **`/api/health` reported itself unhealthy on a cold start.** The first request
   to a freshly started production server returned `storage: false` with
   `ms: 3012` — the timeout, exactly. The S3 HEAD takes 125–165ms warm; the first
   pays for SDK initialisation, credential resolution and TLS and went past three
   seconds. A health check that fails on cold start flaps on any platform that
   scales to zero, and a monitor that cries wolf gets muted. The budget is now
   8s, sized for the slowest *legitimate* response. Found by starting the build
   and calling it — the code was right and the number was wrong.

3. **The product page's JSON-LD had `currency="GBP"` hard-coded at the call
   site**, while the component had always taken the prop. The storefront's
   configured default and the price advertised to a crawler could silently
   disagree. Now `DEFAULT_CURRENCY`.

### SEO

`pageMetadata()` gives every hand-written public page a canonical, Open Graph and
a Twitter card. Before this, `alternates.canonical` was on **one route out of
seventeen** and OG on none — and `/`, the most-linked URL on the site, had no
metadata of its own at all.

Site-wide `Organization` + `WebSite` (with `SearchAction`) in the public layout,
`@id`-anchored so the product pages' `seller` refers to the same entity rather
than declaring a second one with the same name. `BreadcrumbList` on product
pages, **derived from the same array as the visible breadcrumb** — two hand-kept
lists disagree the first time somebody edits one, and disagreeing is a
structured-data policy violation rather than an untidiness.

Plus a generated `opengraph-image` (50KB PNG, no custom font — see the file for
why) and a `manifest.ts`.

### Cache Components

Ten `instant = false` opt-outs removed — every page that reads nothing
per-request. In the build output:

| Route | Before | After |
|---|---|---|
| `/` | `ƒ` dynamic | `◐` PPR |
| `/pricing`, `/services`, `/terms`, `/privacy` | `ƒ` | `◐` |
| `/concepts/*` (5 routes) | `ƒ` | `○` fully static |

Twenty-one opt-outs remain, all on `dashboard`, `staff`, `admin` and `(auth)`
routes that genuinely read a session per request. Those are honest, not debt.

**The number, not the badge** — production build, best of five after a warm-up:

```
/              TTFB 5.8ms
/marketplace   TTFB 5.4ms
/pricing       TTFB 4.3ms
/concepts      TTFB 3.5ms
```

### Bounded reads

`StaffProfile.find({ isActive: true })` ran **unbounded on every notification
dispatch**. It cannot be a query — the permission is derived from `roles` by
`permissionsForRoles`, which is §77's point — so it reads and filters in memory.
Now capped at 100 with a `log.warn` if the cap is ever reached, because a
silently truncated audience is a notification nobody gets. Same treatment for
organisation members and entitled owners.

### Not done

- **Sentry.** No DSN. The seam is `onRequestError`, one function.
- **Lighthouse and Rich Results.** Both need a browser or a public URL. On the
  ticket-29 checklist, where the human checklist already names product-wise SEO.
- **Per-product OG images.** The site default covers every page; a per-product
  card is a copy of `opengraph-image.tsx` with the product name in it, and is
  worth doing when there is design input on what it should say.
- **A CI check that fails on a `COLLSCAN`.** `npm run db:explain` and
  `db:explain:queues` exist and are run by hand; turning them into a gate is
  ticket 28's shape of work and was not done.

## Live verification (2026-08-16)

Against the **production build** (`next start`), not the dev server:

```
canonical + OG on /pricing
  <link rel="canonical" href=".../pricing"/>
  og:title, og:description, og:url, og:site_name, og:type   ✓

JSON-LD on /                     Organization, WebSite, SearchAction, EntryPoint
JSON-LD on /marketplace/atlas-crm  + SoftwareApplication, Offer, BreadcrumbList, ListItem

/opengraph-image                 200 image/png 50,261 bytes
/manifest.webmanifest            200

every sitemap URL                200  (9 of 9 spot-checked, including taxonomy landings)

/api/health  cold  {"ok":true,"database":true,"storage":true,"ms":527}
             warm  {"ok":true,"database":true,"storage":true,"ms":125}
```

The guard test from ticket 26 caught `/api/health` the moment it was added and
refused to pass until the exemption was written down with its reason — which is
the behaviour that test exists for.

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

