import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { cacheLife } from "next/cache";
import { serverEnv } from "@/config/env";

/**
 * Would a browser let us put this URL in the preview page's `<iframe>` — ticket 31.
 *
 * ## Why this has to happen on the server
 *
 * `preview-stage.tsx` states the constraint and it is accurate: a refusal to be
 * framed **is not observable from script**. Chrome fires `load` on a blocked
 * frame (it loaded an error page) and no `error` event either way;
 * `securitypolicyviolation` fires only when *our* CSP blocks, never when the
 * remote host refuses; and reading into `contentWindow` throws identically for a
 * successful cross-origin load and a blocked one. There is no client-side test
 * that separates **blocked** from **slow** from **fine**.
 *
 * So the only way to know is to ask the host ourselves and read the two headers
 * a browser would read.
 *
 * ## Three verdicts, and the third is the point
 *
 * `unknown` is not a tidier `blocked`. A probe that timed out, was refused by
 * the vendor's WAF, or hit a host we decline to contact has learned **nothing**
 * about whether a browser could frame it — and rendering the fallback on that
 * basis would replace a working demo with a message saying it does not work.
 *
 * **`unknown` renders the frame.** Fail open, always: a false "this cannot be
 * embedded" is worse than the blank rectangle, because the rectangle at least
 * has the open-in-a-new-tab control beside it.
 */
export type FrameVerdict = "allowed" | "blocked" | "unknown";

/**
 * The whole probe, across every redirect hop. Deliberately short — this runs
 * inside a page render, and a dead host must never hold one up.
 */
const PROBE_TIMEOUT_MS = 3_000;

/** Enough for `http→https`, `apex→www` and a login bounce; not enough to be a loop. */
const MAX_REDIRECTS = 5;

/**
 * Sent so a vendor reading their access log can tell what this is, and so a WAF
 * that dislikes us has something specific to allow.
 */
const PROBE_USER_AGENT = "CoSetupFrameCheck/1.0 (+https://cosetup.net)";

/* ────────────────────────────────────────────── the header rules */

/**
 * The browser's decision, as a pure function of the two headers.
 *
 * Exported for its own sake: this is the part with the edge cases, and it is
 * testable without a network, a database or a request.
 *
 * `viewerOrigin` is us — the page doing the framing. `targetOrigin` is the
 * document being framed, needed only to resolve `'self'`.
 */
export function verdictFromHeaders(
  xFrameOptions: string | null,
  contentSecurityPolicy: string | null,
  viewerOrigin: string,
  targetOrigin: string,
): "allowed" | "blocked" {
  if (blockedByFrameOptions(xFrameOptions)) return "blocked";
  if (blockedByFrameAncestors(contentSecurityPolicy, viewerOrigin, targetOrigin))
    return "blocked";
  return "allowed";
}

/**
 * `X-Frame-Options`.
 *
 * `DENY` and `SAMEORIGIN` both mean no: "same origin" is *theirs*, and we are
 * never it — the preview page refuses any target that is not an absolute
 * `https:` URL, and where it is our own origin the answer is no anyway.
 *
 * **`ALLOW-FROM` is treated as no restriction, not as a refusal**, which is the
 * opposite of what ticket 31 first said. Every current browser ignores it
 * outright, so a host sending only `ALLOW-FROM` frames fine in practice — and
 * this function's job is to predict the browser, not to grade the header. Being
 * strict here would manufacture a false `blocked`, which is the one error this
 * feature must not make.
 *
 * A repeated header arrives from `Headers.get` joined with `", "`, and browsers
 * treat conflicting values as a refusal, so any `DENY`/`SAMEORIGIN` in the list
 * wins.
 */
function blockedByFrameOptions(header: string | null): boolean {
  if (!header) return false;

  return header
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "deny" || value === "sameorigin");
}

