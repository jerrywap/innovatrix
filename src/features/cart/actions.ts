"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { getSession } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { usesSecureCookies } from "@/config/env";
import {
  currencyCookieOptions,
  STOREFRONT_CURRENCIES,
  toStorefrontCurrency,
} from "@/config/storefront";
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

export async function switchCartCurrencyAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ repriced: number; unpriceable: string[] }>> {
  return withAction(async () => {
    const currency = toStorefrontCurrency(formData.get("currency"));
    if (!(STOREFRONT_CURRENCIES as readonly string[]).includes(currency)) {
      return fail("We don't sell in that currency.", { code: "VALIDATION" });
    }

    const session = await getSession();
    const ownerKey = await readOwnerKey(session?.user.id);
    if (!ownerKey) return fail("There's nothing in your basket.", { code: "NOT_FOUND" });

    const result = await cartService.switchCurrency(ownerKey, currency);

    /*
     * Remember it for the storefront too, not just for the basket.
     *
     * The basket and the marketplace are one preference, and switching here used
     * to change only the cart — so a customer who repriced their basket in ₦ went
     * back to browsing in £. A Server Action is one of the two things allowed to
     * set a cookie (`proxy.ts` is the other), which is exactly why this belongs
     * here and could never have lived in the page that renders the switcher.
     */
    const jar = await cookies();
    jar.set(currencyCookieOptions(currency, usesSecureCookies()));

    refreshCart();

    return ok({ repriced: result.repriced, unpriceable: result.unpriceable });
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
