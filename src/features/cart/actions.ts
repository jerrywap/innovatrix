"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { getSession } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { usesSecureCookies } from "@/config/env";
import {
  CURRENCY_COOKIE,
  currencyCookieOptions,
  isStorefrontCurrency,
  STOREFRONT_CURRENCIES,
  type StorefrontCurrency,
} from "@/config/storefront";
import { currencySwitchHref } from "@/services/marketplace/query";
import * as cartService from "@/services/cart/cart-service";
import { ensureOwnerKey, readOwnerKey } from "@/services/cart/owner";
import { cartCurrency, loadCart } from "./load";

/**
 * Cart actions — §12.
 *
 * ## None of them accept a price
 *
 * The most important thing about this file is what its schemas do **not** have.
 * There is no `unitPrice`, no `lineTotal`, no `total`. A client can say which
 * product and which licence; the server decides what that costs, every time.
 * That is the "a tampered client payload cannot change the total" criterion,
 * and it is enforced by the shape of the input rather than by a check.
 *
 * ## `ensureOwnerKey`, not `readOwnerKey`
 *
 * These are Server Actions, so they may mint the guest cookie. Server
 * Components may not, which is why the read path uses the other one.
 */

const lineIdSchema = z.string().trim().min(1).max(24);

const addItemSchema = z.object({
  productId: objectIdSchema,
  licencePackageKey: z.string().trim().max(60).optional(),
  addonKeys: z
    .union([z.string().trim().max(60), z.array(z.string().trim().max(60))])
    .optional()
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))
    .pipe(z.array(z.string()).max(20)),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
});

/**
 * `z.enum` over the tuple, so an unsellable currency is a parse failure rather
 * than something `toStorefrontCurrency` quietly turns into GBP. `returnTo` is
 * length-capped for the same reason the proxy caps the forwarded path.
 */
const switchCurrencySchema = z.object({
  currency: z.enum(STOREFRONT_CURRENCIES),
  returnTo: z.string().trim().max(2048).optional(),
});

/** The detector needs no `returnTo`: it declines to run when the URL names a currency. */
const detectedCurrencySchema = z.object({ currency: z.enum(STOREFRONT_CURRENCIES) });

function refreshCart() {
  // The cart appears in the header on every page, so the whole layout is what
  // needs re-rendering, not just `/cart`.
  revalidatePath("/", "layout");
}

export async function addToCartAction(
  input: unknown,
): Promise<ActionResult<{ added: true; itemCount: number }>> {
  return withAction(async () => {
    const parsed = parseInput(addItemSchema, input);
    const session = await getSession();
    const ownerKey = await ensureOwnerKey(session?.user.id);
    const currency = await cartCurrency();

    await cartService.addItem(
      ownerKey,
      {
        productId: parsed.productId,
        ...(parsed.licencePackageKey ? { licencePackageKey: parsed.licencePackageKey } : {}),
        addonKeys: parsed.addonKeys,
        quantity: parsed.quantity,
      },
      {
        currency,
        ...(session?.user.id ? { userId: session.user.id } : {}),
        ...(session?.activeOrganizationId
          ? { organizationId: session.activeOrganizationId }
          : {}),
      },
    );

    const view = await loadForCount();
    refreshCart();

    return ok({ added: true as const, itemCount: view });
  });
}

export async function removeLineAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ removed: true }>> {
  return withAction(async () => {
    const lineId = parseInput(lineIdSchema, formData.get("lineId"));
    const session = await getSession();
    const ownerKey = await readOwnerKey(session?.user.id);
    if (!ownerKey) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    await cartService.removeLine(ownerKey, lineId);
    refreshCart();

    return ok({ removed: true as const });
  });
}

export async function setQuantityAction(
  lineId: string,
  quantity: number,
): Promise<ActionResult<{ quantity: number }>> {
  return withAction(async () => {
    const parsedLine = parseInput(lineIdSchema, lineId);
    const parsedQuantity = parseInput(z.coerce.number().int().min(1).max(99), quantity);

    const session = await getSession();
    const ownerKey = await readOwnerKey(session?.user.id);
    if (!ownerKey) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    await cartService.setQuantity(ownerKey, parsedLine, parsedQuantity);
    refreshCart();

    return ok({ quantity: parsedQuantity });
  });
}

