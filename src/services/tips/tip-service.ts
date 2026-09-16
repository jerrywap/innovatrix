import "server-only";
import type { ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Tip, type TipDoc } from "@/lib/db/models/commerce";
import { Vendor } from "@/lib/db/models/vendors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { products } from "@/repositories/product.repository";
import {
  resolveCommission,
  resolveCommissionForVendor,
  splitLineTotal,
} from "@/services/vendors/commission-service";
import { money, type Money } from "@/lib/money";
import type { StorefrontCurrency } from "@/config/storefront";

/**
 * Tipping a vendor — the record, not the money.
 *
 * ## What this owns and what it does not
 *
 * This creates the `Tip` and computes the split. Taking the payment is
 * `initiatePaymentForTip` in `payments/payment-service.ts`, and crediting the
 * vendor is `settleTip` in `payments/fulfilment.ts` — the same three-way division
 * every other payment already has, so a tip inherits the provider routing, the
 * webhook idempotency and the verification without re-implementing any of it.
 *
 * ## A tip is unowned money until it settles
 *
 * The row is written before the customer is sent to the provider, and carries no
 * `paidAt` until a verified webhook arrives. An abandoned tip is therefore a row
 * with no `paidAt` and no ledger entry — visible, harmless, and never counted.
 */

/**
 * The amounts offered, per currency.
 *
 * Written out rather than converted. A tip is a gesture, and the gesture is
 * "about a fiver" — converting £5 into ₦10,342 produces a number nobody would
 * choose, on a screen whose whole job is to make choosing easy. So each currency
 * gets round figures somebody in that currency would actually pick.
 *
 * Minor units, like every other amount in the system (§84).
 */
export const TIP_PRESETS: Record<StorefrontCurrency, readonly [number, number, number]> = {
  GBP: [300, 500, 1000],
  USD: [300, 500, 1000],
  NGN: [100_000, 250_000, 500_000],
};

/** The floor and ceiling on a custom amount, per currency. */
export const TIP_LIMITS: Record<StorefrontCurrency, { min: number; max: number }> = {
  GBP: { min: 100, max: 50_000 },
  USD: { min: 100, max: 50_000 },
  NGN: { min: 50_000, max: 20_000_000 },
};

export interface TipSplit {
  /** What the customer pays. */
  gross: Money;
  /** What the vendor earns, after commission. */
  earning: Money;
  /** What CoSetup keeps. */
  fee: Money;
  basisPoints: number;
}

/**
 * The split, shown to the customer before they commit.
 *
 * ## Why the customer sees it at all
 *
 * Because the commission applies. A modal that says "support the maker" over a
 * button that quietly keeps 15% is the kind of thing that is only ever found out
 * afterwards, and by the wrong person. Stating it costs one line and makes the
 * number the vendor later sees in their earnings the number the tipper was shown.
 *
 * Uses `splitLineTotal`, the same integer arithmetic every sale uses, so
 * `fee + earning === gross` exactly rather than approximately.
 */
export function splitTip(gross: Money, basisPoints: number): TipSplit {
  const { fee, earning } = splitLineTotal(gross, basisPoints);
  return { gross, earning, fee, basisPoints };
}

export interface CreateTipInput {
  productId: string;
  amount: number;
  currency: StorefrontCurrency;
  note?: string;
}

export interface TipContext {
  userId: string;
  organizationId: string;
}

/**
 * Record the intent to tip, and snapshot the rate it will be split at.
 *
 * Refuses a product with no vendor: a first-party listing has nobody to tip, and
 * the modal does not render for one. Checked here as well because a hidden
 * control is not a control.
 */
