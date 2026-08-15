/**
 * Money — spec §84.
 *
 * Money is an integer count of the currency's *minor* units plus an ISO-4217
 * code. £299.99 is `{ amount: 29999, currency: "GBP" }`.
 *
 * Rules this module enforces, because the database cannot:
 *   1. `amount` is always an integer. A float here is silent corruption.
 *   2. Two Money values of different currencies never combine.
 *   3. The minor-unit exponent comes from the registry, never a hardcoded 100.
 *      (JPY has 0 decimal places; KWD has 3. Assuming 2 is a bug waiting for
 *      the first customer outside western Europe.)
 */

export const CURRENCIES = {
  GBP: { code: "GBP", exponent: 2, symbol: "£", name: "Pound Sterling", locale: "en-GB" },
  USD: { code: "USD", exponent: 2, symbol: "$", name: "US Dollar", locale: "en-US" },
  EUR: { code: "EUR", exponent: 2, symbol: "€", name: "Euro", locale: "en-IE" },
  NGN: { code: "NGN", exponent: 2, symbol: "₦", name: "Nigerian Naira", locale: "en-NG" },
  GHS: { code: "GHS", exponent: 2, symbol: "₵", name: "Ghanaian Cedi", locale: "en-GH" },
  ZAR: { code: "ZAR", exponent: 2, symbol: "R", name: "South African Rand", locale: "en-ZA" },
  KES: { code: "KES", exponent: 2, symbol: "KSh", name: "Kenyan Shilling", locale: "en-KE" },
  JPY: { code: "JPY", exponent: 0, symbol: "¥", name: "Japanese Yen", locale: "ja-JP" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export interface Money {
  readonly amount: number; // integer, minor units
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

/* ────────────────────────────────────────────── construction */

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(
      `Money amount must be an integer in minor units, received ${amount}. ` +
        `Did you pass a decimal? Use fromDecimal(${amount}, "${currency}").`,
    );
  }
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`Money amount ${amount} exceeds the safe integer range.`);
  }
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Unsupported currency "${currency}".`);
  }
  return { amount, currency };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/**
 * Build Money from a human decimal figure — admin forms, imported price lists.
 * Rounds half-up at the currency's precision; anything finer was never real money.
 */
export function fromDecimal(value: number | string, currency: CurrencyCode): Money {
  const n = typeof value === "string" ? Number(value.replace(/[\s,]/g, "")) : value;
  if (!Number.isFinite(n)) {
    throw new MoneyError(`Cannot read "${value}" as a monetary amount.`);
  }
  const factor = 10 ** currencyOf(currency).exponent;
  return money(Math.round(n * factor), currency);
}

export function toDecimal(m: Money): number {
  return m.amount / 10 ** currencyOf(m.currency).exponent;
}

function currencyOf(code: CurrencyCode) {
  const c = CURRENCIES[code];
  if (!c) throw new MoneyError(`Unsupported currency "${code}".`);
  return c;
}

/* ────────────────────────────────────────────── arithmetic */

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Cannot combine ${a.currency} with ${b.currency}. ` +
        `Convert deliberately with a recorded rate — never implicitly.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/** Multiply by a whole quantity — line item × units. */
export function multiply(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(`Quantity must be a whole number, received ${quantity}.`);
  }
  return money(m.amount * quantity, m.currency);
}

/**
 * Take a percentage expressed in **basis points** (1% = 100bps), so tax and
 * discount rates never arrive as 0.2 vs 20 ambiguity. Rounds half-up.
 */
export function percentage(m: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError(`Basis points must be an integer, received ${basisPoints}.`);
  }
  return money(Math.round((m.amount * basisPoints) / 10_000), m.currency);
}

export function sum(items: readonly Money[], currency?: CurrencyCode): Money {
  const first = items[0];
  if (!first) {
    if (!currency) {
      throw new MoneyError("sum() of an empty list needs an explicit currency.");
    }
    return zero(currency);
  }
  if (currency && first.currency !== currency) assertSameCurrency(first, zero(currency));
  return items.reduce((acc, m) => add(acc, m), zero(first.currency));
}

export function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}

/**
 * Split an amount into n parts without losing or inventing a minor unit.
 * The remainder is distributed one unit at a time across the leading parts —
 * £10.00 into 3 becomes [334, 333, 333], never [333, 333, 333].
 */
export function allocate(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError(`Cannot split money into ${parts} parts.`);
  }
  const base = Math.trunc(m.amount / parts);
  let remainder = m.amount - base * parts;
  const step = remainder >= 0 ? 1 : -1;

  return Array.from({ length: parts }, () => {
    let value = base;
    if (remainder !== 0) {
      value += step;
      remainder -= step;
    }
    return money(value, m.currency);
  });
}

/* ────────────────────────────────────────────── comparison */

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount === b.amount ? 0 : a.amount > b.amount ? 1 : -1;
}

export const isZero = (m: Money) => m.amount === 0;
export const isPositive = (m: Money) => m.amount > 0;
export const isNegative = (m: Money) => m.amount < 0;
export const greaterThan = (a: Money, b: Money) => compare(a, b) === 1;
export const lessThan = (a: Money, b: Money) => compare(a, b) === -1;
export const gte = (a: Money, b: Money) => compare(a, b) >= 0;

/* ────────────────────────────────────────────── formatting */

export interface FormatOptions {
  /** Override the currency's default locale (e.g. render NGN in en-GB). */
  locale?: string;
  /** Drop the fractional part when it is zero: £299 rather than £299.00. */
  compact?: boolean;
}

export function format(m: Money, options: FormatOptions = {}): string {
  const currency = currencyOf(m.currency);
  const locale = options.locale ?? currency.locale;
  const decimals =
    options.compact && m.amount % 10 ** currency.exponent === 0 ? 0 : currency.exponent;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toDecimal(m));
}

/** Bare numeric string for CSV, PDF tables and provider payloads. */
export function formatPlain(m: Money): string {
  return toDecimal(m).toFixed(currencyOf(m.currency).exponent);
}

/* ────────────────────────────────────────────── persistence */

export interface MoneyDocument {
  amount: number;
  currency: string;
}

export function toDocument(m: Money): MoneyDocument {
  return { amount: m.amount, currency: m.currency };
}

export function fromDocument(doc: MoneyDocument | null | undefined): Money | null {
  if (!doc) return null;
  if (!isCurrencyCode(doc.currency)) {
    throw new MoneyError(`Stored currency "${doc.currency}" is not supported.`);
  }
  return money(doc.amount, doc.currency);
}
