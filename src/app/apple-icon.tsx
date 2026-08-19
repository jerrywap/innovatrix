import { ImageResponse } from "next/og";
import { BRAND_MARK_INK } from "@/components/shell/brand-mark";

/**
 * The home-screen icon — white mark on the brand orange, matching the brand
 * sheet's third app-mark treatment.
 *
 * ## Why generated, and why not `icon.svg`
 *
 * iOS ignores `icon.svg`, and it will not composite a transparent icon onto
 * anything sensible, so this surface needs its own square, opaque raster.
 * Generating it from the same path constant as `brand-mark.tsx` is what stops
 * the two drifting — a PNG exported once drifts the first time the mark is
 * touched and nobody notices, because nobody inspects their own home screen.
 *
 * **The accent is deliberately absent.** On an orange ground an orange terminal
 * has nothing to contrast with; the brand sheet's orange tile is a solid white
 * mark for the same reason. This is the one treatment that is monochrome by
 * necessity rather than by choice.
 *
 * iOS rounds the corners itself, so the tile is drawn square — rounding it here
 * shows as a dark seam inside Apple's own mask.
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
        // A literal, not a token: `ImageResponse` renders outside the document,
        // so a CSS custom property has nothing to resolve against.
        background: "#e0521f",
      }}
    >
      <svg width="118" height="118" viewBox="0 0 112 112">
        <path fill="#ffffff" d={BRAND_MARK_INK} />
      </svg>
    </div>,
    size,
  );
}
