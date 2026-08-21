import "server-only";
import { nanoid } from "nanoid";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { parseFacet, type ProductDoc } from "@/lib/db/models/catalog";
import type { CartDoc, CartItem } from "@/lib/db/models/commerce";
import type { AddonPricingType } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { money, type CurrencyCode, type Money } from "@/lib/money";
import { products } from "@/repositories/product.repository";
import { carts } from "@/repositories/cart.repository";
import type { StorefrontCurrency } from "@/config/storefront";
import { calculateTotals, type CartTotals } from "./calculate";
import { evaluateDiscount, type DiscountRefusal } from "./discount";
import { resolveTaxRule } from "./tax";

/**
 * The cart — §12.
 *
 * ## `recalculate()` is the only source of a total, and it runs on every read
 *
 * The stored `unitPrice` on a line is a **record of what it cost when it was
 * added**, not an instruction to charge that. On every read this re-reads the
 * live product, prices the line from that, and reports any difference as a
 * notice. Two things follow:
 *
 * - A tampered client payload changes nothing, because no client value is ever
 *   read as an amount.
 * - A price change between adding and checking out is surfaced *before*
 *   payment, which is the acceptance criterion.
 *
 * ## A product that vanished is dropped, loudly
 *
 * Unpublished, deleted, or no longer priced in the cart's currency — the line
 * cannot be bought, so it is removed from the totals and named in the notices.
 * Silently charging for it would be worse; silently hiding it would be worse
 * still, because the customer would wonder where it went.
 */

export interface CartNotice {
  lineId?: string;
  kind:
    | "price_changed"
    | "item_unavailable"
    | "no_price_in_currency"
    | "discount_refused"
    | "quantity_adjusted";
  message: string;
}

export interface CartLineView {
  lineId: string;
  kind: CartItem["kind"];
  productId: string;
  productSlug: string;
  productName: string;
  licencePackageKey?: string;
  addonKey?: string;
  /**
   * Add-on lines only. Lets the basket tell a `quote_required` line ("priced
   * later") from a genuinely free one ("Free") — both sit at zero, and before
   * this they were indistinguishable on screen.
   */
  addonPricingType?: AddonPricingType;
  parentLineId?: string;
  displayName: string;
  displaySummary?: string;
  imageUrl?: string;
  quantity: number;
  /** Whether quantity may be changed at all — see `isQuantityLocked`. */
  quantityLocked: boolean;
  unitPrice: Money;
  lineTotal: Money;
}

export interface CartView {
  id: string;
  currency: StorefrontCurrency;
  lines: CartLineView[];
  totals: CartTotals;
  notices: CartNotice[];
  itemCount: number;
  discountCode?: string;
}

/* ────────────────────────────────────────────── reads */

/**
 * Price the cart from live data.
 *
 * Deliberately does **not** write. A read that repairs the cart as a side
 * effect makes every page load a write, and makes the notices disappear on the
 * refresh that follows — exactly when the customer is looking for them.
 * `commitRepairs()` exists for the one caller that should act on them: checkout.
 */
