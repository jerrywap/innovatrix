import { ImageResponse } from "next/og";
import { BRAND } from "@/config/brand";

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
      {/* The lockup, drawn rather than imported: the mark's arcs are three path
          strings, and duplicating them here costs less than making `brand-mark`
          render under Satori, which supports a subset of SVG and no CSS
          variables. `brand-mark.tsx` is the source these were copied from. */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg
          width="54"
          height="54"
          viewBox="0.6 10 80 80"
          fill="none"
          strokeWidth={9.5}
          strokeLinecap="round"
        >
          <path stroke="#fbfaf7" d="M70.26 27.25A34 34 0 1 0 62 79.44" />
          <path
            stroke="#fbfaf7"
            d="M61.8 39.2A10.8 10.8 0 1 0 51 50a10.8 10.8 0 1 1-10.8 10.8"
          />
          <path stroke="#ff6a3d" d="M28 20.56A34 34 0 0 1 70.26 27.25" />
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
        Find it · Build it · Run it
      </div>
    </div>,
    size,
  );
}
