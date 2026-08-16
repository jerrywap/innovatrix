import { cn } from "@/lib/utils";
import { format, type Money, type FormatOptions } from "@/lib/money";

/**
 * Render money — §84.
 *
 * The only sanctioned way to put an amount on screen. It goes through
 * `lib/money.ts`, which means integer minor units and `Intl.NumberFormat`.
 *
 * **Never `toFixed`.** `(29999 / 100).toFixed(2)` looks right until the
 * currency isn't two-decimal (JPY has none), or the locale wants a different
 * separator, or a float rounds `1.005` to `1.00`. Every one of those is a
 * number a customer is being asked to pay.
 *
 * Tabular figures so a column of prices aligns on the decimal point — the
 * difference between a table that can be scanned and one that has to be read.
 */
export function MoneyDisplay({
  value,
  className,
  compact,
  locale,
  /** Show `—` rather than nothing when there is no amount. */
  placeholder = "—",
}: {
  value: Money | null | undefined;
  className?: string;
  placeholder?: string;
} & FormatOptions) {
  if (!value) {
    return <span className={cn("text-subtle", className)}>{placeholder}</span>;
  }

  const options: FormatOptions = {};
  if (compact !== undefined) options.compact = compact;
  if (locale !== undefined) options.locale = locale;

  return (
    <span className={cn("font-mono tabular-nums", className)}>{format(value, options)}</span>
  );
}
