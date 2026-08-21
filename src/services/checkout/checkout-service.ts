import "server-only";
import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { counterStore } from "@/lib/db/counter-store";
import { generateReference } from "@/lib/references";
import { ORDER_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { withTransaction } from "@/lib/db/transaction";
import type { ProductDoc } from "@/lib/db/models/catalog";
import {
  Cart,
  Order,
  type BillingSnapshot,
  type OrderDoc,
  type OrderItem,
} from "@/lib/db/models/commerce";
import type { OrderStatus } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { products } from "@/repositories/product.repository";
import { productVersions } from "@/repositories/product-version.repository";
import { orders } from "@/repositories/order.repository";
import { discountCodes } from "@/repositories/discount-code.repository";
import { carts } from "@/repositories/cart.repository";
import { statusChange, writeAuditLog, type AuditActor } from "@/services/audit";
import { recalculate, type CartView } from "@/services/cart/cart-service";

/**
 * Checkout — §13, §61.
 *
 * ## The order is written from the cart *as the server prices it*
 *
 * `recalculate()` runs again inside `createOrder`, from live products. Nothing
 * the browser submitted contributes a number. That is the "editing the total in
 * the browser changes nothing" criterion, and it holds because there is no
 * input path for a total to arrive on.
 *
 * ## §61 in one sentence
 *
 * Every line copies the product's name, slug, version, licence terms and price
 * **into the order**. When the product is re-priced, delisted or deleted next
 * year, the order still reconciles to the penny, because it never looks the
 * product up again.
 *
 * ## The cart is not cleared here
 *
 * Ticket 13 clears it on **confirmed payment**. An abandoned payment must leave
 * the basket intact and re-purchasable, which is the acceptance criterion — and
 * the difference between a customer retrying and a customer starting again.
 */

export interface CreateOrderInput {
  ownerKey: string;
  userId: string;
  organizationId: string;
  billing: BillingSnapshot;
  /** Supplied by the client so a double submit is recognisable. */
  idempotencyKey?: string;
  /**
   * How they said they would pay.
   *
   * The order is created identically either way and lands in
   * `awaiting_payment` either way — this only records the customer's stated
   * intent so the screens afterwards can say the right thing. **Nothing is
   * delivered on the strength of it**: entitlements still come from
   * `processPaymentSucceeded`, whether that is triggered by a webhook or by a
   * staff member recording a transfer.
   */
  paymentMethod?: "online" | "offline";
}

export interface CreateOrderResult {
  order: OrderDoc;
  /** True when this call found an existing order rather than creating one. */
  reused: boolean;
}

export async function createOrder(
  input: CreateOrderInput,
  actor: AuditActor,
): Promise<CreateOrderResult> {
  await connectToDatabase();

  const cart = await carts.findByOwnerKey(input.ownerKey);
  if (!cart || cart.items.length === 0) {
    throw new ValidationError("Your basket is empty.", { cart: ["Nothing to order."] });
  }

  const priced = await recalculate(cart, {
    organizationId: input.organizationId,
    ...(input.billing.country ? { organizationCountry: input.billing.country } : {}),
  });

  assertOrderable(priced);

  // Derived from the cart *and its contents*, so adding an item produces a new
  // key and a genuine second submission of the same basket does not.
  const idempotencyKey = input.idempotencyKey ?? contentKey(String(cart._id), priced);

  const existing = await orders.findByIdempotencyKey(idempotencyKey);
  if (existing) return { order: existing, reused: true };

  const lines = await buildOrderLines(priced);

  try {
    const order = await withTransaction(async (session) => {
      // The counter joins the session. Without that, a rolled-back order burns
      // an ORD- number and leaves a permanent gap in the sequence.
      const reference = await generateReference(counterStore(session), "ORD");

      // Claim the discount *inside* the transaction, with the limit check in
      // the filter — so a hundred-use code cannot become a hundred and one.
      if (priced.totals.discountCode) {
        const claimed = await discountCodes.claimUse(priced.totals.discountCode, session);
        if (!claimed) {
          throw new ConflictError(
            `The code ${priced.totals.discountCode} was fully claimed while you were checking out. ` +
              `Remove it and try again.`,
          );
        }
      }

      const [created] = await Order.create(
        [
          {
            reference,
            organizationId: toObjectId(input.organizationId),
            userId: toObjectId(input.userId),
            currency: priced.currency,
            items: lines,
            subtotal: toMoneyDoc(priced.totals.subtotal),
            ...(priced.totals.discount.amount > 0
              ? {
                  discount: {
                    ...(priced.totals.discountCode ? { code: priced.totals.discountCode } : {}),
                    amount: priced.totals.discount.amount,
                    currency: priced.currency,
                  },
                }
              : {}),
            ...(priced.totals.tax.amount > 0 || priced.totals.taxRuleId
              ? {
                  tax: {
                    ...(priced.totals.taxRuleId ? { ruleId: priced.totals.taxRuleId } : {}),
                    ...(priced.totals.taxBasisPoints !== undefined
                      ? { basisPoints: priced.totals.taxBasisPoints }
                      : {}),
                    amount: priced.totals.tax.amount,
                    currency: priced.currency,
                  },
                }
              : {}),
            total: toMoneyDoc(priced.totals.total),
            status: "awaiting_payment",
            paymentMethod: input.paymentMethod ?? "online",
            billingSnapshot: input.billing,
            idempotencyKey,
          },
        ],
        { session, ordered: true },
      );

      await writeAuditLog(
        {
          action: "order.created",
          actor,
          subject: { type: "order", id: String(created!._id) },
          organizationId: input.organizationId,
          after: {
            reference,
            total: priced.totals.total.amount,
            currency: priced.currency,
            lines: lines.length,
          },
          source: "checkout",
        },
        session,
      );

      return created!.toObject() as OrderDoc;
    });

    return { order, reused: false };
  } catch (error) {
    // Two submissions racing past the read above. The unique sparse index on
    // `idempotencyKey` refused the second, which is exactly right — read back
    // the winner rather than showing the customer a duplicate-key error.
    if (isDuplicateKey(error)) {
      const winner = await orders.findByIdempotencyKey(idempotencyKey);
      if (winner) return { order: winner, reused: true };
    }
    throw error;
  }
}

/**
 * Everything that would make an order wrong rather than merely different.
 *
 * A price change is *not* in here: `recalculate` already surfaced it and the
 * order is built from the new price. Refusing would mean a customer who left a
 * tab open cannot buy at all.
 */
function assertOrderable(priced: CartView): void {
  const blocking = priced.notices.filter(
    (notice) => notice.kind === "item_unavailable" || notice.kind === "no_price_in_currency",
  );

  if (blocking.length > 0) {
    throw new ValidationError(
      `Your basket has changed: ${blocking.map((n) => n.message).join(" ")}`,
      { cart: blocking.map((n) => n.message) },
    );
  }

  if (priced.lines.length === 0) {
    throw new ValidationError("Your basket is empty.", { cart: ["Nothing to order."] });
  }

  if (priced.totals.total.amount < 0) {
    // Defensive: `calculateTotals` clamps, so reaching this means the clamp
    // was removed. Better a refused checkout than a negative charge.
    throw new ValidationError("That basket doesn't add up. Please contact support.", {
      total: ["Negative total."],
    });
  }
}

/**
 * The §61 snapshot.
 *
 * Reads the product and its current released version **once**, then copies
 * everything the order will ever need. The version matters: a customer who buys
 * today owns *today's* version forever, whatever ships later (§45), and ticket
 * 14 reads `versionId` off the line to say so.
 */
async function buildOrderLines(priced: CartView): Promise<OrderItem[]> {
  const productIds = [...new Set(priced.lines.map((line) => line.productId))];
  const live = await products.findManyByIds(productIds);
  const byId = new Map(live.map((product) => [String(product._id), product]));

  /*
   * The commission rate, resolved **once per vendor** rather than per line — vendor
   * ticket 07.
   *
   * Batched like `findManyByIds` above it, and for the same reason: this is the hottest
   * write path in the system, and a lookup inside the per-line `map` would be a query per
   * line on every checkout. Most orders have one vendor or none.
   */
  const vendorIds = [
    ...new Set(
      live
        .map((p) => p.vendorId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const commissionByVendor = new Map<string, number>();
  if (vendorIds.length > 0) {
    const { Vendor } = await import("@/lib/db/models/vendors");
    const { resolveCommission } = await import("@/services/vendors/commission-service");

    const vendors = await Vendor.find({ _id: { $in: vendorIds } })
      .select({ commissionBasisPoints: 1 })
      .lean<Array<{ _id: unknown; commissionBasisPoints?: number }>>();
    const byVendorId = new Map(vendors.map((v) => [String(v._id), v]));

    for (const vendorId of vendorIds) {
      const resolved = await resolveCommission(byVendorId.get(vendorId) ?? null);
      commissionByVendor.set(vendorId, resolved.basisPoints);
    }
  }

  const currentVersions = new Map<string, { id: string; version: string }>();
  for (const product of live) {
    if (!product.currentVersionId) continue;
    const version = await productVersions.findById(String(product.currentVersionId));
    if (version) {
      currentVersions.set(String(product._id), {
        id: String(version._id),
        version: version.version,
      });
    }
  }

  return priced.lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new NotFoundError("product", { id: line.productId });

    const version = currentVersions.get(line.productId);
    const licence = line.licencePackageKey
      ? product.licencePackages.find((pkg) => pkg.key === line.licencePackageKey)
      : undefined;
    const addon = line.addonKey
      ? product.addons.find((candidate) => candidate.key === line.addonKey)
      : undefined;

    return {
      lineId: line.lineId,
      kind: line.kind,
      productId: product._id,
      productName: product.name,
      productSlug: product.slug,
      ...(version ? { versionId: toObjectId(version.id), versionNumber: version.version } : {}),
      ...(licence
        ? {
            licencePackageKey: licence.key,
            licencePackageName: licence.name,
            licenceType: licence.licenceType,
            // The *terms*, not a pointer to them. Ticket 14 issues the licence
            // from these numbers, and changing the package later must not
            // change what somebody already bought.
            activationLimit: licence.activationLimit,
            supportMonths: licence.supportMonths,
            updateMonths: licence.updateMonths,
          }
        : {}),
      ...(addon ? { addonKey: addon.key, addonName: addon.name } : {}),
      /*
       * A plugin's handover starts as an obligation, stamped here rather than at
       * fulfilment.
       *
       * Doing it at checkout keeps `processPaymentSucceeded` free of another
       * write — and therefore of another way for a confirmed payment to abort.
       * The line is not *actionable* until the order is paid, which the queue
       * enforces with `paidAt`, not with the absence of this field.
       *
       * `quote_required` add-ons are excluded: they are a quote flow, and there
       * is nothing to hand over until somebody has priced it.
       */
      ...(addon && addon.pricingType !== "quote_required"
        ? { provisioning: { status: "pending" as const } }
        : {}),
      ...(line.parentLineId ? { parentLineId: line.parentLineId } : {}),
      quantity: line.quantity,
      unitPrice: toMoneyDoc(line.unitPrice),
      lineTotal: toMoneyDoc(line.lineTotal),
      /*
       * Vendor ticket 07 — the snapshot, and the reason this field exists.
       *
       * Absent on a first-party line. Present on **every** line of a vendor's product,
       * licence and add-on alike.
       *
       * That add-on clause used to read the other way, on the assumption that an add-on is
       * always platform-delivered work — installation, branding — so the platform kept it.
       * It closed with "a vendor who wants paid services around their product is a different
       * feature and is not this one". This is that feature: an add-on is now also how a
       * plugin is sold, the vendor prices it and the vendor hands it over, so the vendor
       * earns on it at the same rate as their licence lines.
       *
       * Second consequence, relied on downstream: an add-on line now carries `vendorId`,
       * which is what makes the provisioning queue an `$elemMatch` rather than a join.
       *
       * Written here and never re-read. A rate change must not rewrite what a vendor earned
       * last month.
       */
      ...(product.vendorId
        ? {
            vendorId: product.vendorId,
            commissionBasisPoints: commissionByVendor.get(String(product.vendorId))!,
          }
        : {}),
    } satisfies OrderItem;
  });
}

/* ────────────────────────────────────────────── transitions */

/**
 * Move an order along, guarded.
 *
 * `paid` is deliberately **not** reachable from here: only ticket 13's verified
 * payment path may set it, and routing it through a general-purpose transition
 * would make "an order is never marked paid except by the webhook" a convention
 * rather than a fact.
 */
export async function transitionOrder(
  orderId: string,
  to: Exclude<OrderStatus, "paid">,
  actor: AuditActor,
  options: { reason?: string; source?: string } = {},
): Promise<OrderDoc> {
  await connectToDatabase();

  const order = await Order.findById(orderId).lean<OrderDoc>();
  if (!order) throw new NotFoundError("order", { id: orderId });

  assertTransition("order", ORDER_TRANSITIONS, order.status, to);

  const updated = await orders.setStatusIfCurrent(orderId, order.status, to);
  if (!updated) {
    throw new ConflictError("That order's status changed while you were working.");
  }

  await writeAuditLog({
    action: "order.status_changed",
    actor,
    subject: { type: "order", id: orderId },
    organizationId: String(order.organizationId),
    ...statusChange(order.status, to, options.reason ? { reason: options.reason } : {}),
    source: options.source ?? "admin",
  });

  return updated;
}

/* ────────────────────────────────────────────── helpers */

/**
 * A key that changes when the basket changes and not otherwise.
 *
 * The cart id alone would make a customer's *second, deliberate* purchase of
 * the same basket collide with their first. Hashing the priced contents means
 * two clicks a second apart collide (correct) while two orders a week apart do
 * not (also correct) — the total and lines will differ, and if they genuinely
 * do not, the customer sees their existing order rather than a duplicate charge.
 */
function contentKey(cartId: string, priced: CartView): string {
  const shape = priced.lines
    .map((line) => `${line.lineId}:${line.unitPrice.amount}:${line.quantity}`)
    .sort()
    .join("|");

  return createHash("sha256")
    .update(`${cartId}|${priced.currency}|${priced.totals.total.amount}|${shape}`)
    .digest("hex")
    .slice(0, 32);
}

function toMoneyDoc(value: { amount: number; currency: string }) {
  return { amount: value.amount, currency: value.currency };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/** Clear the basket — called by ticket 13 on confirmed payment only. */
export async function clearCartForOrder(
  organizationId: string,
  userId: string,
  session?: ClientSession,
): Promise<void> {
  void organizationId;
  const cart = await Cart.findOne({ ownerKey: `user:${userId}` })
    .session(session ?? null)
    .lean<{ _id: unknown }>();

  if (cart) {
    await carts.clear(String(cart._id), { ...(session ? { session } : {}) });
  }
}

export type { ProductDoc };
