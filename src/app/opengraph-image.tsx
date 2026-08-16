import { ImageResponse } from "next/og";

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

export const alt = "Innovatrix — find, customise, build and run your software";
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
      <div
        style={{
          display: "flex",
          fontSize: 26,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "#8a8a82",
        }}
      >
        Innovatrix
      </div>

      <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
        Find, customise, build and run your software.
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#8a8a82" }}>
        Buy what exists · Have it adapted · Commission it outright
      </div>
    </div>,
    size,
  );
}
