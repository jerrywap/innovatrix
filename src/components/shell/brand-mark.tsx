/**
 * The CoSetup mark — the interlocking C/S from the brand sheet.
 *
 * ## Where the geometry came from
 *
 * Traced from `ai-contexts/branding/branding.png`, not redrawn. That distinction
 * cost a first attempt: the mark *reads* as a ring with a letter inside, and a
 * from-scratch construction on that reading produced a recognisably different
 * logo. It is actually **two interlocking hook strokes** — one sweeping over the
 * top, down the left and back to the centre; the other from the centre out
 * right, down and back along the bottom — and the C and the S are the two
 * counters that fall out of the overlap rather than two glyphs laid on top of
 * each other. Nothing about that is guessable from a description.
 *
 * So it is a real trace of the supplied artwork: potrace over two colour masks
 * (the full silhouette, and the accent isolated on red-minus-blue), remapped
 * into this 112-unit square with the mark centred and a 4-unit margin.
 *
 * ## Two paths, one silhouette
 *
 * `BRAND_MARK_INK` is the **whole** mark, accent included; `BRAND_MARK_ACCENT` is drawn over the top of it. Layering rather than butting them together is what keeps the seam
 * invisible — the brand sheet blends the two colours through a gradient, and any
 * hard split has to fall somewhere. Ordering matters: accent second.
 *
 * ## Colour
 *
 * `BRAND_MARK_INK` takes `currentColor`, so the mark inherits the surrounding text — near
 * black on the warm ground, warm white on the dark one — and §18's light, dark
 * and monochrome treatments all come out of one asset. `BRAND_MARK_ACCENT` takes `--signal`, the token that already holds the brand orange. Flat fills, no
 * gradient: §17 rules gradients out, and one is invisible at the 24px minimum
 * size the brand sheet specifies anyway.
 *
 * `aria-hidden` because every caller wraps this in a link or a heading that
 * already carries the accessible name.
 */

/** The full silhouette, accent included. */
export const BRAND_MARK_INK =
  "M 43.78 4.25 C 41.41 4.43, 39.64 4.75, 36.3 5.61 C 34.47 6.08, 32.2 6.98, 29.94 8.12 C 18.99 13.62, 11.29 24.34, 9.61 36.42 C 7.33 52.77, 15.18 67.76, 29.9 75.16 C 30.9 75.66, 31.84 76.08, 31.98 76.08 C 32.12 76.08, 32.59 76.23, 33.02 76.43 C 33.45 76.62, 34.03 76.84, 34.3 76.91 C 34.58 76.98, 35.42 77.22, 36.17 77.43 C 40.35 78.63, 40.69 78.66, 53.15 78.68 C 65.01 78.7, 65.01 78.7, 66.19 78.09 C 70.46 75.9, 71.14 70.32, 67.58 66.82 C 65.69 64.96, 66.24 65.04, 54 64.87 C 46.27 64.76, 42.93 64.62, 42.03 64.38 C 38.66 63.48, 37.91 63.23, 36.17 62.41 C 17.42 53.55, 20.13 25.8, 40.41 18.96 C 44.24 17.67, 67.52 16.98, 72.34 18.02 C 78.8 19.41, 82.95 22.81, 85.32 28.67 C 87.96 35.17, 95.68 36.19, 98.67 30.44 C 101.01 25.94, 96.04 15.89, 88.68 10.25 C 85.82 8.05, 81.57 6.03, 77.32 4.83 C 74.84 4.13, 50.8 3.71, 43.78 4.25 M 49.39 38.42 C 48.91 38.68, 48.28 39, 47.99 39.13 C 45.7 40.19, 44.54 45.23, 45.96 47.9 C 47.9 51.54, 49.18 51.88, 60.89 51.89 C 70.86 51.9, 72.26 52.04, 75.47 53.33 C 85.26 57.27, 90.83 68.54, 87.88 78.45 C 85.65 85.95, 80.1 91.54, 72.83 93.59 C 70.7 94.19, 48.04 94.57, 44.15 94.06 C 40.11 93.54, 37.26 92.26, 34.26 89.62 C 30.75 86.54, 26.91 86.58, 23.42 89.72 C 20.19 92.65, 21.44 96.73, 27 101.4 C 28.05 102.29, 29 103.01, 29.09 103.01 C 29.19 103.01, 29.61 103.27, 30.04 103.59 C 31.82 104.93, 36.06 106.63, 39.82 107.51 C 41.79 107.97, 42.88 108, 56.94 108 C 72.81 107.99, 72.66 108, 77.32 106.8 C 86.2 104.5, 95.56 96.31, 99.37 87.49 C 100.31 85.31, 100.49 84.86, 100.98 83.43 C 101.93 80.68, 102.24 78.88, 102.67 73.75 C 103.09 68.75, 100.53 58.87, 97.85 55.21 C 97.54 54.77, 97.28 54.34, 97.28 54.26 C 97.28 53.77, 94.1 49.9, 91.94 47.77 C 86.81 42.69, 80.75 39.61, 73.25 38.29 C 69.81 37.68, 50.56 37.78, 49.39 38.42";

/** The upper-right terminal, drawn over `BRAND_MARK_INK`. */
export const BRAND_MARK_ACCENT =
  "M 44.57 4.37 C 42.25 4.72, 41.83 4.89, 42.4 5.24 C 42.68 5.42, 42.69 5.53, 42.44 5.83 C 42.19 6.13, 42.29 6.83, 42.94 9.47 C 43.72 12.64, 43.74 12.8, 43.43 14.64 C 43.17 16.21, 43.17 16.58, 43.45 16.76 C 43.71 16.93, 43.69 17.03, 43.34 17.24 C 43.1 17.38, 42.91 17.57, 42.91 17.67 C 42.91 17.76, 49.11 17.84, 56.69 17.84 C 64.26 17.84, 71.08 17.94, 71.84 18.06 C 78.34 19.09, 83.3 23.13, 85.45 29.17 C 87.39 34.64, 94.73 36.05, 98.05 31.6 C 102.18 26.07, 95.34 13.52, 85.18 7.99 C 84.36 7.54, 83.57 7.1, 83.43 7 C 82.92 6.64, 79.66 5.44, 77.47 4.82 C 74.72 4.04, 49.11 3.69, 44.57 4.37";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 112" className={className} aria-hidden="true" focusable="false">
      <path fill="currentColor" d={BRAND_MARK_INK} />
      <path fill="var(--signal)" d={BRAND_MARK_ACCENT} />
    </svg>
  );
}
