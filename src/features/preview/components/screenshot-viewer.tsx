"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

export interface PreviewImage {
  url: string;
  alt: string;
}

/**
 * A product's screenshots, and the controls for walking them — ticket 31.
 *
 * Extracted from `ScreenshotStage` when a second stage needed the same thing:
 * a demo whose host refuses to be framed falls back to screenshots rather than
 * to an empty card, so the carousel now has two callers and one implementation.
 *
 * ## Controlled, so the bar can own the buttons
 *
 * The index lives in the parent. That is not ceremony — in both stages the
 * prev/next cluster sits in `PreviewBar`, several elements away from the image
 * it advances, and the two cannot share a `useState` unless something above them
 * holds it. Splitting the pair this way is what let `ScreenshotStage` keep its
 * layout to the pixel while the blocked branch of `PreviewStage` reuses both
 * halves.
 */
export function ScreenshotViewer({
  images,
  index,
  productName,
}: {
  images: readonly PreviewImage[];
  index: number;
  /** Only for the empty state's copy. */
  productName: string;
}) {
  const current = images[index];

  return (
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
          <span className="text-[13px]">No screenshots of {productName} yet.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Prev, a position counter, next. Rendered inside `PreviewBar` by both stages.
 *
 * Returns nothing for a single image, on the same principle as the target tabs:
 * one of something is not a switcher, and drawing the control implies there is
 * somewhere else to go.
 */
export function ScreenshotSteps({
  index,
  count,
  onIndex,
}: {
  index: number;
  count: number;
  onIndex: (next: number) => void;
}) {
  if (count <= 1) return null;

  return (
    <div className="flex items-center gap-1">
      <Step direction="previous" onClick={() => onIndex((index - 1 + count) % count)} />
      {/*
        `aria-live` on the counter rather than on the image: the picture changing
        is the event, and announcing its alt text on every press would read the
        whole description aloud for what is a position change.
      */}
      <span
        aria-live="polite"
        className="text-muted-foreground min-w-[3.5rem] text-center font-mono text-[11.5px] tabular-nums"
      >
        {index + 1} / {count}
      </span>
      <Step direction="next" onClick={() => onIndex((index + 1) % count)} />
    </div>
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
