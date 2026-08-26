import { ImageResponse } from "next/og";
import { BRAND } from "@/config/brand";
import { BRAND_MARK_ACCENT, BRAND_MARK_INK } from "@/components/shell/brand-mark";

/**
 * The default social card — §93.
 *
 * ## Why generated rather than a PNG in `public/`
 *
 * A static file would need designing, exporting and re-exporting whenever the
 * wording changes, and it would be one image for a site whose pages differ.
 * `ImageResponse` renders it from the same tokens as the app, so the card and
 * the site cannot drift apart, and a per-product card is a copy of this file
 * with the product's name in it when that is wanted.
 *
 * ## No custom font
 *
 * Loading Archivo here means reading a `.ttf` at request time and shipping it
 * in the serverless bundle, for a 1200×630 image most people see at thumbnail
 * size. The system stack renders close enough and costs nothing. If the brand
 * mark ever has to be exact, that is the trade to revisit.
 *
 * A root-level `opengraph-image` applies to every route that does not define
 * its own, so this is the whole site's fallback in one file. Product pages
 * override it through `generateMetadata`'s `openGraph.images`.
 */

export const alt = "CoSetup — software, set up for you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        // The Meridian ink and paper, as literals: `ImageResponse` renders
        // outside the document, so CSS custom properties do not resolve here.
        background: "#0b0b0c",
        color: "#fbfaf7",
        padding: "72px 80px",
      }}
    >
      {/* The lockup. The paths are imported from `brand-mark.tsx` but the `<svg>`
          is rebuilt here, because Satori renders a subset of SVG and resolves no
          CSS variables — so the component itself cannot be used, only its
          geometry, which is the part that must not drift. The dark theme's ink
          and accent, as literals, since this card is always on the dark ground. */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="58" height="58" viewBox="0 0 112 112">
          <path fill="#fbfaf7" d={BRAND_MARK_INK} />
          <path fill="#ff6a3d" d={BRAND_MARK_ACCENT} />
        </svg>
        <div
          style={{ display: "flex", fontSize: 40, letterSpacing: "-0.03em", fontWeight: 600 }}
        >
          {BRAND.name}
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
        Software, set up for you.
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#8a8a82" }}>
        Find it · Make it yours · Run it
      </div>
    </div>,
    size,
  );
}
