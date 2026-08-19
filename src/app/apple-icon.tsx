import { ImageResponse } from "next/og";

/**
 * The home-screen icon — white mark on the brand orange, per the brand sheet's
 * third app-mark treatment.
 *
 * ## Why generated, and why it is not the SVG
 *
 * iOS ignores `icon.svg` and it does not composite a transparent icon onto
 * anything sensible, so this surface needs its own square, opaque, raster asset.
 * Generating it from the same arc geometry as `brand-mark.tsx` is what stops the
 * two drifting; a PNG exported once drifts the first time the mark is touched
 * and nobody notices, because nobody looks at their own home screen icon.
 *
 * iOS also rounds the corners itself, so the square is drawn square. Rounding it
 * here would show as a dark seam inside Apple's own mask.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Literals, not tokens: `ImageResponse` renders outside the document,
        // so a CSS custom property has nothing to resolve against.
        background: "#e0521f",
      }}
    >
      <svg
        width="128"
        height="128"
        viewBox="0.6 10 80 80"
        fill="none"
        stroke="#ffffff"
        strokeWidth={9.5}
        strokeLinecap="round"
      >
        <path d="M70.26 27.25A34 34 0 1 0 62 79.44" />
        <path d="M61.8 39.2A10.8 10.8 0 1 0 51 50a10.8 10.8 0 1 1-10.8 10.8" />
        <path d="M28 20.56A34 34 0 0 1 70.26 27.25" />
      </svg>
    </div>,
    size,
  );
}