/**
 * CSP `frame-ancestors`.
 *
 * Three things about this directive that a naive reading gets wrong:
 *
 * 1. **Absent means allowed.** It is not default-deny, and it does **not** fall
 *    back to `default-src` — a strict CSP with no `frame-ancestors` places no
 *    restriction on framing at all.
 * 2. **Multiple policies are an intersection.** Whether they arrive as repeated
 *    headers (joined by `Headers.get` with `", "`) or as one comma-separated
 *    value, the frame must satisfy *every* policy. So splitting on `,` and
 *    blocking if any policy blocks is both simpler and correct.
 * 3. **An empty source list is `'none'`.** `frame-ancestors;` refuses everyone.
 */
function blockedByFrameAncestors(
  header: string | null,
  viewerOrigin: string,
  targetOrigin: string,
): boolean {
  if (!header) return false;

  return header
    .split(",")
    .some((policy) => policyRefusesFraming(policy, viewerOrigin, targetOrigin));
}

function policyRefusesFraming(
  policy: string,
  viewerOrigin: string,
  targetOrigin: string,
): boolean {
  for (const directive of policy.split(";")) {
    const tokens = directive.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (name !== "frame-ancestors") continue;

    const sources = tokens.slice(1);
    // `frame-ancestors;` — present, empty, and therefore `'none'`.
    if (sources.length === 0) return true;

    return !sources.some((source) => sourceAdmits(source, viewerOrigin, targetOrigin));
  }

  // No `frame-ancestors` in this policy. See (1) above — that is a permission.
  return false;
}

/**
 * Does one source expression admit us?
 *
 * **Deliberately lenient about scheme and port.** The CSP grammar says a
 * host-source with no scheme matches only the protected resource's scheme (or an
 * upgrade), and one with no port matches only the scheme's default port. Both of
 * those refinements can only ever turn an `allowed` into a `blocked`, and a
 * false `blocked` is the expensive error here — so a bare `cosetup.net` is read
 * as "us, on any scheme, on any port".
 */
function sourceAdmits(source: string, viewerOrigin: string, targetOrigin: string): boolean {
  const value = source.toLowerCase();

  if (value === "'none'") return false;
  if (value === "*") return true;

  let viewer: URL;
  try {
    viewer = new URL(viewerOrigin);
  } catch {
    return false;
  }

  // `'self'` is the framed document's own origin — relevant only when a product
  // points its demo at the site it is listed on, which is the case that started
  // this ticket.
  if (value === "'self'") {
    try {
      return new URL(targetOrigin).origin === viewer.origin;
    } catch {
      return false;
    }
  }

  // A scheme-source: `https:`, `http:`.
  if (/^[a-z][a-z0-9+.-]*:$/.test(value)) return value === viewer.protocol;

  // A host-source: `[scheme://]host[:port]`, host optionally `*.`-prefixed.
  const parsed = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\*\.)?([^:/*]+)(?::(\*|\d+))?$/.exec(value);
  if (!parsed) return false;

  const [, wildcard, host] = parsed;
  if (!host) return false;

  const hostname = viewer.hostname.toLowerCase();
  return wildcard ? hostname.endsWith(`.${host}`) : hostname === host;
}

/* ────────────────────────────────────────────── SSRF (§88) */

/**
 * Is this address one we are willing to send a request to?
 *
 * The probe fetches a **vendor-supplied URL from our server**, which is a
 * textbook SSRF primitive and the riskiest thing in ticket 31. Everything that
 * is not plainly on the public internet is refused: loopback, the RFC1918
 * ranges, carrier-grade NAT, link-local — `169.254.169.254` most of all, which
 * is the cloud metadata endpoint and the reason SSRF is worth exploiting at all
 * — multicast, reserved space, and the IPv6 equivalents of each.
 *
 * Exported so the list itself is tested rather than trusted.
 */
export function isPubliclyRoutable(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(address);
  if (version === 6) return isPublicV6(address);
  // Not an IP literal at all. Nothing reaches this that has not been through
  // `lookup()`, so this is a refusal rather than a fallthrough.
  return false;
}

function isPublicV4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a, b, c] = octets;
  if (octets.length !== 4) return false;
  if (a === undefined || b === undefined || c === undefined) return false;
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  if (a === 0) return false; // "this network"
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT, RFC6598
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking, RFC2544

  /*
   * The /24s, and they must be matched **as /24s**.
   *
   * An earlier version of this function refused these on their first two octets,
   * which quietly took `192.0.0.0/16`, `198.51.0.0/16` and `203.0.0.0/16` out of
   * the public internet. No unit test noticed, because every address anyone
   * thinks to write down as an example is inside the /24 that is genuinely
   * reserved. `npm run frame:probe` noticed within a minute: `iana.org` is
   * `192.0.43.8`, two octets into a range the check had claimed was private, and
   * the probe refused to contact it.
   */
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3

  if (a >= 224) return false; // multicast, reserved, broadcast

  return true;
}

