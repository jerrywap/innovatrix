"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { PreviewBar } from "./preview-stage";

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
 */
export function ScreenshotStage({
  images,
  productName,
  productHref,
  brand,
}: {
  images: ReadonlyArray<{ url: string; alt: string }>;
  productName: string;
  productHref: string;
  brand: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const current = images[index];

  return (
    <>
      <PreviewBar brand={brand} productName={productName} productHref={productHref}>
        {images.length > 1 && (
          <div className="flex items-center gap-1">
            <Step
              direction="previous"
              onClick={() => setIndex((at) => (at - 1 + images.length) % images.length)}
            />
            {/*
              `aria-live` on the counter rather than on the image: the picture
              changing is the event, and announcing its alt text on every press
              would read the whole description aloud for what is a position
              change.
            */}
            <span
              aria-live="polite"
              className="text-muted-foreground min-w-[3.5rem] text-center font-mono text-[11.5px] tabular-nums"
            >
              {index + 1} / {images.length}
            </span>
            <Step direction="next" onClick={() => setIndex((at) => (at + 1) % images.length)} />
          </div>
        )}
      </PreviewBar>

      <div className="bg-surface-muted/40 flex min-h-0 flex-1 flex-col items-center gap-3 p-3 sm:p-4">
        <div className="border-border bg-surface relative min-h-0 w-full max-w-[1180px] flex-1 overflow-hidden rounded-xl border shadow-sm">
          {current ? (
            <Image
              src={current.url}
              alt={current.alt}
              fill
              sizes="(min-width: 1180px) 1180px, 100vw"
              // `contain`: a screenshot cropped to fill is a screenshot with its
              // edges cut off, and the edges are where the chrome of the thing
              // being demonstrated lives.
              className="object-contain"
              priority={index === 0}
            />
          ) : (
            <div className="text-subtle flex size-full flex-col items-center justify-center gap-2">
              <ImageOff className="size-5" aria-hidden />
              <span className="text-[13px]">Nothing to show yet.</span>
            </div>
          )}
        </div>

        <p className="text-subtle text-center text-[11.5px]">
          There&rsquo;s no live demo for {productName} yet — these are its screenshots.
        </p>
      </div>
    </>
  );
}

function Step({ direction, onClick }: { direction: "previous" | "next"; onClick: () => void }) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border hover:bg-surface-muted flex size-8 items-center justify-center rounded-lg border transition"
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">
        {direction === "previous" ? "Previous" : "Next"} screenshot
      </span>
    </button>
  );
}
