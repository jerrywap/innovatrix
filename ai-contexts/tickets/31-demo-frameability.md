# 31 — Demo frameability: detect, cache, degrade

**Bucket:** post-MVP follow-up · **Depends on:** 07 (demos), 09 (product detail), 26 (headers) · **Blocks:** —
· **Size:** M
**Spec:** §88 (security), §8 (plain language)

## Why

`/preview/[slug]` frames a vendor's demo. When the demo's host refuses to be framed, the visitor
gets a blank rectangle, a line of 11.5px small print, and no reason — and concludes the product is
broken rather than that the vendor's server said no.

Two confirmed cases, both real:

- `cosetup.net` as a demo URL. Ticket 26 puts `frame-ancestors 'none'` and `X-Frame-Options: DENY`
  on `/:path*` (`next.config.ts:183`), so the platform cannot frame itself. Permanent, never
  recovers on reload — which is how a header refusal always behaves.
- A Vercel deployment behind Deployment Protection. The app was fine; the SSO/challenge page served
  to an unauthenticated visitor was not. Recovered on the second attempt once a cookie existed,
  which is how a *stateful* refusal behaves and is why the two must not share a diagnosis.

**This cannot be fixed in the browser.** `preview-stage.tsx:26` already states the constraint and it
is accurate:

> A site can refuse to be framed with its own `X-Frame-Options` or `frame-ancestors`, and that
> refusal is not observable from script — the frame simply stays blank, `onLoad` may or may not
> fire, and there is nothing to catch.

Chrome fires `load` on a blocked frame (it loaded an error page) and no `error` event either way.
`securitypolicyviolation` fires only when *our* CSP blocks, never when the remote host refuses.
Reading into `contentWindow` throws identically for a successful cross-origin load and a blocked
one. There is no client-side test separating **blocked** from **slow** from **fine** — which is the
whole reason this is a ticket rather than a patch.

## Scope

### 1. The probe

A server-side check that answers one question: *would a browser let us frame this URL?*

- **`GET`, not `HEAD`.** Hosts return 405 for `HEAD`, or answer it without the security headers they
  send on a real response. Read and discard — `verifyUpload()`'s 4KB range read is the precedent for
  reading only what is needed.
- **Follow redirects and judge the final response.** This is the Vercel case: the 302 is clean and
  the page it lands on carries `X-Frame-Options: DENY`. Judging the redirect calls it frameable.
- **`X-Frame-Options`** — `DENY` and `SAMEORIGIN` both mean blocked; "same origin" is theirs, not
  ours. **`ALLOW-FROM` is no restriction at all**, which corrects this ticket's first draft: every
  current browser ignores the value outright, so a host sending only `ALLOW-FROM` frames fine in
  practice. This function predicts the browser rather than grading the header, and being strict
  here would manufacture a false `blocked` — the one error the feature must not make.
- **CSP `frame-ancestors`** — absent means allowed (it is not default-deny). `'none'` is blocked.
  A list must admit `https://cosetup.net`; accept the wildcard and scheme forms (`https:`, `*`).
  Note the directive is **not** subject to `default-src` fallback, so an absent `frame-ancestors`
  in a present CSP is still allowed.
- **Three verdicts, not a boolean: `allowed` | `blocked` | `unknown`.** Item 6 has nothing to stand
  on without the third. A boolean forces every timeout to become a lie in one direction or the other.

### 2. SSRF (§88)

The probe issues a server-side request to an arbitrary vendor-supplied URL. That is a textbook SSRF
primitive and it is the riskiest thing in this ticket.

- `https:` only — `embeddable()` already enforces this, and the probe must not be reachable by a
  path that skips it.
- Resolve the host and **reject private, loopback, link-local, ULA and metadata addresses**
  (`169.254.169.254` especially), re-checking **at every redirect hop**, not just the first. Cap the
  hop count.
- Hard total timeout, ~3s. A dead host must never hold up a page render.
- No credentials, no cookies, no forwarded headers. Nothing about the viewer travels.
- Cap the bytes read; discard the body.
- **The verdict is the only thing that leaves this module.** Response headers and body must never
  reach a client — a probe that echoes the response is a read primitive wearing a feature.

### 3. Cache

- **Keyed on the URL, not the product**, so vendors sharing a host share an entry and a re-probe
  benefits everyone on it.
- Different TTLs by verdict, because they decay at different rates: `allowed` is stable and can live
  ~24h; `blocked` should re-check sooner (~1h) because a vendor told to fix it will fix it and should
  not wait a day to see the result; `unknown` is minutes at most.
- **`unknown` is never persisted as a verdict.** It means the probe failed, not that the site did.

### 4. Where the verdict is produced

Both ends, doing different jobs:

- **At save, in the wizard.** The vendor is told while the field is still in front of them, with the
  guidance from item 8. This is the highest-value half — it converts a support ticket into
  self-service, and it is the only point at which anyone can actually fix the problem.

  **Built as part of the step, not as a save-time result**, because `saveDemoAction` redirects on
  success and anything returned in its `ActionResult` is discarded by the navigation. Rendering it
  on the page means it is there on arrival, there on return, and current every time.
- **At render, cached.** The wizard verdict goes stale the moment the vendor puts Cloudflare in front
  of their demo, so the render-time probe is the authority. `PreviewTargets` is already `async` and
  already inside a `<Suspense>` (`page.tsx:80`), so there is a natural home that does not make the
  route dynamic.

**Fail open.** A probe that times out, errors, or is refused by the vendor's WAF yields `unknown`,
and `unknown` renders the frame. A false "this cannot be embedded" on a demo that works is worse
than the blank rectangle, because the rectangle at least has the escape hatch beside it.

### 5. `blocked` — the fallback stage

- **Do not render the `<iframe>` at all.** Not hidden, not zero-height — absent.
- **Prefer screenshots over an empty card.** `page.tsx:88` already renders `ScreenshotStage` for the
  ~995 products with no demo URL, and a blocked demo is closer to that case than to nothing. The
  visitor gets something to look at, and `PreviewBar` is already exported and shared by both stages
  for exactly this kind of reuse. Fall back to a bare card only where there are no screenshots.
- **The bar stays** — brand, product name, ✕, and the external-link control. That control is
  permanent by design and its docblock argues why; it does not become a fallback now that there is
  one.
- **Hide the width switcher.** `preview-stage.tsx` renders it unconditionally. With no frame to
  resize, three device buttons are a control that does nothing — the same reasoning that already
  guards the target tabs behind `targets.length > 1`.
- **Per target, not per product.** Public may frame while Admin does not. Do **not** drop a blocked
  target the way `embeddable()` drops a non-https one: an entitled viewer losing the Admin tab
  entirely is worse than being shown a link. Mark it unframeable and keep the tab.
- **Copy** — plain language, §8, and it must not name the mechanism. "This site blocks embedding"
  reads as *our* failure to a buyer who has never heard of an iframe.

  > **Continue to the live demo**
  > {AppName}'s demo runs on the vendor's own site, which opens in its own tab.
  > **[ Explore {AppName} ↗ ]**

### 6. `allowed` and `unknown` — unchanged

Render the iframe exactly as today. No new state, no spinner, no probing in the browser.

### 7. A timeout is not evidence

Stated as a rule because it is the tempting shortcut and it produces the worst possible bug — a
working demo replaced by a message saying it does not work.

- **No client-side timer may remove or replace the frame.** Ever. Not at 8 seconds, not at 30.
- If a soft affordance for a slow load is wanted, it **augments** — appears beside or beneath the
  frame, leaves it loading, and is worded as a question ("Taking a while? Open it in a new tab ↗")
  rather than as a verdict. It is optional; the permanent external-link control already covers this
  case, and the honest default is to add nothing.

### 8. Vendor-facing guidance

**Shipped inline in the wizard notice rather than as a standalone help page.** The whole of the
advice is three bullets and a `curl` line; a page would put it one click away from the only screen
where anyone can act on it, and `typedRoutes` plus "don't add a route just to satisfy a link" both
argue against inventing a public route to hold four sentences. A help page stays available if the
same text turns out to be wanted somewhere else.

To be previewable, a demo must be `https:`, must send no `X-Frame-Options` at any value, and — if it
sends a CSP at all — must include `https://cosetup.net` in `frame-ancestors`.

The self-test, which is the part worth putting first:

```sh
curl -sI https://their-demo.example | grep -iE "x-frame-options|content-security-policy"
```

Where it bites, and these are defaults rather than decisions, which is why vendors are surprised:
**Rails** (`SAMEORIGIN` by default), **Django** (`XFrameOptionsMiddleware`, `DENY`, on by default),
**WordPress security plugins**, **Cloudflare** managed transform rules, **Vercel Deployment
Protection** (the app is fine, the challenge page is not), and the circulating `next.config.js`
security-headers snippet that includes `SAMEORIGIN` — the same trap this codebase is in, from the
other side. **Wix** and some Shopify routes refuse outright and cannot be configured; those vendors
need screenshots, not a live demo.

## Out of scope

- **Relaxing our own `frame-ancestors`.** No. Dropping site-wide clickjacking protection to make a
  demo URL work is the wrong trade, and the only URLs it would help are ours, which should never be
  demo URLs.
- **Anything the probe cannot see.** A demo can pass, frame, and still misbehave: the sandbox omits
  `allow-modals` (so `alert()`/`confirm()` silently do nothing) and `allow-downloads` (export buttons
  dead), and a login inside the frame needs `SameSite=None; Secure` and probably `Partitioned` or it
  will appear to succeed and bounce. No detection sees any of this coming. It belongs in item 8's
  guidance, not in the feature.