function isPublicV6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0] ?? "";

  // An IPv4-mapped address is an IPv4 address wearing a costume, and it is the
  // standard way past a v6-only check.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isPublicV4(mapped[1]);

  if (value === "::" || value === "::1") return false; // unspecified, loopback
  if (/^f[cd]/.test(value)) return false; // fc00::/7, unique local
  if (/^fe[89ab]/.test(value)) return false; // fe80::/10, link-local
  if (/^ff/.test(value)) return false; // multicast
  if (value.startsWith("2001:db8")) return false; // documentation
  if (value.startsWith("64:ff9b")) return false; // NAT64
  if (/^0100:0{0,3}:/.test(value) || value.startsWith("100::")) return false; // discard-only

  return true;
}

/**
 * Every address this hostname resolves to must be public, not merely the first.
 *
 * A name with one public and one private A record is the cheapest way past a
 * check that stops at `addresses[0]`.
 *
 * **This does not close DNS rebinding**, and pretending otherwise would be
 * worse than saying so: the name is resolved here and resolved again by `fetch`,
 * and the two are separate lookups. Closing it properly means connecting to a
 * vetted IP with a `Host` header, which `fetch` gives no way to express. What
 * this does close is the ordinary case — a vendor, or someone editing a product,
 * pointing a demo URL at `localhost`, an internal host, or the metadata endpoint.
 */
async function resolvesPublicly(hostname: string): Promise<boolean> {
  // An IP literal in the URL never reaches DNS; judge it directly.
  if (isIP(hostname)) return isPubliclyRoutable(hostname);

  try {
    const addresses = await lookup(hostname, { all: true });
    return (
      addresses.length > 0 && addresses.every(({ address }) => isPubliclyRoutable(address))
    );
  } catch {
    // NXDOMAIN, or no resolver. Not a refusal to answer — an inability to.
    return false;
  }
}

/* ────────────────────────────────────────────── the probe */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Ask the host, following redirects by hand.
 *
 * **`GET`, not `HEAD`.** Hosts return 405 for `HEAD`, or answer it without the
 * security headers they attach to a real response, and a probe that reads a
 * header the browser will never see is worse than no probe.
 *
 * **The final response is what counts.** The case that produced this ticket was
 * a Vercel deployment whose own responses are perfectly frameable and whose
 * *challenge page*, served to a visitor with no cookie, is not. The `302` is
 * clean; judging it would call that demo frameable and ship the blank rectangle
 * anyway. So redirects are followed manually, one at a time, with the address
 * check repeated at **every hop** — a public URL that redirects to
 * `169.254.169.254` defeats a check that only runs on the first.
 *
 * Exported as the **uncached** level. `frameability` below is what application
 * code calls; a `use cache` function throws outside a Next request, so
 * `scripts/frame-probe.ts` — and anything else that must not share a cache entry
 * — reaches for this one instead.
 */
