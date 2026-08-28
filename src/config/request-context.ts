/**
 * The current URL, forwarded from the proxy so a layout can read it.
 *
 * Its own module, dependency-free, for exactly the reason `observability.ts`
 * gives about itself: `proxy.ts` runs on the **Edge runtime**, so a constant
 * shared across that boundary has to live somewhere that imports nothing.
 *
 * Deliberately *not* in `observability.ts`. That module's stated scope is the
 * correlation id shared with the logger. This is a value that becomes an `href`
 * in our own markup, which is a different thing with a different trust rule —
 * see below.
 */

/**
 * `pathname + search` of the request being rendered.
 *
 * ## Why this exists
 *
 * A Server Component in a layout has no `searchParams` and no pathname. The
 * public header needs both, because the currency switcher's links are "the URL
 * you are on, with `?currency=` rewritten" — and that has to preserve the
 * filters, the sort and the page you were looking at.
 *
 * ## It is always overwritten, never honoured
 *
 * `new Headers(request.headers)` copies whatever the client sent, so an inbound
 * `x-pathname: https://evil.example/` would arrive here unless the proxy
 * `set`s it. It does, unconditionally.
 *
 * That is the opposite call from `REQUEST_ID_HEADER`, which deliberately honours
 * an inbound value so a trace started at a load balancer keeps its identity —
 * safe there precisely because a request id is a log field and nothing else.
 * This value is rendered into `href` attributes, so it gets no such courtesy.
 * `currencySwitchHref` sanitises it a second time on the way out, because
 * defence in depth is cheap and a future matcher change should not be able to
 * turn this into an off-site link.
 *
 * Carries **no origin** — a path and a query string only.
 */
export const CURRENT_PATH_HEADER = "x-pathname";

/**
 * Longest value the proxy will forward.
 *
 * Forwarded request headers are re-encoded onto Next's own
 * `x-middleware-request-*` headers, and a blown header budget fails at the edge
 * as a 431 with no obvious cause. A heavily filtered marketplace URL is long but
 * nowhere near this; past it, the path alone is forwarded and the query is
 * dropped, which degrades the switcher to "switch, and lose your filters"
 * rather than to a broken request.
 */
export const CURRENT_PATH_MAX_LENGTH = 2048;