## Testing

Per `AGENTS.md § Testing`, the default altitude is the unit project and this ticket earns nothing
above it.

- **Unit** — the header parser against a matrix of `X-Frame-Options` and `frame-ancestors` values
  (absent, `'none'`, a list with and without us, `https:`, `*`, `ALLOW-FROM`); the address predicate
  behind item 2, including each redirect hop; the three-way verdict mapping.
- **No integration test.** There is no transaction, no real index, no cross-collection invariant and
  no tenancy scoping here — which is the whole of the list that earns one.
- **No fifteenth enforcement test.** The set is closed at fourteen and this ticket does not reopen it.
- The stage states cannot be asserted: both vitest projects are `environment: "node"`, so nothing in
  this suite renders a component. That is what `## Live verification` is for.

## Live verification

Drive against the real dev database and paste what happened, not test counts:

- a known-blocked URL (`https://cosetup.net/`) → verdict `blocked`, no `<iframe>` in the markup,
  fallback stage rendered, width switcher absent
- a known-good vendor demo → verdict `allowed`, frame renders, page unchanged from today
- an unreachable host → verdict `unknown` within the timeout budget, frame rendered anyway
- a redirect to a blocked page → `blocked`, proving the final response was judged and not the 302
- `http://127.0.0.1`, `http://169.254.169.254`, and a public URL that *redirects* to each → refused
  at the right hop
- the second render of the same URL served from cache — check the probe did not run twice

## Resolved — nothing is stored, and no field was added

The open question was where to put the wizard-time verdict on `ProductDoc`, and the answer turned
out to be nowhere.

`frameability` is cached on the **URL**, so the probe the wizard notice runs is the same cache entry
the preview page reads. The two cannot disagree, the wizard gets a verdict that is current rather
than one captured at save time, and a vendor who fixes their headers sees the notice clear within
the `blocked` profile's hour rather than having to re-save to refresh a stored field.

That also means `template-sibling.ts` never had to be touched. The `EXCLUDED` `Record` would have
failed the build naming the new field — by design, and correctly — but the cheapest way to satisfy a
compiler that demands a decision about a field is not to add the field.

## Live verification

`npm run frame:probe`, against real hosts, on 2026-09-06:

```
✓ blocked    430ms  https://cosetup.net/          our own site — frame-ancestors 'none' (ticket 26)
✓ blocked    193ms  https://www.google.com/       X-Frame-Options: SAMEORIGIN
✓ blocked    195ms  https://github.com/           frame-ancestors 'none'
✓ allowed    122ms  https://example.com/          neither header
✓ blocked    444ms  https://iana.org/             301 with no headers -> www, which sends DENY
✓ unknown   3003ms  https://neverssl.com/         no https listener — the 3s deadline, fail-open
✓ unknown      1ms  https://127.0.0.1/            SSRF guard: loopback, refused before any request
✓ unknown      0ms  https://169.254.169.254/      SSRF guard: cloud metadata
✓ unknown     28ms  https://…-31.invalid/         DNS failure is not a verdict
```

The `iana.org` row is the one that matters: the `301` carries no framing header at all and the
`www` host it lands on sends `DENY`. Judging the redirect would have called that demo frameable —
which is precisely the shape of the Vercel challenge-page failure that opened this ticket.

**The probe found a bug the unit tests had not.** `isPubliclyRoutable` refused the reserved blocks on
their first two octets, which quietly took `192.0.0.0/16`, `198.51.0.0/16` and `203.0.0.0/16` out of
the public internet. Nothing caught it, because every address anyone writes down as an example sits
inside the /24 that genuinely is reserved. `iana.org` is `192.0.43.8`, and the probe declined to
contact it. Fixed to match on the third octet, and the case is now in `frameability.test.ts`.

The blocked stage, against the dev database (`gracia-daily`, its public demo pointed at
`https://cosetup.net` and then restored):

```
GET /preview/gracia-daily            200
  <iframe> in the markup             0        the frame is absent, not hidden
  "Continue to the live demo"        1        the fallback card
  "Preview width" switcher           0        hidden — nothing to resize
  screenshot + prev/next             present  degrades to screenshots, not an empty card
  CTA href                           https://cosetup.net, target=_blank rel=noopener
```

With the demo restored to a frameable host, the same URL renders one `<iframe>` and the width
switcher returns.

Route rendering modes after the change: `/preview/[slug]` is `◐`, both demo wizard steps are `◐` —
unchanged, so nothing became dynamic.

One thing this could not verify: the wizard notice's appearance needs an authenticated session, so
it has build, typecheck and its probe behind it but no screenshot. The stage states cannot be
asserted by the suite either — both vitest projects are `environment: "node"` — which is what this
block is for.
