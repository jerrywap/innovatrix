import { cn } from "@/lib/utils";

/**
 * "Free" — the word, in one place.
 *
 * ## Why this is not a change to `MoneyDisplay`
 *
 * A £0 product used to render **"£0.00"**, because `card-mapper` only decides
 * whether a price *exists* and hands the amount to `MoneyDisplay`. Making
 * `format()` return "Free" at zero would have been the small change and the
 * wrong one: "£0.00" is correct on a tax line, on a discount row, on a
 * zero-amount ledger entry and on a £0 total in a statement, and all of those go
 * through the same renderer. Zero is a number there and a proposition here.
 *
 * So the decision lives in the view — `price.amount === 0` — and the word,
 * the colour and the shape live here, once, rather than in each of the three
 * places that render a price.
 *
 * ## The colour
 *
 * `positive`'s palette from `status-badge.tsx`, deliberately the same green as
 * "paid" and "live": free is a settled, good state, and inventing a fifth accent
 * for it would make the storefront louder without making it clearer. Both themes
 * are checked against the muted surface, which is the hardest background.
 */
export function FreeBadge({
  className,
  size = "default",
}: {
  className?: string;
  /** `compact` for a basket line or an add-on row, where it sits inline. */
  size?: "default" | "compact";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        size === "compact" ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-[12.5px]",
        className,
      )}
    >
      Free
    </span>
  );
}
