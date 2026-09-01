import "server-only";
import { headers } from "next/headers";
import { CURRENT_PATH_HEADER } from "@/config/request-context";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { CURRENCIES } from "@/lib/money";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { isStorefrontCurrencyParam } from "@/services/marketplace/query";
import { CurrencyMenu } from "./currency-menu";

/**
 * The header's currency control — §43.
 *
 * ## Why it lives inside `HeaderAccount`'s boundary
 *
 * It reads the cookie *and* `headers()`, both dynamic APIs. Rendered anywhere in
 * `PublicHeader`'s static markup it would make the layout dynamic, and a dynamic
 * layout makes every page under it dynamic — the regression `(public)/layout.tsx`
 * exists to prevent. The header already has exactly one dynamic hole; this shares
 * it, for the same reason the basket badge does rather than taking a second
 * boundary that would resolve a moment apart.
 *
 * The cost is that it waits on the session it does not need. That is one indexed
 * query already on the critical path for this corner, and `loadCart()` beside it
 * is heavier.
 *
 * ## The active currency is resolved from the URL first, then the cookie
 *
 * Not decoration — it closes a real divergence. `resolveStorefrontCurrency()`
 * with no argument reads only the cookie, and a `?currency=NGN` visit the proxy
 * declined to persist (a crawler, a prefetch) renders ₦ prices under a header
 * reading GBP. One page quoting two currencies is precisely what `currency.ts`
 * was written to end. Feeding the forwarded URL in costs one line.
 *
 * ## No `href`s any more — and that was COS-33
 *
 * This used to hand `CurrencyMenu` a `currencySwitchHref(here, code)` per option.
 * It cannot: **App Router does not re-render a shared layout on a client-side
 * navigation**, so those hrefs froze at whatever URL first rendered the layout.
 * Every route into the basket is a soft navigation, so somebody who reached
 * `/cart` from the homepage was standing under a menu still pointing at `/`, and
 * switching currency took them there. It looked intermittent because a hard
 * reload produced correct hrefs.
 *
 * The switch is a Server Action now (`switchCurrencyAction`), and the path it
 * needs comes from `usePathname()`/`useSearchParams()` on the client, which *are*
 * live across a soft navigation. `x-pathname` is still read here, for `current`
 * only — see the note in `currency-menu.tsx` about why that one is safe.
 */
export async function HeaderCurrency() {
  const requestHeaders = await headers();
  const here = requestHeaders.get(CURRENT_PATH_HEADER);

  const fromUrl = new URLSearchParams(here?.split("?")[1] ?? "").get("currency");
  const current = await resolveStorefrontCurrency(
    isStorefrontCurrencyParam(fromUrl) ? fromUrl : undefined,
  );

  return (
    <CurrencyMenu
      current={current}
      options={STOREFRONT_CURRENCIES.map((code) => ({
        code,
        // `lib/money.ts` is isomorphic — no `server-only` — so the symbol and the
        // full name can cross to the client component as plain strings.
        symbol: CURRENCIES[code].symbol,
        name: CURRENCIES[code].name,
      }))}
    />
  );
}
