import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A rating, rendered — vendor ticket 10.
 *
 * A Server Component, like `<MoneyDisplay>`, and for the same reason: it is the one sanctioned
 * way to put a rating on screen, so the accessible name and the rounding live in one place
 * rather than in each of the five screens that show one.
 *
 * ## The number is next to the stars, always
 *
 * Five drawn stars with no figure is a design that reads well and informs badly: 4.6 from
 * three hundred reviews and 4.6 from two are the same picture and very different products. The
 * count is part of the rating, not a detail beside it.
 *
 * ## Halves are drawn by clipping, not by a third icon
 *
 * A half star is the same `Star` at 50% width over a muted one. A separate "half" glyph would
 * be a second thing to keep visually in step with the whole one.
 */
export function StarRating({
  average,
  count,
  size = "default",
  className,
}: {
  /** One decimal place, as `averageRating()` produces. `null` renders nothing at all. */
  average: number | null;
  count?: number;
  size?: "default" | "small";
  className?: string;
}) {
  // No rating is **not** zero stars. A product nobody has reviewed must not look like a
  // product everybody hated, so there is nothing to draw.
  if (average === null) return null;

  const star = size === "small" ? "size-3" : "size-3.5";
  const text = size === "small" ? "text-[11.5px]" : "text-[12.5px]";

  return (
    <span
      className={cn("flex items-center gap-1.5", className)}
      // One accessible name for the whole control rather than five decorative stars and a
      // number the screen reader has to reassemble.
      aria-label={
        count === undefined
          ? `Rated ${average} out of 5`
          : `Rated ${average} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`
      }
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((position) => {
          const fill = Math.max(0, Math.min(1, average - (position - 1)));
          return (
            <span key={position} className="relative inline-flex">
              <Star className={cn(star, "text-border")} strokeWidth={1.5} />
              {fill > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star
                    className={cn(star, "fill-[var(--signal)] text-[var(--signal)]")}
                    strokeWidth={1.5}
                  />
                </span>
              )}
            </span>
          );
        })}
      </span>

      <span className={cn("text-muted-foreground tabular-nums", text)} aria-hidden>
        {average.toFixed(1)}
        {count !== undefined && ` (${count})`}
      </span>
    </span>
  );
}

/**
 * The distribution, as five bars.
 *
 * Shown on a product page under the average, because "4.2" made of forty fives and ten ones
 * is a different product from one made of fifty fours — and a buyer deciding between two
 * products is exactly the person for whom that difference matters.
 *
 * Percentages of the largest bucket rather than of the total, so a distribution with one
 * dominant bucket still shows the shape of the rest.
 */
export function RatingDistribution({
  distribution,
  count,
}: {
  /** Five counts, one-star first. */
  distribution: readonly number[];
  count: number;
}) {
  if (count === 0) return null;
  const largest = Math.max(...distribution, 1);

  return (
    <ul className="flex flex-col gap-1">
      {[5, 4, 3, 2, 1].map((stars) => {
        const value = distribution[stars - 1] ?? 0;
        return (
          <li key={stars} className="flex items-center gap-2 text-[12px]">
            <span className="text-subtle w-8 shrink-0 tabular-nums">{stars}★</span>
            <span className="bg-surface-muted h-1.5 flex-1 overflow-hidden rounded-full">
              <span
                className="block h-full rounded-full bg-[var(--signal)]"
                style={{ width: `${(value / largest) * 100}%` }}
              />
            </span>
            <span className="text-subtle w-8 shrink-0 text-right tabular-nums">{value}</span>
          </li>
        );
      })}
    </ul>
  );
}
