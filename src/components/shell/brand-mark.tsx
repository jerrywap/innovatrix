/**
 * The CoSetup mark — an interlocking C and S.
 *
 * ## Geometry, and why it is spelled out here
 *
 * Three stroked arcs on one 100-unit grid, all sharing `stroke-width` and round
 * caps, so the mark is monoline by construction rather than by care:
 *
 * - the **C** — a 250° arc of radius 34 about (45, 50), its gap facing right;
 * - the **S** — two 270° bowls of radius 10.8 about (51, 50), nested inside the
 *   C's counter;
 * - the **orange terminal** — the C's leading 78°, drawn last so its round cap
 *   forms the tip and its tail is hidden under the black arc beneath it.
 *
 * Stroke is 28% of the C's radius, which is the ratio measured off
 * `ai-contexts/branding/branding.png`. Keeping the numbers as literals rather
 * than deriving them from props is deliberate: a logo is not a responsive
 * component, and an arc whose sweep flags are computed is a mark that can be
 * broken by a refactor.
 *
 * The `viewBox` is cropped to the ink (`0.6 10 80 80`) rather than left at
 * `0 0 100 100`: the arcs sit left of centre and well inside the top and bottom
 * of that grid, so the untrimmed box padded the mark with dead space on three
 * sides and made it read a size smaller than the wordmark beside it.
 *
 * This is a clean geometric construction of §17's brief ("combine C + S into a
 * single simple geometric symbol"), not a trace of the brand sheet's raster —
 * that comp reads closer to a stylised S, and a trace of a soft 1536px PNG
 * would be muddier at the 24px minimum size §17 also asks for.
 *
 * ## Colour
 *
 * The two black arcs take `currentColor`, so the mark inherits whatever the
 * surrounding text is — near-black on the warm ground, warm white on the dark
 * one — and §18's light, dark and monochrome treatments all fall out of one
 * asset. The terminal takes `--signal`, the token that already holds the brand
 * orange. Flat colour, no gradient: §17 rules gradients out, and one would be
 * invisible at 24px regardless.
 *
 * `aria-hidden` because every caller wraps this in a link or heading that
 * already carries the accessible name; announcing "CoSetup" twice is worse than
 * not announcing it here.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0.6 10 80 80"
      className={className}
      fill="none"
      strokeWidth={9.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path stroke="currentColor" d="M70.26 27.25A34 34 0 1 0 62 79.44" />
      <path
        stroke="currentColor"
        d="M61.8 39.2A10.8 10.8 0 1 0 51 50a10.8 10.8 0 1 1-10.8 10.8"
      />
      <path stroke="var(--signal)" d="M28 20.56A34 34 0 0 1 70.26 27.25" />
    </svg>
  );
}
