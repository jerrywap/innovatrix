"use client";

import { useTransition } from "react";
import Image from "next/image";
import { TriangleAlert } from "lucide-react";
import { CURRENCIES } from "@/lib/money";
import { removeBlockedLinesAction, switchCurrencyAction } from "../actions";
import { RemoveButton } from "./cart-lines";
import type { CartBlockedLine } from "@/services/cart/cart-service";

/**
 * The lines the basket cannot buy, and how to get past them.
 *
 * ## Why this exists rather than a sentence
 *
 * `recalculate` used to drop an unpriceable line and push a notice carrying its
 * `lineId`. Both halves then vanished: no row meant no Remove button, and a
 * line-scoped notice for a line that is not rendered matches nothing, so the one
 * sentence naming the problem was computed on every render and shown nowhere.
 * What the customer got instead was transient red copy from the switcher —
 * "Not sold in NGN: Drift Portal 877. Remove them or switch back." — a name in a
 * sentence with nothing behind it, gone on the next refresh.
 *
 * So: a row per line, with the picture and the name it already has, and the two
 * controls the copy was describing. `publish-panel.tsx` makes the general
 * argument — a refusal is only useful next to the thing that fixes it.
 *
 * ## Above the basket, not beside the total
 *
 * The old explanation sat in the right-hand column and said "the items above",
 * which on a wide screen was not even geographically true. This is the first
 * thing in the left column, where the items are.
 *
 * ## The currencies offered are the basket's, not the last one used
 *
 * `priceableCurrencies` is an intersection over every line, so a suggestion
 * cannot fix this row and break the next. The cart has no record of "the
 * currency you came from" and guessing it would be exactly that mistake.
 */
export function BlockedLines({
  lines,
  currency,
  priceableCurrencies,
}: {
  lines: readonly CartBlockedLine[];
  currency: string;
  priceableCurrencies: readonly string[];
}) {
  const [pending, startTransition] = useTransition();

  if (lines.length === 0) return null;

  const alternatives = priceableCurrencies.filter((code) => code !== currency);

  return (
    <section
      // `role="alert"` would announce it on every render of a page it is a
      // permanent part of. It is a heading and a list, and the heading says so.
      aria-labelledby="blocked-lines-heading"
      className="border-danger/40 bg-danger/5 flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2
        id="blocked-lines-heading"
        className="flex items-center gap-2 text-[13px] font-medium"
      >
        <TriangleAlert className="text-danger size-3.5 shrink-0" aria-hidden />
        {lines.length === 1
          ? "One item can't be bought right now"
          : `${lines.length} items can't be bought right now`}
      </h2>

      <ul className="flex flex-col gap-2.5">
        {lines.map((line) => (
          <li key={line.lineId} className="flex items-center gap-3">
            {line.imageUrl ? (
              <Image
                src={line.imageUrl}
                alt=""
                width={48}
                height={36}
                className="border-border bg-surface-muted h-9 w-12 shrink-0 rounded-md border object-cover opacity-60"
              />
            ) : (
              <div className="border-border bg-surface-muted h-9 w-12 shrink-0 rounded-md border" />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {line.displayName}
              </span>
              {/*
                Not `line.message` — that names the product, which the line above
                already did. The service keeps the name in it because
                `assertOrderable` quotes the same string with no row to sit on.
              */}
              <span className="text-muted-foreground block text-[12px]">
                {line.reason === "no_price_in_currency"
                  ? `Not sold in ${symbolOf(currency)}`
                  : "No longer available"}
              </span>
            </span>

            {/* Where the price would be. A blank cell reads as "loading". */}
            <span className="text-subtle shrink-0 font-mono text-[13px]" aria-hidden>
              —
            </span>

            <RemoveButton lineId={line.lineId} label={line.displayName} />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void removeBlockedLinesAction())}
          className="border-border hover:bg-surface-muted focus-visible:ring-ring rounded-full border px-3 py-1.5 text-[12.5px] transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          {lines.length === 1 ? "Remove it" : "Remove them"}
        </button>

        {alternatives.map((code) => (
          <button
            key={code}
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void switchCurrencyAction({ currency: code }))}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full px-1 text-[12.5px] underline underline-offset-4 transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            Show my basket in {symbolOf(code)}
          </button>
        ))}
      </div>
    </section>
  );
}

/** "£" reads faster than "GBP" in a sentence; the code stays in the switcher. */
function symbolOf(code: string): string {
  return CURRENCIES[code as keyof typeof CURRENCIES]?.symbol ?? code;
}