/**
 * Apply or clear a discount code.
 *
 * Deliberately optimistic: the code is **stored**, not validated-and-frozen.
 * `recalculate` re-checks it on every read, so a code that expires between here
 * and checkout is caught rather than honoured. An immediately-invalid code
 * still gets its message back here, because being told at entry is kinder than
 * finding a notice on the next page.
 */
export async function applyDiscountAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ applied: boolean; message?: string }>> {
  return withAction(async () => {
    const raw = String(formData.get("code") ?? "").trim();
    const session = await getSession();
    const ownerKey = await readOwnerKey(session?.user.id);
    if (!ownerKey) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    await cartService.setDiscountCode(ownerKey, raw || undefined);
    refreshCart();

    if (!raw) return ok({ applied: false as boolean });

    // Re-price once so the customer hears about a bad code now.
    const view = await loadCart();
    const refusal = view?.notices.find((notice) => notice.kind === "discount_refused");

    return ok({
      applied: !refusal,
      ...(refusal ? { message: refusal.message } : {}),
    });
  });
}

/**
 * Switch the currency — the storefront's **and** the basket's, in one call.
 *
 * ## Why both switchers come here
 *
 * They used to disagree, and COS-33 is what that looked like. The header wrote
 * the cookie via `?currency=` and the proxy; the basket wrote the cart document
 * via this action. `recalculate` prices from the document, so a switch in the
 * header left the header saying USD over a basket still priced in naira — the
 * "one page quoting two currencies" failure `services/marketplace/currency.ts`
 * was written to end, reappearing one layer down.
 *
 * A cookie and a cart row are two writes, and only a Server Action can make
 * both. So this is the single writer and both controls call it.
 *
 * ## `revalidatePath`, not a navigation
 *
 * The header's control was a plain `<a href="?currency=…">` because
 * `proxy.ts` can only tell a real visit from a prefetch by `sec-fetch-dest`,
 * and that cost a full page load. An action runs on submit and never on a
 * prefetch, so the gate is not in this path: `refreshCart()` re-renders the
 * layout and the page in place, which is what "just switch the currency on the
 * cart" means.
 *
 * The proxy's `?currency=` handling stays exactly as it is — the filter rail's
 * chips are still plain anchors and still depend on it.
 *
 * ## `returnTo`, and the one case that still needs a URL
 *
 * The marketplace grid, rail and pagination read `currency` from the **URL**
 * first, and `currencyMustBeInUrl` puts it there whenever a price filter is set
 * ("under 50,000" is meaningless without saying of what). Revalidating alone
 * would leave them reading the old parameter, so when the current URL names a
 * currency we redirect to the same URL with it rewritten.
 *
 * `returnTo` is client input. `currencySwitchHref` sanitises it — same-origin
 * path only, `/` for anything else — which is why the path comes through it
 * rather than being trusted.
 *
 * ## `readOwnerKey`, not `ensureOwnerKey`
 *
 * Somebody switching currency while browsing has no basket and should not be
 * given a guest-cart cookie for the privilege.
 */
export async function switchCurrencyAction(
  input: unknown,
): Promise<ActionResult<{ currency: StorefrontCurrency }>> {
  return withAction(async () => {
    const parsed = parseInput(switchCurrencySchema, input);
    const currency = parsed.currency;

    await applyCurrency(currency);
    refreshCart();

    if (parsed.returnTo && namesCurrency(parsed.returnTo)) {
      // `withAction` deliberately re-throws Next's control flow, so this
      // reaches the router rather than becoming a logged failure.
      redirect(currencySwitchHref(parsed.returnTo, currency) as Route);
    }

    return ok({ currency });
  });
}

