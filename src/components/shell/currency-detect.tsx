"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { currencyForCountry, storedCurrency } from "@/config/storefront";
import { adoptDetectedCurrencyAction } from "@/features/cart/actions";

/**
 * Price the first visit in the visitor's own currency.
 *
 * Renders nothing. Mounted once in `(public)/layout.tsx`, which covers every
 * storefront route and nothing else — the root layout would also run this on
 * `/admin` and `/staff`, where currency is irrelevant and a third-party request
 * is unwelcome.
 *
 * ## Why the browser, and not the server
 *
 * Three reasons, and only the first is about effort:
 *
 * - **There is no server-side signal to read.** The deploy is nginx on one host —
 *   no Cloudflare, so no `CF-IPCountry`; not Vercel, so no `x-vercel-ip-country`.
 *   Server-side would mean shipping and refreshing a MaxMind database.
 * - **The endpoint rate-limits per IP.** From the browser that is one allowance
 *   per visitor. From this host it would be one allowance for the entire site's
 *   first-visit traffic, which is the case its own documentation tells you to
 *   self-host for.
 * - **Nothing varies on a request header.** Every response stays byte-identical
 *   for everyone, so no shared cache is poisoned and no `Vary` is added — the
 *   objection `config/storefront.ts` raised against geo-IP, met rather than
 *   ignored.
 *
 * ## Why a Server Action and not a `document.cookie` write
 *
 * It was a cookie write, on the reasoning that a browser with no currency cookie
 * has no basket either. That is wrong for a signed-in customer — whose basket is
 * a database row and outlives every cookie — and wrong for anyone whose
 * thirty-day currency cookie expires before their cart cookie. Both leave the
 * header quoting one currency over a basket priced in another, and clearing the
 * cookie on a browser with a basket reproduces it immediately.
 *
 * `adoptDetectedCurrencyAction` writes the preference *and* re-prices the basket,
 * and unlike `switchCurrencyAction` it does not call `revalidatePath("/", "layout")`
 * — a site-wide invalidation is right when somebody clicks a switcher and wrong on
 * every first visit. `router.refresh()` then refetches this one route for this one
 * client and invalidates nothing shared. Currency is part of the listing cache
 * key, so the refresh warms the NGN/GBP entries rather than fighting the USD one.
 *
 * Two round trips on the first visit, then none ever again.
 *
 * ## What it deliberately does not do
 *
 * Anything, if a currency is already stored or the URL names one.
 * `resolveStorefrontCurrency` resolves URL → cookie → default and the URL wins on
 * purpose, so that a shared link shows the sender's prices. Without the second
 * guard, arriving on `/marketplace?currency=NGN` would write a *detected* cookie
 * underneath it and the visitor would watch the page bounce to something else.
 */

/** Where the country comes from. Returns `{ ip, country }`; only `country` is read. */
const ENDPOINT = "https://api.country.is/";

/**
 * Long enough for a cold DNS lookup on a phone, short enough that nobody is
 * looking at prices in the wrong currency while we wait for a host that is down.
 */
const TIMEOUT_MS = 2500;

/**
 * Module scope, not a `useRef`.
 *
 * StrictMode mounts, unmounts and remounts an effect in development. A ref
 * survives that — so the first pass starts the request, the cleanup would abort
 * it, and the second pass declines to retry: the feature would appear broken
 * locally and work in production, which is the worst way round. A module flag is
 * once per document load, which is what "once" means here anyway, because App
 * Router keeps a shared layout mounted across every soft navigation.
 */
let started = false;

export function CurrencyDetect() {
  const router = useRouter();

  useEffect(() => {
    if (started) return;
    started = true;

    if (storedCurrency(document.cookie)) return;
    // `window.location`, not `useSearchParams()`. The hook would put a
    // `useSearchParams` consumer in the layout — which needs a Suspense boundary
    // above it and can push every shell from a partial prerender to fully
    // dynamic. Read inside the effect there is no such implication.
    if (new URLSearchParams(window.location.search).has("currency")) return;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

    void (async () => {
      try {
        const response = await fetch(ENDPOINT, {
          signal: abort.signal,
          cache: "no-store",
          // No cookie of ours goes to a third party, and it is not told which
          // site called it. It sees the IP it would see regardless, and the
          // response's own `ip` field is read by nobody.
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) return;

        const detected = currencyForCountry((await response.json())?.country);
        // `undefined` means the answer was not a country — an empty body, an
        // error page, a name instead of a code. Writing nothing lets a later
        // hard load try again, where writing the default would look detected and
        // stick for thirty days.
        if (!detected) return;

        const result = await adoptDetectedCurrencyAction({ currency: detected });
        // `adopted: false` means the server found a preference already stored —
        // a switcher in another tab, or a race with this one. Refreshing then
        // would re-render for no reason.
        if (result.ok && result.data.adopted) router.refresh();
      } catch {
        // Offline, blocked by an extension, refused by the CSP, aborted by the
        // timeout, or malformed JSON. All of them mean the same thing: nothing is
        // stored and the default stands. This is the intended failure.
      } finally {
        clearTimeout(timer);
      }
    })();

    // No abort on unmount. The timeout is the deadline, and this layout does not
    // unmount during a session — aborting on cleanup would only cancel the one
    // request we want, under StrictMode.
  }, [router]);

  return null;
}