export async function recalculate(
  cart: CartDoc,
  context: {
    organizationCountry?: string | undefined;
    organizationId?: string | undefined;
  } = {},
): Promise<CartView> {
  await connectToDatabase();

  const currency = cart.currency as StorefrontCurrency;
  const notices: CartNotice[] = [];

  const productIds = [...new Set(cart.items.map((item) => String(item.productId)))];
  const live = await products.findManyByIds(productIds);
  const byId = new Map(live.map((product) => [String(product._id), product]));

  const lines: CartLineView[] = [];

  for (const item of cart.items) {
    const product = byId.get(String(item.productId));

    /*
     * `listingSuppressed` is checked here too — vendor ticket 12.
     *
     * A suspended vendor's product keeps `status: "published"` on purpose (its URL, its
     * reviews and its publish date all survive), so the status check alone would happily sell
     * it. This is the line that makes "new sales stopped" true rather than only true of the
     * listing, and it covers checkout as well because `createOrder` refuses on the same
     * notices.
     */
    if (
      !product ||
      product.status !== "published" ||
      product.deletedAt ||
      product.listingSuppressed
    ) {
      notices.push({
        lineId: item.lineId,
        kind: "item_unavailable",
        message: `${item.displayName} is no longer available and has been removed.`,
      });
      continue;
    }

    const priced = priceOf(product, item, currency);
    if (priced === undefined) {
      notices.push({
        lineId: item.lineId,
        kind: "no_price_in_currency",
        message: `${item.displayName} isn't sold in ${currency}. Remove it or switch currency.`,
      });
      continue;
    }

    if (priced !== item.unitPrice.amount) {
      notices.push({
        lineId: item.lineId,
        kind: "price_changed",
        message: `${item.displayName} has changed price since you added it.`,
      });
    }

    const locked = isQuantityLocked(product, item);
    const quantity = locked ? 1 : item.quantity;
    if (locked && item.quantity !== 1) {
      notices.push({
        lineId: item.lineId,
        kind: "quantity_adjusted",
        message: `${item.displayName} is licensed for a single installation, so the quantity is 1.`,
      });
    }

    lines.push({
      lineId: item.lineId,
      kind: item.kind,
      productId: String(product._id),
      productSlug: product.slug,
      productName: product.name,
      ...(item.licencePackageKey ? { licencePackageKey: item.licencePackageKey } : {}),
      ...(item.addonKey ? { addonKey: item.addonKey } : {}),
      ...(addonPricingTypeOf(product, item)
        ? { addonPricingType: addonPricingTypeOf(product, item)! }
        : {}),
      ...(item.parentLineId ? { parentLineId: item.parentLineId } : {}),
      displayName: item.displayName,
      ...(item.displaySummary ? { displaySummary: item.displaySummary } : {}),
      ...(imageOf(product) ? { imageUrl: imageOf(product)! } : {}),
      quantity,
      quantityLocked: locked,
      // From the **live** product, never from `item.unitPrice`.
      unitPrice: money(priced, currency),
      lineTotal: money(priced * quantity, currency),
    });
  }

  const provisional = calculateTotals({
    currency,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      unitAmount: line.unitPrice.amount,
      quantity: line.quantity,
    })),
  });

  const discount = cart.discountCode
    ? await applyDiscount(
        cart.discountCode,
        provisional.subtotal,
        lines,
        byId,
        context,
        notices,
      )
    : undefined;

  const tax = await resolveTaxRule({
    country: context.organizationCountry,
    kinds: lines.map((line) => line.kind),
  });

  const totals = calculateTotals({
    currency,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      unitAmount: line.unitPrice.amount,
      quantity: line.quantity,
    })),
    discount,
    tax,
  });

  return {
    id: String(cart._id),
    currency,
    lines,
    totals,
    notices,
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    ...(cart.discountCode && discount ? { discountCode: cart.discountCode } : {}),
  };
}

async function applyDiscount(
  code: string,
  subtotal: Money,
  lines: readonly CartLineView[],
  byId: Map<string, ProductDoc>,
  context: { organizationId?: string | undefined },
  notices: CartNotice[],
) {
  const categorySlugs = new Set<string>();
  for (const line of lines) {
    const product = byId.get(line.productId);
    for (const facet of product?.facets ?? []) {
      const parsed = parseFacet(facet);
      if (parsed?.prefix === "cat") categorySlugs.add(parsed.slug);
    }
  }

  const evaluation = await evaluateDiscount({
    code,
    subtotal,
    productIds: [...new Set(lines.map((line) => line.productId))],
    categorySlugs: [...categorySlugs],
    ...(context.organizationId ? { organizationId: context.organizationId } : {}),
  });

  if (evaluation.refusal) {
    notices.push({
      kind: "discount_refused",
      message: evaluation.message ?? "That code can't be applied.",
    });
    return undefined;
  }

  return evaluation.applied;
}

/* ────────────────────────────────────────────── writes */

export interface AddItemInput {
  productId: string;
  licencePackageKey?: string;
  /** Add-on keys bought alongside this licence. Attached to the same line. */
  addonKeys?: readonly string[];
  quantity?: number;
}

/**
 * Add a licence (and any add-ons) to the cart.
 *
 * ## The currency check is the interesting part
 *
 * A cart has one currency. Adding a product with no price in it is refused with
 * a `ConflictError` naming both currencies, so the UI can offer to switch —
 * rather than a generic failure, or the far worse alternative of quietly
 * adding it at somebody else's price.
 *
 * An **empty** cart adopts the product's currency instead of refusing: there is
 * nothing to conflict with, and refusing a first item because the default
 * currency happened to be GBP would be absurd.
 */
