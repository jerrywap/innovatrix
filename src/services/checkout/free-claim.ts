import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { Organization } from "@/lib/db/models/identity";
import type { ProductPrice } from "@/lib/db/models/catalog";
import type { StorefrontCurrency } from "@/config/storefront";
import { products } from "@/repositories/product.repository";
import { entitlements } from "@/repositories/entitlement.repository";
import { productFiles } from "@/repositories/product-file.repository";
import { carts } from "@/repositories/cart.repository";
import { addItem } from "@/services/cart/cart-service";
import { settleFreeOrder } from "@/services/payments/payment-service";
import type { AuditActor } from "@/services/audit";
import { createOrder } from "./checkout-service";

/**
 * Taking a free listing without going through checkout — COS-12.
 *
 * ## What this is *not*
 *
 * Not a second fulfilment path. Download rights come from an `Entitlement` row and
 * from nothing else: `authoriseDownload` consults the entitlement, never the
 * product's price, and `Download.entitlementId` is `required`, so "a download with
 * no order" is not representable in the schema and should not be made so. A free
 * claim therefore creates a real zero-total order, a real `provider: "free"`
 * payment and a real entitlement — the identical rows that paying £0 through
 * `/checkout` produces today, and the identical rows `/dashboard/software` and the
 * licence key already know how to read.
 *
 * What it removes is the *form*. Today the only route to `settleFreeOrder` is
 * cart → `/checkout` → type an address → submit, which is three screens of
 * commerce ceremony for something with nothing to pay.
 */

/**
 * Is this price list free in this currency?
 *
 * The distinction that matters, and the one place it is decided: **absent is not
 * zero**. A missing row means "not sold in this currency" — the meaning
 * `advertisedPrices` depends on and `PriceMatrix`'s own copy states — while an
 * explicit `0` is the vendor saying free. Treating absent as free would give away a
 * product that is merely unpriced in the currency the visitor happens to be
 * browsing in.
 */
export function isFreeIn(
  prices: readonly ProductPrice[],
  currency: StorefrontCurrency,
): boolean {
  const row = prices.find((price) => price.currency === currency);
  return row !== undefined && row.amount === 0;
}

export interface FreeClaim {
  entitlementId: string;
  /** The application package to send them to, when the version has one. */
  fileId?: string;
  /** True when they already owned it and nothing new was created. */
  alreadyOwned: boolean;
}

/**
 * The owner key for the throwaway cart this claim is built in.
 *
 * **A deliberate third form.** `owner.ts` documents two — `guest:<id>` and
 * `user:<id>` — and one string with a unique index is what makes "which cart am I
 * looking at" impossible to get wrong. This adds a third rather than reusing the
 * customer's own basket, because `createOrder` orders *everything* in the cart it
 * is given, and the customer's basket may well hold paid items they have not
 * checked out yet. Claiming a free plugin must not silently buy those.
 *
 * It is safe because it is write-only from here: `readOwnerKey` and
 * `ensureOwnerKey` only ever mint the two documented forms, and `mergeOnLogin`
 * only ever looks for those, so no screen can navigate into one of these. The TTL
 * index on `expiresAt` collects anything a failure leaves behind.
 */
function claimKey(userId: string, productId: string): string {
  return `claim:${userId}:${productId}`;
}

