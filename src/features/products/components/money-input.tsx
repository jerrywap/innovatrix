"use client";

import { useId, useState } from "react";
import { CURRENCIES } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { StorefrontCurrency } from "@/config/storefront";

/**
 * A price, typed as a decimal.
 *
 * ## Formatting happens on blur, never while typing
 *
 * The tempting version reformats on every keystroke. It also fights the caret:
 * type `2999` intending £29.99, and an as-you-type formatter has already
 * rewritten it to `2,999` with the cursor somewhere unexpected. Half the time
 * the number that gets saved is the one the formatter produced, not the one the
 * person meant. Formatting on blur gives the same tidy result with none of that.
 *
 * ## The value posted is a decimal string
 *
 * `299.99`, not `29999`. Conversion to minor units happens server-side in
 * `priceMapSchema` via `fromDecimal`, which knows each currency's exponent —
 * JPY has none, so a client-side `× 100` would be wrong for it. The client
 * never does money arithmetic.
 */
export function MoneyInput({
  name,
  currency,
  defaultAmount,
  label,
  disabled,
  className,
}: {
  /** Posted as `prices[GBP]` — keyed by currency, so blank rows can't misalign. */
  name: string;
  currency: StorefrontCurrency;
  /** Minor units from the database; rendered as a decimal. */
  defaultAmount?: number | undefined;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const meta = CURRENCIES[currency];

  const [value, setValue] = useState(() =>
    defaultAmount === undefined ? "" : toDecimalString(defaultAmount, meta.exponent),
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label htmlFor={id} className="w-14 shrink-0 font-mono text-[12px] tracking-[0.08em]">
        {label ?? currency}
      </label>

      <div className="border-border bg-surface focus-within:ring-ring flex flex-1 items-center rounded-lg border px-2.5 transition focus-within:ring-2">
        <span className="text-subtle pr-1 text-[13px]" aria-hidden>
          {meta.symbol}
        </span>
        <input
          id={id}
          name={name}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setValue(normalise(value, meta.exponent))}
          // `decimal` gives a numeric keypad with a separator on mobile;
          // `type="number"` would reject a pasted "1,299.99" outright.
          inputMode="decimal"
          autoComplete="off"
          placeholder={emptyPlaceholder(meta.exponent)}
          aria-label={`Price in ${currency}`}
          className="w-full bg-transparent py-2 font-mono text-[13.5px] tabular-nums outline-none"
        />
      </div>
    </div>
  );
}

/**
 * Tidy what was typed, without changing what it means.
 *
 * Anything unparseable is left exactly as typed — the server will reject it
 * with a field error naming the problem, which is more useful than this
 * silently blanking someone's input.
 */
function normalise(raw: string, exponent: number): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const parsed = Number(trimmed.replace(/[\s,]/g, ""));
  if (!Number.isFinite(parsed)) return raw;

  return parsed.toFixed(exponent);
}

/**
 * Minor units → the decimal a person edits.
 *
 * `toFixed` is banned for *rendering* money (`AGENTS.md`) because it ignores
 * the currency's exponent and is a float. Here the exponent is passed in
 * explicitly and the value is an integer count of minor units, so the division
 * is exact for every amount inside `Number.MAX_SAFE_INTEGER`. Display anywhere
 * else goes through `MoneyDisplay`.
 */
function toDecimalString(minorUnits: number, exponent: number): string {
  return (minorUnits / 10 ** exponent).toFixed(exponent);
}

function emptyPlaceholder(exponent: number): string {
  return exponent === 0 ? "0" : `0.${"0".repeat(exponent)}`;
}