export async function probeFrameability(rawUrl: string): Promise<FrameVerdict> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return "unknown";
  }

  // One deadline for the whole walk, not one per hop — five slow redirects must
  // not add up to fifteen seconds of a page render.
  const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const viewerOrigin = ourOrigin();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Callers pre-filter with `embeddable()`; this is the backstop, and it also
    // catches an `https` URL that redirects down to `http`.
    if (current.protocol !== "https:") return "unknown";
    if (!(await resolvesPublicly(current.hostname))) return "unknown";

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: deadline,
        credentials: "omit",
        referrer: "",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": PROBE_USER_AGENT,
        },
      });
    } catch {
      // Timeout, DNS failure, TLS failure, connection refused, a WAF hanging up.
      // None of them is evidence about framing.
      return "unknown";
    }

    // The body is never read. Cancelling releases the socket without buffering
    // a vendor's page into this process — the only bytes that matter are in the
    // headers, and `verifyUpload()`'s 4KB range read is the same instinct.
    await response.body?.cancel().catch(() => {});

    const location = response.headers.get("location");
    if (REDIRECT_STATUSES.has(response.status) && location) {
      try {
        current = new URL(location, current);
      } catch {
        return "unknown";
      }
      continue;
    }

    return verdictFromHeaders(
      response.headers.get("x-frame-options"),
      response.headers.get("content-security-policy"),
      viewerOrigin,
      current.origin,
    );
  }

  // A redirect loop, or a chain longer than any honest demo needs.
  return "unknown";
}

/**
 * Us, as the browser would see us.
 *
 * A vendor who allowlists anything allowlists the production origin, so a
 * verdict computed in development — where `APP_URL` is `localhost:3000` — can
 * differ from the one production would reach for that one vendor. It is a
 * false `blocked` confined to dev, on a configuration almost nobody has, and
 * the alternative is hard-coding a domain in a file that has no other reason to
 * know one.
 */
function ourOrigin(): string {
  try {
    return new URL(serverEnv().APP_URL).origin;
  } catch {
    return "https://cosetup.net";
  }
}

/* ────────────────────────────────────────────── the cached entry point */

/**
 * The verdict for one URL, cached.
 *
 * **Keyed on the URL, not the product.** Vendors sharing a host share an entry,
 * a re-probe benefits every listing on it, and a product with three demo
 * addresses on one domain costs one probe rather than three.
 *
 * The three lifetimes are not decoration — each verdict decays at a different
 * rate:
 *
 * - `allowed` is a property of somebody's server configuration and changes
 *   rarely, so a day is fine.
 * - `blocked` is a bug the vendor has just been told about in the wizard. An
 *   hour is the longest they should have to wait to see that their fix took.
 * - `unknown` is not a finding at all — it is a probe that failed. Minutes, so a
 *   host that was briefly unreachable is not written off for the afternoon.
 */
export async function frameability(url: string): Promise<FrameVerdict> {
  "use cache";

  const verdict = await probeFrameability(url);

  if (verdict === "allowed") cacheLife({ stale: 3600, revalidate: 86_400, expire: 172_800 });
  else if (verdict === "blocked") cacheLife({ stale: 60, revalidate: 3600, expire: 7200 });
  else cacheLife({ stale: 0, revalidate: 300, expire: 600 });

  return verdict;
}

/**
 * The verdicts for several URLs at once, in parallel.
 *
 * The preview page has up to three targets and the wizard notice has exactly
 * three fields; both want them concurrently, and neither should serialise three
 * three-second timeouts into nine.
 */
export async function frameabilityOf(
  urls: readonly string[],
): Promise<Map<string, FrameVerdict>> {
  const unique = [...new Set(urls)];
  const verdicts = await Promise.all(unique.map((url) => frameability(url)));
  return new Map(unique.map((url, index) => [url, verdicts[index] ?? "unknown"]));
}