export async function claimFreeProduct(
  input: { productId: string; licencePackageKey?: string },
  context: {
    userId: string;
    userName?: string;
    organizationId: string;
    currency: StorefrontCurrency;
  },
  actor: AuditActor,
): Promise<FreeClaim> {
  await connectToDatabase();

  /*
   * Already theirs — answered before anything is written.
   *
   * This is the idempotency that matters. `Entitlement`'s unique index is on
   * `(orderId, orderLineId)`, which stops one order fulfilling twice but says
   * nothing about two orders for the same product; without this check a second
   * click would mint a second order, a second payment and a second entitlement,
   * and the customer's My Scripts would list the same thing twice.
   */
  const owned = await entitlements.findForProduct(context.organizationId, input.productId);
  if (owned && owned.status === "active") {
    return {
      entitlementId: String(owned._id),
      ...(await packageFileFor(owned.purchasedVersionId)),
      alreadyOwned: true,
    };
  }

  const product = await products.findById(input.productId);
  // The same three `recalculate` checks. `listingSuppressed` is the one that is
  // easy to miss: a suspended vendor's product keeps `status: "published"` so that
  // its URL and reviews survive, and only this flag stops new sales.
  if (
    !product ||
    product.status !== "published" ||
    product.deletedAt ||
    product.listingSuppressed
  ) {
    throw new NotFoundError("product", { id: input.productId });
  }

  const licence = input.licencePackageKey
    ? product.licencePackages.find((pkg) => pkg.key === input.licencePackageKey)
    : product.licencePackages[0];

  if (!licence) {
    throw new ValidationError("That product has no licence to take yet.", {
      licencePackageKey: ["No licence package on this product."],
    });
  }

  if (!isFreeIn(licence.prices, context.currency)) {
    // Refused rather than routed to checkout, because the caller drew a button
    // saying "free". Being wrong about that is worth an error, not a redirect.
    throw new ValidationError("That licence is not free in this currency.", {
      licencePackageKey: [`No zero price in ${context.currency}.`],
    });
  }

  const ownerKey = claimKey(context.userId, input.productId);
  // Anything a previous failed attempt left behind. Cheaper than reasoning about
  // whether its contents are still current.
  await carts.deleteByOwnerKey(ownerKey);

  let claim: FreeClaim;
  try {
    await addItem(
      ownerKey,
      // No add-ons, deliberately: a paid add-on is exactly the case `/checkout`
      // exists for, and one bundled in here would make a non-zero total that
      // `settleFreeOrder` would then refuse after the order had been committed.
      {
        productId: input.productId,
        licencePackageKey: licence.key,
        addonKeys: [],
        quantity: 1,
      },
      {
        currency: context.currency,
        userId: context.userId,
        organizationId: context.organizationId,
      },
    );

    const created = await createOrder(
      {
        ownerKey,
        userId: context.userId,
        organizationId: context.organizationId,
        billing: await billingFor(context.organizationId, context.userName),
        paymentMethod: "online",
      },
      actor,
    );

    if (created.order.total.amount !== 0) {
      // Belt and braces: the price was zero a moment ago, and `createOrder`
      // re-prices from live data. Better a refusal than a £0 button that charges.
      throw new ConflictError("That product is no longer free.");
    }

    await settleFreeOrder({
      orderReference: created.order.reference,
      organizationId: context.organizationId,
      actor,
    });

    const granted = await entitlements.findForProduct(context.organizationId, input.productId);
    if (!granted) {
      throw new ConflictError("The download could not be prepared. Please try again.");
    }

    claim = {
      entitlementId: String(granted._id),
      ...(await packageFileFor(granted.purchasedVersionId)),
      alreadyOwned: false,
    };
  } finally {
    // The throwaway cart has served its purpose either way. The TTL index would
    // collect it eventually; not leaving it for the TTL keeps a retry clean.
    await carts.deleteByOwnerKey(ownerKey);
  }

  return claim;
}

/**
 * The billing snapshot, without asking for one.
 *
 * Every field of `BillingSnapshot` is optional and the Mongoose path is `Mixed`
 * with `default: {}`, so this is a real snapshot rather than a stub with holes
 * punched in it. `createOrder` reads `billing.country` only to choose a tax rule,
 * and on a zero total every rule produces zero — so a customer with no address on
 * file loses nothing by not being asked for one.
 *
 * Same source as `/checkout`'s own defaults, so a later paid order shows the
 * customer the details this one recorded.
 */
async function billingFor(organizationId: string, userName?: string) {
  const org = await Organization.findById(toObjectId(organizationId)).lean();
  return {
    ...(org?.name ? { organizationName: org.name } : {}),
    ...(userName ? { contactName: userName } : {}),
    ...(org?.billingEmail ? { email: org.billingEmail } : {}),
    ...(org?.billingAddress?.line1 ? { line1: org.billingAddress.line1 } : {}),
    ...(org?.billingAddress?.line2 ? { line2: org.billingAddress.line2 } : {}),
    ...(org?.billingAddress?.city ? { city: org.billingAddress.city } : {}),
    ...(org?.billingAddress?.region ? { region: org.billingAddress.region } : {}),
    ...(org?.billingAddress?.postcode ? { postcode: org.billingAddress.postcode } : {}),
    ...(org?.billingAddress?.country ? { country: org.billingAddress.country } : {}),
    ...(org?.taxId ? { taxId: org.taxId } : {}),
  };
}

/**
 * The file to send them to.
 *
 * `readiness.ts` will not let a product publish without a released version
 * carrying an `application_package`, so a miss here is a should-not-happen. It
 * answers `{}` rather than throwing, and the caller falls back to the My Scripts
 * page — a claim that succeeded should not read as a failure because the last step
 * of it found nothing to point at.
 */
async function packageFileFor(versionId?: unknown): Promise<{ fileId?: string }> {
  if (!versionId) return {};
  const files = await productFiles.listForVersion(String(versionId));
  const artefact = files.find((file) => file.kind === "application_package");
  return artefact ? { fileId: String(artefact._id) } : {};
}