export async function addItem(
  ownerKey: string,
  input: AddItemInput,
  context: { currency: StorefrontCurrency; userId?: string; organizationId?: string },
): Promise<CartDoc> {
  await connectToDatabase();

  const product = await products.findById(input.productId);
  if (!product || product.status !== "published" || product.deletedAt) {
    throw new NotFoundError("product", { id: input.productId });
  }

  const cart = await carts.findOrCreate(ownerKey, {
    currency: context.currency,
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.organizationId ? { organizationId: context.organizationId } : {}),
  });

  const licence = input.licencePackageKey
    ? product.licencePackages.find((pkg) => pkg.key === input.licencePackageKey)
    : product.licencePackages[0];

  if (!licence) {
    throw new ValidationError("That product has no licence to buy yet.", {
      licencePackageKey: ["No licence package on this product."],
    });
  }

  const isEmpty = cart.items.length === 0;

  /**
   * An empty basket has made no commitment, so it takes a currency this licence
   * is actually priced in — preferring the one the customer is browsing in.
   *
   * This line used to read `cart.items.length === 0 ? context.currency : …`,
   * which is not the same thing and is what a customer reported: a new account
   * defaulting to USD, an empty basket, and every product refused with "switch
   * your basket or remove the other items first" — advice that cannot be taken,
   * because there is no other item and the basket currency only exists to
   * follow the first one.
   */
  const cartCurrency = (
    isEmpty
      ? priceIn(licence.prices, context.currency) !== undefined
        ? context.currency
        : (licence.prices[0]?.currency ?? context.currency)
      : cart.currency
  ) as CurrencyCode;

  const unit = priceIn(licence.prices, cartCurrency);
  if (unit === undefined) {
    // Only reachable with items already in the basket — an empty one adopted a
    // currency above — so the advice is now something the customer can act on.
    throw new ConflictError(
      `${product.name} isn't sold in ${cartCurrency}. Switch your basket to a currency it's ` +
        `priced in, or remove the other items first.`,
      { currency: [`Not priced in ${cartCurrency}.`] },
    );
  }

  const items = [...cart.items];
  const lineId = nanoid(10);
  const locked = licence.activationLimit <= 1;

  items.push({
    lineId,
    kind: "product_licence",
    productId: product._id,
    licencePackageKey: licence.key,
    quantity: locked ? 1 : Math.max(1, Math.trunc(input.quantity ?? 1)),
    unitPrice: { amount: unit, currency: cartCurrency },
    displayName: product.name,
    displaySummary: licence.name,
  });

  for (const addonKey of input.addonKeys ?? []) {
    const addon = product.addons.find((candidate) => candidate.key === addonKey);
    if (!addon) continue;

    const addonPrice = priceIn(addon.prices, cartCurrency);

    /*
     * Three answers, and `0` is not the same as "no price".
     *
     * This used to be `addonPrice ?? 0`, which charged nothing for an add-on
     * that simply had no row in the basket's currency — while the licence a few
     * lines up throws for exactly that. Once an add-on can *legitimately* be
     * free, the two cases became indistinguishable and the coalesce turned into
     * a revenue leak: a paid plugin unpriced in NGN shipped for nothing.
     *
     * `recalculate` never agreed with it either — `priceOf` returns `undefined`
     * there and the line is dropped with a `no_price_in_currency` notice, which
     * `assertOrderable` treats as blocking. So the same basket was priced at
     * zero on the way in and refused on the way out. One rule now.
     */
    const unitAmount =
      addon.pricingType === "quote_required"
        ? // No price yet by design: carrying it at zero is what tells the order
          // the customer wants it quoted.
          0
        : addonPrice;

    if (unitAmount === undefined) {
      // Refuse rather than drop. The customer *ticked* this — an ecommerce
      // script silently shipped without the payment plugin it needs is
      // discovered after paying, and this is the last moment they can act on it
      // by switching currency or basket. Same shape as the licence refusal.
      throw new ConflictError(
        `${addon.name} isn't sold in ${cartCurrency}. Switch your basket to a currency it's ` +
          `priced in, or add ${product.name} without it.`,
        { currency: [`${addon.name} is not priced in ${cartCurrency}.`] },
      );
    }

    items.push({
      lineId: nanoid(10),
      kind: "addon",
      productId: product._id,
      addonKey: addon.key,
      // The whole point of `parentLineId` — removing the licence takes its
      // add-ons with it.
      parentLineId: lineId,
      quantity: 1,
      unitPrice: { amount: unitAmount, currency: cartCurrency },
      displayName: addon.name,
      displaySummary: product.name,
    });
  }

  const saved = await carts.replaceItems(String(cart._id), items);
  if (cartCurrency !== cart.currency) {
    await carts.updateById(String(cart._id), { $set: { currency: cartCurrency } });
  }

  return saved ?? cart;
}

