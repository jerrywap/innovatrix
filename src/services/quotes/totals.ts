import type { QuoteItem } from "@/lib/db/models/billing";

/**
 * Quote arithmetic — §51, §84.
 *
 * Pure, so it can be tested exhaustively without a database. Every figure is an
 * **integer in minor units**; nothing here divides, and nothing here sees a
 * float.
 *
 * ## The order is discount, then tax, and it is not arbitrary
 *
 * Tax applies to what is actually being charged. Taxing the pre-discount
 * subtotal charges tax on money nobody pays, which is both wrong and the kind
 * of wrong that gets noticed by an auditor rather than a customer. The cart
 * (ticket 10) fixed the same order for the same reason, and the two must agree
 * — a quote that totals differently from a basket for identical numbers is a
 * conversation nobody wants to have.
 *
 * ## Rounding happens once, at the end of each step
 *
 * Not per line. Rounding a percentage per line and summing accumulates up to
 * one minor unit of drift per line, which on a twenty-line quote is twenty
 * pence that reconciles against nothing.
 */

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface TotalsInput {
  items: readonly Pick<QuoteItem, "quantity" | "unitPrice">[];
  /** Flat amount off, in minor units. Clamped to the subtotal. */
  discountAmount?: number;
  /** Basis points — 2000 = 20%. */
  taxBasisPoints?: number;
}

export function lineTotal(item: Pick<QuoteItem, "quantity" | "unitPrice">): number {
  // Integer × integer. The quantity is validated as a positive integer upstream.
  return item.unitPrice.amount * item.quantity;
}

export function computeTotals(input: TotalsInput): QuoteTotals {
  const subtotal = input.items.reduce((sum, item) => sum + lineTotal(item), 0);

  /*
   * Clamped, not allowed to go negative. A discount larger than the subtotal is
   * a data-entry mistake, and a negative total is one that would flow into an
   * invoice and then into a payment provider that rejects it — much further
   * from the mistake than here.
   */
  const discount = Math.min(Math.max(input.discountAmount ?? 0, 0), subtotal);
  const taxable = subtotal - discount;

  // `Math.round`, once, on the post-discount figure.
  const tax = input.taxBasisPoints ? Math.round((taxable * input.taxBasisPoints) / 10_000) : 0;

  return { subtotal, discount, taxable, tax, total: taxable + tax };
}

/**
 * What the customer pays now under deposit terms.
 *
 * Rounded **down**, so the deposit is never more than the stated percentage and
 * the balance absorbs the odd penny. Asking for a penny more than the terms say
 * is the version somebody complains about.
 */
export function depositAmount(total: number, basisPoints: number): number {
  return Math.floor((total * basisPoints) / 10_000);
}

export function balanceAmount(total: number, basisPoints: number): number {
  return total - depositAmount(total, basisPoints);
}
