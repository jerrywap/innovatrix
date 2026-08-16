import {
  add,
  money,
  multiply,
  percentage,
  subtract,
  sum,
  zero,
  type CurrencyCode,
  type Money,
} from "@/lib/money";

/**
 * Cart totals — §12, §84.
 *
 * **Pure.** No database, no `await`, no request. Everything here is integer
 * minor units, and the reason this is a separate module from `cart-service` is
 * that these are the rules worth testing exhaustively: they decide what a
 * customer is charged, and every one of them fails silently.
 *
 * ## The order of operations is the whole design
 *
 * ```
 * subtotal   Σ (unit price × quantity)
 * discount   applied to the subtotal
 * taxable    subtotal − discount
 * tax        applied to the taxable amount
 * total      taxable + tax
 * ```
 *
 * Taxing before discounting charges tax on money nobody paid. It is a one-line
 * difference, it looks equally plausible in either order, and it is wrong in a
 * way a customer only notices on the invoice.
 *
 * ## Why the discount is not distributed across lines
 *
 * Splitting a £50 discount across three lines needs `allocate()` and produces
 * three roundings that may not sum back to £50. There is no need: the discount
 * is an order-level figure, stored and shown as one number, and §61's snapshot
 * records it that way. A per-line discount is a different feature and would
 * need `allocate()` precisely so the remainder lands somewhere deterministic.
 */

export interface CalcLine {
  lineId: string;
  /** Integer minor units, in the cart's currency. */
  unitAmount: number;
  quantity: number;
}

export interface DiscountInput {
  code: string;
  kind: "fixed" | "percentage";
  /** Minor units for `fixed`, basis points for `percentage`. */
  value: number;
}

export interface TaxInput {
  ruleId: string;
  basisPoints: number;
}

export interface CartTotals {
  currency: CurrencyCode;
  lineTotals: Array<{ lineId: string; amount: Money }>;
  subtotal: Money;
  discount: Money;
  discountCode?: string;
  taxable: Money;
  tax: Money;
  taxRuleId?: string;
  taxBasisPoints?: number;
  total: Money;
}

export function calculateTotals(input: {
  currency: CurrencyCode;
  lines: readonly CalcLine[];
  discount?: DiscountInput | undefined;
  tax?: TaxInput | undefined;
}): CartTotals {
  const { currency } = input;

  const lineTotals = input.lines.map((line) => ({
    lineId: line.lineId,
    // Integer × integer. Exact, and the only multiplication in the whole path.
    amount: multiply(money(line.unitAmount, currency), line.quantity),
  }));

  const subtotal = sum(
    lineTotals.map((line) => line.amount),
    currency,
  );

  const discount = discountAmount(subtotal, input.discount);
  const taxable = subtract(subtotal, discount);
  const tax = input.tax ? percentage(taxable, input.tax.basisPoints) : zero(currency);

  return {
    currency,
    lineTotals,
    subtotal,
    discount,
    ...(input.discount ? { discountCode: input.discount.code } : {}),
    taxable,
    tax,
    ...(input.tax
      ? { taxRuleId: input.tax.ruleId, taxBasisPoints: input.tax.basisPoints }
      : {}),
    total: add(taxable, tax),
  };
}

/**
 * How much comes off, clamped to the subtotal.
 *
 * A £100 fixed discount on a £60 cart takes £60, not £100. Without the clamp
 * the total goes **negative**, and a negative total sent to a payment provider
 * is either a hard error or — worse, with the wrong provider — a refund.
 *
 * Percentage discounts round once, here, on the whole subtotal. Rounding per
 * line and summing gives a different answer for the same cart depending on how
 * the customer happened to split it into lines.
 */
function discountAmount(subtotal: Money, discount: DiscountInput | undefined): Money {
  if (!discount) return zero(subtotal.currency);

  const raw =
    discount.kind === "percentage"
      ? percentage(subtotal, discount.value)
      : money(discount.value, subtotal.currency);

  return raw.amount > subtotal.amount ? subtotal : raw;
}

/**
 * Does this cart meet a code's minimum spend?
 *
 * Checked against the **subtotal**, before the discount — otherwise a code
 * with a £100 minimum would disqualify itself the moment it applied.
 */
export function meetsMinimumSpend(
  subtotal: Money,
  minSpend: { amount: number; currency: string } | undefined,
): boolean {
  if (!minSpend) return true;
  // A minimum in another currency cannot be compared. Converting would need an
  // FX rate, which this platform deliberately does not have (§43) — so a
  // mismatched minimum means the code does not apply here.
  if (minSpend.currency.toUpperCase() !== subtotal.currency) return false;
  return subtotal.amount >= minSpend.amount;
}