/**
 * Remove a line — and everything attached to it.
 *
 * Removing a product removes its add-ons (the acceptance criterion). Doing it
 * by `parentLineId` rather than by product id matters: two lines for the same
 * product with different licences each own their own add-ons.
 */
export async function removeLine(ownerKey: string, lineId: string): Promise<CartDoc | null> {
  await connectToDatabase();

  const cart = await carts.findByOwnerKey(ownerKey);
  if (!cart) return null;

  const items = cart.items.filter(
    (item) => item.lineId !== lineId && item.parentLineId !== lineId,
  );

  return carts.replaceItems(String(cart._id), items);
}

export async function setQuantity(
  ownerKey: string,
  lineId: string,
  quantity: number,
): Promise<CartDoc | null> {
  await connectToDatabase();

  const cart = await carts.findByOwnerKey(ownerKey);
  if (!cart) return null;

  const next = Math.max(1, Math.min(Math.trunc(quantity), 99));
  const items = cart.items.map((item) =>
    item.lineId === lineId ? { ...item, quantity: next } : item,
  );

  return carts.replaceItems(String(cart._id), items);
}

export async function setDiscountCode(
  ownerKey: string,
  code: string | undefined,
): Promise<CartDoc | null> {
  await connectToDatabase();

  const cart = await carts.findByOwnerKey(ownerKey);
  if (!cart) return null;

  return carts.updateById(
    String(cart._id),
    code
      ? { $set: { discountCode: code.trim().toUpperCase() } }
      : { $unset: { discountCode: "" } },
  );
}

/**
 * Switch the whole cart to another currency, re-pricing every line.
 *
 * Lines with no price in the new currency are **kept and flagged** rather than
 * dropped: silently deleting somebody's basket because they clicked a currency
 * toggle is not a recovery, it is a second problem. `recalculate` then reports
 * them, and the customer decides.
 */
export async function switchCurrency(
  ownerKey: string,
  currency: StorefrontCurrency,
): Promise<{ cart: CartDoc | null; repriced: number; unpriceable: string[] }> {
  await connectToDatabase();

  const cart = await carts.findByOwnerKey(ownerKey);
  if (!cart) return { cart: null, repriced: 0, unpriceable: [] };

  const live = await products.findManyByIds([
    ...new Set(cart.items.map((item) => String(item.productId))),
  ]);
  const byId = new Map(live.map((product) => [String(product._id), product]));

  let repriced = 0;
  const unpriceable: string[] = [];

  const items = cart.items.map((item) => {
    const product = byId.get(String(item.productId));
    const next = product ? priceOf(product, item, currency) : undefined;

    if (next === undefined) {
      unpriceable.push(item.displayName);
      return { ...item, unitPrice: { amount: item.unitPrice.amount, currency } };
    }

    if (next !== item.unitPrice.amount) repriced += 1;
    return { ...item, unitPrice: { amount: next, currency } };
  });

  const saved = await carts.replaceItems(String(cart._id), items);
  await carts.updateById(String(cart._id), { $set: { currency } });

  return { cart: saved, repriced, unpriceable };
}

/**
 * Fold a guest cart into the signed-in one — §12.
 *
 * ## Which cart wins, and why it is the user's
 *
 * On a currency conflict the **user cart** is kept and the guest lines are
 * dropped with a notice. The alternative — re-pricing the user's existing
 * basket into the guest currency — silently rewrites something they built
 * while signed in, on the strength of a cookie from a different session.
 *
 * Identical lines have their quantities summed; a quantity-locked line stays
 * at 1 rather than becoming 2.
 */