export async function createTip(
  input: CreateTipInput,
  context: TipContext,
  session?: ClientSession,
): Promise<{ tip: TipDoc; split: TipSplit }> {
  await connectToDatabase();

  const limits = TIP_LIMITS[input.currency];
  if (!Number.isInteger(input.amount) || input.amount < limits.min) {
    throw new ValidationError("Choose an amount to tip.", {
      amount: [`The smallest tip is ${limits.min / 100}.`],
    });
  }
  if (input.amount > limits.max) {
    throw new ValidationError("That is more than we can take as a tip.", {
      amount: ["Get in touch if you want to send more than this."],
    });
  }

  const product = await products.findById(input.productId);
  if (!product || product.status !== "published" || product.deletedAt) {
    throw new NotFoundError("product", { id: input.productId });
  }
  if (!product.vendorId) {
    throw new ValidationError("This one is published by CoSetup, so there is nobody to tip.", {
      productId: ["No vendor on this product."],
    });
  }

  const vendor = await Vendor.findById(product.vendorId)
    .select({ commissionBasisPoints: 1, status: 1 })
    .session(session ?? null)
    .lean<{ commissionBasisPoints?: number; status: string }>();

  if (!vendor || vendor.status === "offboarded") {
    throw new ValidationError("This vendor is no longer taking payments.", {
      productId: ["The vendor has left."],
    });
  }

  /*
   * Resolved **now** and stored, never read again.
   *
   * The rule every other earning follows: `ledger-service.ts` reads the rate off
   * the line it was snapshotted onto, so a rate change applies to future money
   * only. A tip has no line, so the snapshot lives on the tip.
   */
  const { basisPoints } = await resolveCommission(vendor);
  const split = splitTip(money(input.amount, input.currency), basisPoints);

  const [tip] = await Tip.create(
    [
      {
        vendorId: product.vendorId,
        productId: toObjectId(input.productId),
        organizationId: toObjectId(context.organizationId),
        fromUserId: toObjectId(context.userId),
        amount: { amount: input.amount, currency: input.currency },
        commissionBasisPoints: basisPoints,
        ...(input.note ? { note: input.note } : {}),
      },
    ],
    session ? { session, ordered: true } : { ordered: true },
  );

  return { tip: tip!.toObject() as TipDoc, split };
}

/* ────────────────────────────────────────────── the offer */

export interface TipCurrencyOption {
  currency: StorefrontCurrency;
  presets: readonly number[];
}

export interface TipOffer {
  vendorName: string;
  commissionBasisPoints: number;
  /** What the viewer is browsing in — may not be one we can charge. */
  currency: StorefrontCurrency;
  /**
   * The currencies a tip can actually be taken in, with their amounts.
   *
   * **Empty means no provider is configured for anything**, and the dialog says
   * so instead of offering buttons. That is the state a fresh environment is in,
   * and discovering it after choosing an amount is the failure this exists to
   * prevent.
   */
  options: readonly TipCurrencyOption[];
}

/**
 * Everything a tip screen needs, resolved once on the server.
 *
 * ## Why the currency list comes from here
 *
 * Because "can we take money in GBP" is a question about payment settings, and
 * the answer changes without any code change — an admin turning Stripe off makes
 * every GBP price on the marketplace unchargeable. The tip dialog used to take a
 * single currency and find out at submit time, which put
 * *"We can't take payment in GBP at the moment"* under a button somebody had
 * already decided to press.
 *
 * Now the screen is handed what is possible and can offer the switch itself.
 *
 * ## The rate is resolved here too
 *
 * One lookup, so the split shown is the split `createTip` will snapshot.
 */
export async function tipOfferFor(input: {
  vendorId: string;
  vendorName: string;
  currency: StorefrontCurrency;
}): Promise<TipOffer> {
  const { payableCurrencies } = await import("@/services/payments/registry");
  const [{ basisPoints }, payable] = await Promise.all([
    resolveCommissionForVendor(input.vendorId),
    payableCurrencies(),
  ]);

  const options = payable
    // A provider may take a currency the storefront does not price in; only the
    // storefront's own list has presets, and offering an amount we cannot show
    // in a button is not an offer.
    .filter((currency): currency is StorefrontCurrency => currency in TIP_PRESETS)
    .map((currency) => ({ currency, presets: TIP_PRESETS[currency] }));

  return {
    vendorName: input.vendorName,
    commissionBasisPoints: basisPoints,
    currency: input.currency,
    options,
  };
}
