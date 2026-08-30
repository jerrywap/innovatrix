/**
 * A stable decorative band for something that has no image.
 *
 * Built from `--chart-*` and `--signal`, which are already defined in both
 * themes, so a fallback needs no dark-mode branch of its own.
 *
 * **Derived from a slug, so it never changes under a returning visitor.** A
 * vendor's slug is immutable once verified and a category's slug is immutable by
 * policy, which is what makes a hash of it a safe input — the alternative,
 * picking at random or by index, gives the same thing a different colour on every
 * deploy.
 *
 * Lifted out of `storefront-body.tsx`, where it was private, when category cards
 * needed the same fallback. Two copies of a colour-picking rule is two ways for
 * the same vendor to look different on two screens.
 */
const GRADIENTS = [
  "from-[var(--chart-1)]/55 via-[var(--chart-2)]/30 to-[var(--chart-4)]/20",
  "from-[var(--chart-5)]/55 via-[var(--chart-4)]/30 to-[var(--chart-3)]/20",
  "from-[var(--chart-2)]/55 via-[var(--chart-3)]/30 to-[var(--chart-5)]/20",
  "from-[var(--chart-4)]/55 via-[var(--chart-1)]/25 to-[var(--chart-2)]/20",
  "from-[var(--signal)]/45 via-[var(--chart-3)]/30 to-[var(--chart-5)]/20",
] as const;

export function gradientFor(slug: string): string {
  let sum = 0;
  for (let index = 0; index < slug.length; index += 1) sum += slug.charCodeAt(index);
  return GRADIENTS[sum % GRADIENTS.length] ?? GRADIENTS[0];
}
