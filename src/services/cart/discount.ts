import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import type { DiscountCodeDoc } from "@/lib/db/models/commerce";
import type { Money } from "@/lib/money";
import { discountCodes } from "@/repositories/discount-code.repository";
import { orders } from "@/repositories/order.repository";
import { meetsMinimumSpend, type DiscountInput } from "./calculate";

/**
 * Discount validation — ticket 10.
 *
 * ## Validated on **every** recalculation, not just at entry
 *
 * That is the acceptance criterion, and it is not pedantry. A code entered on
 * Monday and checked out on Friday may have expired, hit its usage limit, or
 * been deactivated in between. Validating only at entry means the customer
 * reaches the payment page with a total the server will not honour — and the
 * discrepancy surfaces after they have paid.
 *
 * So the cart stores the *code*, never the computed discount, and this runs on
 * every read.
 *
 * ## A refusal is not an error
 *
 * An expired code returns a reason, and the cart shows it as a notice while
 * quietly dropping the discount from the total. Throwing would take out the
 * cart page over a promotion that ended.
 */

export type DiscountRefusal =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit_reached"
  | "per_customer_limit_reached"
  | "below_minimum_spend"
  | "wrong_currency"
  | "no_eligible_items";

export interface DiscountEvaluation {
  applied?: DiscountInput;
  refusal?: DiscountRefusal;
  /** Customer-facing, and specific about what to do next. */
  message?: string;
}

const MESSAGES: Record<DiscountRefusal, string> = {
  not_found: "That code isn't recognised. Check the spelling and try again.",
  inactive: "That code is no longer available.",
  not_started: "That code isn't active yet.",
  expired: "That code has expired.",
  usage_limit_reached: "That code has been fully claimed.",
  per_customer_limit_reached: "You've already used that code.",
  below_minimum_spend: "Your order doesn't reach the minimum for that code yet.",
  wrong_currency: "That code applies to a different currency.",
  no_eligible_items: "That code doesn't apply to anything in your basket.",
};

export interface EvaluateInput {
  code: string;
  subtotal: Money;
  /** Product ids in the cart, for scoped codes. */
  productIds: readonly string[];
  /** Category slugs of those products, for scoped codes. */
  categorySlugs: readonly string[];
  /** For `perCustomerLimit`. Absent for a guest, which skips that check. */
  organizationId?: string | undefined;
  now?: Date;
}

export async function evaluateDiscount(input: EvaluateInput): Promise<DiscountEvaluation> {
  await connectToDatabase();

  const code = await discountCodes.findByCode(input.code);
  if (!code) return refuse("not_found");

  return evaluateAgainst(code, input);
}

/**
 * The rules, separated from the lookup so every one is testable directly.
 *
 * Order matters for the *message*, not the outcome: "expired" is more useful
 * than "below minimum spend" for a code that is both.
 */
export async function evaluateAgainst(
  code: DiscountCodeDoc,
  input: EvaluateInput,
): Promise<DiscountEvaluation> {
  const now = input.now ?? new Date();

  if (!code.isActive) return refuse("inactive");
  if (code.startsAt && now < code.startsAt) return refuse("not_started");
  if (code.expiresAt && now > code.expiresAt) return refuse("expired");

  if (code.usageLimit !== undefined && code.usedCount >= code.usageLimit) {
    return refuse("usage_limit_reached");
  }

  // A fixed discount in another currency has no meaning here, and converting
  // would need an FX rate this platform deliberately does not have (§43).
  if (code.kind === "fixed" && code.currency && code.currency !== input.subtotal.currency) {
    return refuse("wrong_currency");
  }

  if (!isScopedToSomethingInTheCart(code, input)) return refuse("no_eligible_items");
  if (!meetsMinimumSpend(input.subtotal, code.minSpend)) return refuse("below_minimum_spend");

  if (code.perCustomerLimit !== undefined && input.organizationId) {
    const used = await orders.countForOrg(input.organizationId, {
      "discount.code": code.code,
      status: { $in: ["paid", "fulfilled"] },
    });
    if (used >= code.perCustomerLimit) return refuse("per_customer_limit_reached");
  }

  return {
    applied: { code: code.code, kind: code.kind, value: code.value },
  };
}

/**
 * An unscoped code applies to everything. A scoped one needs at least one
 * matching item — and the two lists are OR'd, so "CRM products or anything in
 * the finance category" is one code rather than two.
 */
function isScopedToSomethingInTheCart(code: DiscountCodeDoc, input: EvaluateInput): boolean {
  const hasProductScope = code.productIds.length > 0;
  const hasCategoryScope = code.categorySlugs.length > 0;
  if (!hasProductScope && !hasCategoryScope) return true;

  const productIds = new Set(input.productIds);
  const categories = new Set(input.categorySlugs);

  return (
    code.productIds.some((id) => productIds.has(String(id))) ||
    code.categorySlugs.some((slug) => categories.has(slug))
  );
}

function refuse(refusal: DiscountRefusal): DiscountEvaluation {
  return { refusal, message: MESSAGES[refusal] };
}

export { MESSAGES as DISCOUNT_MESSAGES };