export async function mergeOnLogin(
  guestKey: string,
  userId: string,
  organizationId: string | undefined,
  currency: StorefrontCurrency,
): Promise<{ merged: number; dropped: string[] }> {
  await connectToDatabase();

  const guest = await carts.findByOwnerKey(guestKey);
  if (!guest || guest.items.length === 0) return { merged: 0, dropped: [] };

  const userKey = `user:${userId}`;
  const user = await carts.findOrCreate(userKey, {
    // An empty user cart adopts the guest's currency; a populated one keeps
    // its own, and the conflict below is then real.
    currency: guest.currency,
    userId,
    ...(organizationId ? { organizationId } : {}),
  });

  const targetCurrency = user.items.length === 0 ? guest.currency : user.currency;
  const dropped: string[] = [];

  const items = [...user.items];
  let merged = 0;

  for (const item of guest.items) {
    if (item.unitPrice.currency !== targetCurrency) {
      dropped.push(item.displayName);
      continue;
    }

    const existing = items.find(
      (candidate) =>
        String(candidate.productId) === String(item.productId) &&
        candidate.kind === item.kind &&
        candidate.licencePackageKey === item.licencePackageKey &&
        candidate.addonKey === item.addonKey,
    );

    if (existing) {
      // Summed, not duplicated — the acceptance criterion. `recalculate`
      // clamps back to 1 if the licence turns out to be single-installation.
      existing.quantity = Math.min(existing.quantity + item.quantity, 99);
    } else {
      // A fresh `lineId`, because guest and user carts generate them
      // independently and a collision would merge two unrelated lines.
      const newLineId = nanoid(10);
      const parent = item.parentLineId
        ? items.find((candidate) => candidate.lineId === item.parentLineId)?.lineId
        : undefined;
      items.push({ ...item, lineId: newLineId, ...(parent ? { parentLineId: parent } : {}) });
    }
    merged += 1;
  }

  await carts.replaceItems(String(user._id), items);
  await carts.updateById(String(user._id), {
    $set: {
      currency: targetCurrency,
      userId: toObjectId(userId),
      ...(organizationId ? { organizationId: toObjectId(organizationId) } : {}),
    },
  });
  await carts.deleteByOwnerKey(guestKey);

  void currency;
  return { merged, dropped };
}

/** Called by ticket 13 on **confirmed payment**, never on order creation. */
export async function clearCart(cartId: string, session?: ClientSession): Promise<void> {
  await carts.clear(cartId, { ...(session ? { session } : {}) });
}

/* ────────────────────────────────────────────── pricing helpers */

/**
 * The live price for a line, in the cart's currency. `undefined` = not sold.
 *
 * `0` and `undefined` are different answers and neither is coerced into the
 * other — a genuinely free add-on returns `0`, one with no row in this currency
 * returns `undefined`, and the caller decides. `addItem` refuses the latter;
 * here it stays the backstop for a price *removed after* the line was added,
 * which surfaces as a `no_price_in_currency` notice and blocks checkout.
 */
function priceOf(product: ProductDoc, item: CartItem, currency: string): number | undefined {
  if (item.kind === "addon") {
    const addon = product.addons.find((candidate) => candidate.key === item.addonKey);
    if (!addon) return undefined;
    // A quote-required add-on is genuinely free *now* and priced later, so
    // zero is the right cart figure rather than an absence.
    return addon.pricingType === "quote_required" ? 0 : priceIn(addon.prices, currency);
  }

  const licence = product.licencePackages.find(
    (candidate) => candidate.key === item.licencePackageKey,
  );
  return licence ? priceIn(licence.prices, currency) : undefined;
}

/** The add-on's pricing type, for an add-on line. `undefined` for a licence. */
function addonPricingTypeOf(product: ProductDoc, item: CartItem): AddonPricingType | undefined {
  if (item.kind !== "addon") return undefined;
  return product.addons.find((candidate) => candidate.key === item.addonKey)?.pricingType;
}

function priceIn(
  prices: ReadonlyArray<{ currency: string; amount: number }>,
  currency: string,
): number | undefined {
  return prices.find((price) => price.currency.toUpperCase() === currency.toUpperCase())
    ?.amount;
}

/**
 * A single-installation licence cannot be bought three times on one line.
 *
 * Three installations means three activations, which is a different licence
 * package — so a quantity of 3 here is a support ticket, not an order.
 */
function isQuantityLocked(product: ProductDoc, item: CartItem): boolean {
  if (item.kind === "addon") return true;
  const licence = product.licencePackages.find(
    (candidate) => candidate.key === item.licencePackageKey,
  );
  return (licence?.activationLimit ?? 1) <= 1;
}

function imageOf(product: ProductDoc): string | undefined {
  return product.media?.find((item) => item.url)?.url;
}

export type { DiscountRefusal };