/**
 * The currency detected from the visitor's country, on their first visit.
 *
 * ## Why this is not just a `document.cookie` write in the detector
 *
 * That is what it was, on the reasoning that detection only runs when no currency
 * cookie exists — so a brand-new browser, so no basket to re-price. **That is
 * false for a signed-in customer**, whose basket is a database row and outlives
 * any cookie, and false for anyone whose thirty-day currency cookie expires while
 * their guest-cart cookie has not. Both end with a header quoting one currency
 * over a basket priced in another, which is the exact defect COS-33 fixed one
 * layer up. Caught by clearing the cookie on a browser that had a basket.
 *
 * So the write happens here, where `cartService.switchCurrency` is reachable.
 *
 * ## Why it is not `switchCurrencyAction`
 *
 * Only one line differs, and it is the expensive one: that action calls
 * `refreshCart()` → `revalidatePath("/", "layout")`, a **site-wide** cache
 * invalidation. On a switcher that is fine — somebody clicked. Here it would fire
 * on every first-time visitor, which is a different order of frequency
 * altogether. This writes and returns; the detector then calls
 * `router.refresh()`, which refetches that one route for that one client and
 * invalidates nothing shared.
 *
 * Everything else is shared through `applyCurrency`, so the two cannot drift.
 *
 * ## The stored-preference check is repeated here on purpose
 *
 * The detector already skips when a cookie is present. Re-checking server-side
 * makes "detected once, never again" a property of the system rather than a
 * promise the client keeps — and it costs one cookie read. Nothing is at stake if
 * it were called twice, which is precisely why it should not be enforced only in
 * the place that is easiest to bypass.
 */
export async function adoptDetectedCurrencyAction(
  input: unknown,
): Promise<ActionResult<{ currency: StorefrontCurrency; adopted: boolean }>> {
  return withAction<{ currency: StorefrontCurrency; adopted: boolean }>(async () => {
    const { currency } = parseInput(detectedCurrencySchema, input);

    const jar = await cookies();
    const existing = jar.get(CURRENCY_COOKIE)?.value;
    if (isStorefrontCurrency(existing)) {
      // Already chosen or already detected. A detection must never overwrite it.
      return ok({ currency: existing, adopted: false });
    }

    await applyCurrency(currency);

    return ok({ currency, adopted: true });
  });
}

/**
 * Write the preference, and re-price the basket if there is one.
 *
 * Both halves, always, because they are one fact stored twice: the cookie is what
 * the storefront reads and `cart.currency` is what `recalculate` prices from.
 * Writing one without the other is how the header and the basket come to quote
 * different currencies.
 *
 * `readOwnerKey`, not `ensureOwnerKey`: somebody whose currency is being set
 * while they browse has no basket and should not be given a guest-cart cookie for
 * the privilege.
 */
async function applyCurrency(currency: StorefrontCurrency): Promise<void> {
  const jar = await cookies();
  jar.set(currencyCookieOptions(currency, usesSecureCookies()));

  const session = await getSession();
  const ownerKey = await readOwnerKey(session?.user.id);
  if (ownerKey) await cartService.switchCurrency(ownerKey, currency);
}

/** Does this path already carry a `currency` parameter we would be leaving stale? */
function namesCurrency(pathAndSearch: string): boolean {
  return new URLSearchParams(pathAndSearch.split("?")[1] ?? "").has("currency");
}

/**
 * Remove every line the basket cannot buy — the one-click remedy.
 *
 * Takes **no input**. The line ids come from `recalculate`'s own `blocked`
 * array, so this cannot be pointed at a line that is perfectly fine by posting
 * an id, and there is no list for a stale form to send twice.
 */
export async function removeBlockedLinesAction(): Promise<ActionResult<{ removed: number }>> {
  return withAction(async () => {
    const cart = await loadCart();
    if (!cart) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    const session = await getSession();
    const ownerKey = await readOwnerKey(session?.user.id);
    if (!ownerKey) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    // Sequential: `removeLine` cascades a line's add-ons, so two concurrent
    // removals can each read a cart the other is about to replace.
    for (const line of cart.blocked) {
      await cartService.removeLine(ownerKey, line.lineId);
    }

    refreshCart();

    return ok({ removed: cart.blocked.length });
  });
}

/*
 * The guest-cart merge used to live here, as `mergeCartAction`, and was never
 * called from anywhere — so a signed-out visitor's basket was lost at sign-in
 * for as long as the feature has existed. It now lives in
 * `features/auth/adopt-guest-state.ts`, beside the conversation claim that had
 * the identical problem, and runs on every sign-in path.
 *
 * It is not an action any more, deliberately. An exported action is a public
 * POST endpoint, and the merge has no caller a browser should be able to be.
 */

async function loadForCount(): Promise<number> {
  const view = await loadCart();
  return view?.itemCount ?? 0;
}
