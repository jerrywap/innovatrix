import "server-only";
import { headers } from "next/headers";
import { CURRENT_PATH_HEADER } from "@/config/request-context";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { CURRENCIES } from "@/lib/money";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { currencySwitchHref, isStorefrontCurrencyParam } from "@/services/marketplace/query";
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
        href: currencySwitchHref(here, code),
      }))}
    />
  );
}
