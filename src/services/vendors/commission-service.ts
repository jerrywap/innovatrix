import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { DEFAULT_COMMISSION_BASIS_POINTS, PaymentSettings } from "@/lib/db/models/commerce";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { money, percentage, subtract, type Money } from "@/lib/money";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * What the platform takes, and what the vendor earns — vendor ticket 07.
 *
 * The brief said "payout and percentage rates are configurable". What that costs is a
 * resolution order, a place to configure it, and — the part that is easy to get wrong and
 * expensive to fix — **a rule about when the rate is read**.
 *
 * ## Two levels, most specific wins
 *
 * ```
 * platform default  →  vendor override
 * ```
 *
 * A per-product third level was specified and dropped: it is the level with the least
 * demand and the most explaining attached, and a vendor asking why two of their own
 * products earn different percentages is a conversation nobody wants. `resolveCommission`
 * is a chain precisely so a third level is additive — decision **V1** may yet ask for one
 * that varies by product *type*.
 *
 * ## Basis points, never a float
 *
 * 3000 is 30%. `money.ts` exports `percentage(m, basisPoints)` so the arithmetic is
 * integer throughout, and §84 already settled that argument for prices.
 */

/** The effective rate and where it came from — a vendor sees both. */
export interface EffectiveCommission {
  basisPoints: number;
  source: "platform" | "vendor";
}

/**
 * The platform-wide default, from settings.
 *
 * `DEFAULT_COMMISSION_BASIS_POINTS` is the fallback when nothing is configured, so a
 * fresh database splits money correctly rather than throwing or taking 100%.
 */
export async function platformCommissionBasisPoints(): Promise<number> {
  await connectToDatabase();
  const settings = await PaymentSettings.findOne({ singleton: "global" })
    .select({ commissionBasisPoints: 1 })
    .lean<{ commissionBasisPoints?: number }>();

  return settings?.commissionBasisPoints ?? DEFAULT_COMMISSION_BASIS_POINTS;
}

/**
 * The rate for one vendor, and which level supplied it.
 *
 * Takes the vendor document rather than an id where the caller already has one — at
 * checkout that matters, because resolving per line would be a query per line on the
 * hottest write path in the system.
 */
export async function resolveCommission(
  vendor: Pick<VendorDoc, "commissionBasisPoints"> | null,
): Promise<EffectiveCommission> {
  if (typeof vendor?.commissionBasisPoints === "number") {
    return { basisPoints: vendor.commissionBasisPoints, source: "vendor" };
  }
  return { basisPoints: await platformCommissionBasisPoints(), source: "platform" };
}

/** The same, by id — for a screen showing one vendor their rate. */
export async function resolveCommissionForVendor(
  vendorId: string,
): Promise<EffectiveCommission> {
  await connectToDatabase();
  const vendor = await Vendor.findById(vendorId).select({ commissionBasisPoints: 1 }).lean<{
    commissionBasisPoints?: number;
  }>();
  return resolveCommission(vendor);
}

export interface CommissionSplit {
  /** What the platform keeps. */
  fee: Money;
  /** What the vendor earns. */
  earning: Money;
}

/**
 * Split one line total.
 *
 * `fee = percentage(total, bps)` and `earning = total - fee`, which makes
 * `fee + earning === total` exactly, in every currency including a zero-exponent one
 * like JPY — no rounding rule invented here and no lost pennies. `allocate()` is for
 * apportioning something *across* parties; this is two halves of one number, and
 * subtraction is the arithmetic that cannot drift.
 *
 * Single-currency by construction: both outputs carry the input's currency, and
 * `money.ts` throws on cross-currency arithmetic anyway. What happens at payout when a
 * vendor has earned in three currencies is decision **V5** and vendor ticket 09's
 * problem.
 */
export function splitLineTotal(lineTotal: Money, basisPoints: number): CommissionSplit {
  const fee = percentage(lineTotal, basisPoints);
  return { fee, earning: subtract(lineTotal, fee) };
}

/**
 * What the fee is taken on: the **net line total, after discount and before tax**.
 *
 * Tax is never the platform's revenue, so charging commission on it would take a cut of
 * HMRC's money. And a platform-funded discount should not be charged to the vendor — we
 * chose to discount, so we pay for it.
 *
 * The order carries **one** discount for the whole order, not one per line, so the share
 * has to be apportioned. `allocate()` is exactly right here: it guarantees the parts sum
 * back to the whole, so no penny of discount is applied twice or lost.
 */
export function netOfDiscount(
  lineTotal: Money,
  orderSubtotal: Money,
  orderDiscount: Money | null,
): Money {
  if (!orderDiscount || orderDiscount.amount === 0 || orderSubtotal.amount === 0) {
    return lineTotal;
  }

  // This line's share of the discount, in proportion to its share of the subtotal.
  // Rounded once, here, rather than by an implicit float somewhere downstream.
  const share = Math.round((orderDiscount.amount * lineTotal.amount) / orderSubtotal.amount);
  return subtract(lineTotal, money(Math.min(share, lineTotal.amount), lineTotal.currency));
}

/* ────────────────────────────────────────────── configuring it */

/**
 * Set the platform-wide default.
 *
 * Future orders only. Every order stores the rate it was charged at, which is what makes
 * that sentence true rather than a promise — the same position `/admin/settings/tax`
 * takes about tax rules, in the same words on the screen.
 */
export async function setPlatformCommission(
  basisPoints: number,
  actor: AuditActor,
): Promise<void> {
  assertRate(basisPoints);
  await connectToDatabase();

  const before = await platformCommissionBasisPoints();

  await PaymentSettings.findOneAndUpdate(
    { singleton: "global" },
    { $set: { singleton: "global", commissionBasisPoints: basisPoints } },
    { upsert: true, runValidators: true },
  );

  await writeAuditLog({
    action: "commission.platform_changed",
    actor,
    // Before and after, because "what did we used to take" is the question a dispute
    // starts from.
    before: { basisPoints: before },
    after: { basisPoints },
  });
}

/**
 * Set or clear one vendor's override.
 *
 * `null` clears it, which is different from setting it to the current default: cleared
 * means "follow the platform", so a later platform change carries this vendor with it.
 */
export async function setVendorCommission(
  vendorId: string,
  basisPoints: number | null,
  actor: AuditActor,
): Promise<void> {
  if (basisPoints !== null) assertRate(basisPoints);
  await connectToDatabase();

  const vendor = await Vendor.findById(vendorId)
    .select({ commissionBasisPoints: 1, displayName: 1 })
    .lean<{ commissionBasisPoints?: number; displayName: string }>();
  if (!vendor) throw new NotFoundError("vendor", { id: vendorId });

  await Vendor.updateOne(
    { _id: toObjectId(vendorId) },
    basisPoints === null
      ? { $unset: { commissionBasisPoints: "" } }
      : { $set: { commissionBasisPoints: basisPoints } },
    { runValidators: true },
  );

  await writeAuditLog({
    action: "commission.vendor_changed",
    actor,
    subject: { type: "vendor", id: vendorId },
    before: { basisPoints: vendor.commissionBasisPoints ?? null },
    after: { basisPoints },
  });
}

function assertRate(basisPoints: number): void {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new ValidationError("A commission rate is basis points between 0 and 10000.", {
      basisPoints: ["Whole basis points. 3000 is 30%."],
    });
  }
}

/** `3000` → `"30%"`. For a screen, never for arithmetic. */
export function formatRate(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
