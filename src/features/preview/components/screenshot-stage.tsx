"use client";

import { useState } from "react";
import { PreviewBar } from "./preview-stage";
import { ScreenshotSteps, ScreenshotViewer, type PreviewImage } from "./screenshot-viewer";

/**
 * What a preview is for the 1,005 products that have no live demo.
 *
 * ## Why this exists rather than a 404
 *
 * Five of a thousand published products carry a demo URL, and **none of the
 * website templates does**. A preview page keyed only on demo URLs would be
 * missing from the entire catalogue where previewing matters most, so the page
 * falls back to the thing every product does have: its screenshots.
 *
 * ## No device switcher here, deliberately
 *
 * A screenshot is a fixed-size image. Narrowing the frame around one letterboxes
 * it — the picture does not reflow, because it is a picture. A control that
 * appears to do something and does not is worse than its absence, so the bar
 * carries prev/next instead and the copy says plainly that there is no live demo
 * to resize.
 *
 * ## The image and the controls come from `screenshot-viewer.tsx`
 *
 * Ticket 31 gave the carousel a second caller — a demo whose host refuses to be
 * framed falls back to screenshots too — so both halves moved out and this
 * stage holds the index between them. The layout is unchanged.
 */
export function ScreenshotStage({
  images,
  productName,
  productHref,
  brand,
}: {
  images: readonly PreviewImage[];
  productName: string;
  productHref: string;
  brand: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);

  return (
    <>
      <PreviewBar brand={brand} productName={productName} productHref={productHref}>
        <ScreenshotSteps index={index} count={images.length} onIndex={setIndex} />
      </PreviewBar>

      <div className="bg-surface-muted/40 flex min-h-0 flex-1 flex-col items-center gap-3 p-3 sm:p-4">
        <ScreenshotViewer images={images} index={index} productName={productName} />

        <p className="text-subtle text-center text-[11.5px]">
          There&rsquo;s no live demo for {productName} yet — these are its screenshots.
        </p>
      </div>
    </>
  );
}
