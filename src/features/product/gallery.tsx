"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, Play, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { youTubeId } from "@/validators/common";

/**
 * Screenshots, with a lightbox — §8.
 *
 * ## The first image is *not* rendered here
 *
 * It is a plain `next/image` in the Server Component above, with `priority`.
 * That matters for one measurable reason: the hero image is the LCP element,
 * and an LCP that waits for this bundle to download, parse and hydrate is an
 * LCP that misses the 2.5s target on a throttled connection for no benefit —
 * nobody clicks a lightbox before the page has painted.
 *
 * So this island owns the thumbnails and the overlay only, and hydrates late.
 *
 * ## The name is load-bearing — do not rename `Gallery` or the page's `hero`
 *
 * `product-page.test.ts` locates the hero block with
 * `slice(indexOf("{hero &&"), indexOf("<Gallery"))`. Rename either and `indexOf`
 * returns `-1`, the slice silently becomes most of the file, and the assertion
 * **passes vacuously** — a weakened enforcement test showing a green tick, which
 * is worse than a red one because nobody goes looking.
 *
 * ## Built on the Dialog primitive, not a hand-rolled overlay
 *
 * The previous version was a `<div role="dialog">` with `ref={(node) =>
 * node?.focus()}` and an `onKeyDown` for Escape. That gets four things wrong that
 * Radix gets right for free: focus is **trapped** (Tab could previously walk out
 * of the overlay into the page behind it), focus is **restored** to the thumbnail
 * that opened it, the background stops **scrolling**, and Escape works no matter
 * what is focused rather than only while the container itself is.
 *
 * ## Video, in the same strip
 *
 * `PRODUCT_MEDIA_KINDS` has had `"video"` since it was written and nothing in the
 * UI could produce one, so this component had no `kind` at all and put everything
 * through `next/image`. It now branches at the leaves — `Thumbnail` and `Viewer` —
 * and nowhere else: a video is one more item in the strip, with the same counter,
 * arrows and swipe.
 *
 * `screenshots()` is deliberately unchanged. The hero and the OG image must stay
 * a still — an `<img>` is the only thing either can be.
 *
 * ## No pixel zoom, deliberately
 *
 * `deviceSizes` caps at 1920 and there is one URL per image, so past roughly 1.5×
 * a zoom is magnifying an upscale. A zoom control that resolves no new detail
 * advertises detail the bytes do not contain, which is worse than not offering
 * one. `object-contain` in a 70vh box is the real resolution, shown whole — the
 * height leaves room for the counter above and the thumbnail strip below without
 * either of them needing the page to scroll.
 */
export function Gallery({
  images,
  productName,
}: {
  /**
   * Screenshots and videos, in `sortOrder`.
   *
   * `kind` decides how an item renders and nothing else — the counter, the strip,
   * the arrows and the swipe all treat a video as one more item. A `video` with a
   * `storageKey` is one of ours and plays in a `<video>`; one without is a YouTube
   * link and plays in an iframe. That is the same distinction the model's own
   * comment draws, so nothing new has to be stored.
   */
  images: ReadonlyArray<{ kind: "screenshot" | "video"; url: string; alt: string }>;
  productName: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  /*
   * Pointer coordinates for a swipe. A ref, not state: nothing renders from
   * them, and re-rendering on every `pointerdown` would be a wasted commit.
   */
  const from = useRef<{ x: number; y: number } | null>(null);

  const total = images.length;

  /*
   * Wrap-around, both directions.
   *
   * At the last image "next" going nowhere reads as a broken button — there is
   * no affordance saying you have reached the end — whereas returning to the
   * first is a normal thing for a carousel to do, and the counter says where you
   * are the whole time.
   */
  const step = useCallback(
    (delta: number) =>
      setOpenIndex((current) => (current === null ? null : (current + delta + total) % total)),
    [total],
  );

  // Nothing to show, and nothing to say about it: a "Screenshots" heading over
  // an empty strip reads as a broken page.
  if (total === 0) return null;

  const open = openIndex !== null ? images[openIndex] : undefined;

  return (
    <>
      {/*
        A single screenshot used to render **nothing at all** — `images.length <= 1`
        returned null — so every product with one image had no way to see it any
        larger than the hero. That is most of the seeded catalogue and plenty of
        real listings. One image gets the control without the strip.
      */}
      {total === 1 ? (
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="border-border hover:bg-surface-muted focus-visible:ring-ring text-muted-foreground self-start rounded-lg border px-2.5 py-1.5 text-[12.5px] focus-visible:ring-2 focus-visible:outline-none"
        >
          <Expand className="mr-1.5 inline size-3.5" aria-hidden />
          View full size
        </button>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {/*
            Index 0 stays in the strip even though it is also the hero above.
            `openIndex` indexes `images`, so dropping it would make the first
            thumbnail open the *second* image and the counter read "2 / 7".
          */}
          {images.map((image, index) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                className="border-border focus-visible:ring-ring relative block aspect-[4/3] w-full overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
              >
                <Thumbnail item={image} sizes="120px" />
                <span className="sr-only">
                  Open {image.kind === "video" ? "video" : "screenshot"} {index + 1} of {total}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={openIndex !== null}
        onOpenChange={(next) => {
          if (!next) setOpenIndex(null);
        }}
      >
        {open && openIndex !== null && (
          <DialogContent
            showCloseButton={false}
            /*
              `DialogContent` is a modal card — `sm:max-w-sm`, `p-4`, a popover
              background and a ring. All four are overridden rather than forked,
              so this keeps inheriting the focus trap, the scroll lock and the
              animations. `tailwind-merge` inside `cn` is what makes the later
              class win.
            */
            /*
              `w-[min(100%,1280px)]`, not `100vw`: the content is `position: fixed`,
              so `100%` resolves against the viewport *excluding* the scrollbar
              gutter, and `100vw` would include it and overflow horizontally.

              `max-h`/`overflow-y-auto` because `ui/dialog.tsx` sets neither, and
              the panel is 70vh of image plus a counter plus a thumbnail strip — on
              a short window the strip would centre its way off the bottom edge
              with no way to reach it.
            */
            className="max-h-[95vh] w-[min(100%,1280px)] max-w-none gap-3 overflow-y-auto rounded-none bg-transparent p-4 ring-0 sm:max-w-none"
            /*
              Arrow keys and Home/End. On the content rather than the window, so
              they only apply while the lightbox has focus — which, given the
              trap, is exactly whenever it is open. Escape is Radix's.
            */
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") step(1);
              else if (event.key === "ArrowLeft") step(-1);
              else if (event.key === "Home") setOpenIndex(0);
              else if (event.key === "End") setOpenIndex(total - 1);
              else return;
              event.preventDefault();
            }}
          >
            {/*
              Radix warns without a title, and a screen reader needs to hear what
              just opened. Visually hidden because the image is the content and a
              heading above it would be furniture.
            */}
            <DialogTitle className="sr-only">
              {productName} — screenshot {openIndex + 1} of {total}
            </DialogTitle>

            <div className="flex items-center justify-between gap-2">
              {/* A live region, so stepping with the arrow keys is announced. */}
              <p role="status" className="text-muted-foreground font-mono text-[12px]">
                {openIndex + 1} / {total}
              </p>
              <DialogClose className="border-border bg-background hover:bg-surface-muted focus-visible:ring-ring rounded-full border p-2 focus-visible:ring-2 focus-visible:outline-none">
                <X className="size-4" aria-hidden />
                <span className="sr-only">Close the screenshot</span>
              </DialogClose>
            </div>

            <div
              className="relative h-[70vh] w-full touch-pan-y"
              /*
                Swipe, via pointer events rather than touch events — which covers
                a mouse drag with the same handler and needs no separate path.
                40px so a tap with a shaky thumb is not a navigation, and
                `|dx| > |dy|` so scrolling the page vertically past the image does
                not change it.
              */
              onPointerDown={(event) => {
                from.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                const start = from.current;
                from.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
              }}
            >
              <Viewer item={open} />
            </div>

            {total > 1 && (
              <>
                <Arrow side="left" onClick={() => step(-1)} />
                <Arrow side="right" onClick={() => step(1)} />

                {/* Switching without leaving the lightbox — the strip below the page
                    is gone once the overlay is up, so it has to be here too. */}
                <ul className="flex justify-center gap-1.5 overflow-x-auto">
                  {images.map((image, index) => (
                    <li key={image.url}>
                      <button
                        type="button"
                        onClick={() => setOpenIndex(index)}
                        aria-current={index === openIndex ? "true" : undefined}
                        className={cn(
                          "focus-visible:ring-ring relative block aspect-[4/3] w-14 shrink-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none",
                          index === openIndex
                            ? "border-[var(--signal)]"
                            : "border-border opacity-60 hover:opacity-100",
                        )}
                      >
                        <Thumbnail item={image} sizes="56px" />
                        <span className="sr-only">
                          {image.kind === "video" ? "Video" : "Screenshot"} {index + 1}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

type GalleryItem = { kind: "screenshot" | "video"; url: string; alt: string };

/**
 * Is this one of our objects, or a YouTube link?
 *
 * Derived from the URL rather than stored, because the model already draws the
 * distinction that way — `storageKey` for an upload, `url` for an external video —
 * and the public DTO only carries the URL. `youTubeId` refuses anything that is
 * not a YouTube address, so a `null` here means "our file".
 */
function youTubeIdOf(item: GalleryItem): string | null {
  return item.kind === "video" ? youTubeId(item.url) : null;
}

/**
 * A still for the strip, whatever the item is.
 *
 * A YouTube item uses YouTube's own poster frame — `hqdefault`, not
 * `maxresdefault`, which 404s for anything never uploaded above 720p. An uploaded
 * video has no poster, so the `<video>` element supplies its own first frame:
 * `preload="metadata"` fetches enough for that and no more.
 */
function Thumbnail({ item, sizes }: { item: GalleryItem; sizes: string }) {
  const youTube = youTubeIdOf(item);

  if (item.kind === "screenshot") {
    return <Image src={item.url} alt={item.alt} fill sizes={sizes} className="object-cover" />;
  }

  return (
    <>
      {youTube ? (
        <Image
          src={`https://i.ytimg.com/vi/${youTube}/hqdefault.jpg`}
          alt={item.alt}
          fill
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <video
          src={item.url}
          muted
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* The play badge is what distinguishes a video from a screenshot at
          thumbnail size, where a first frame looks exactly like a still. */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center bg-black/25"
      >
        <Play className="size-4 fill-white text-white" />
      </span>
    </>
  );
}

/**
 * The item, full size, inside the lightbox.
 *
 * The iframe is only built for an id `youTubeId` has already accepted, so its
 * `src` cannot be an arbitrary origin — which matters, because `frame-src` allows
 * exactly one host and a mismatch would be a silently blank panel.
 *
 * `youtube-nocookie.com` sets no tracking cookie until the visitor presses play,
 * and it is the host the CSP names. `controls` on our own `<video>` rather than
 * autoplay: a demo that starts talking on open is the thing people close.
 */
function Viewer({ item }: { item: GalleryItem }) {
  const youTube = youTubeIdOf(item);

  if (item.kind === "screenshot") {
    return (
      <Image
        src={item.url}
        alt={item.alt}
        fill
        sizes="(min-width: 1280px) 1280px, 100vw"
        className="object-contain"
      />
    );
  }

  if (youTube) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${youTube}?rel=0`}
        title={item.alt || "Product video"}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="absolute inset-0 size-full border-0"
      />
    );
  }

  return (
    <video
      src={item.url}
      controls
      preload="metadata"
      className="absolute inset-0 size-full object-contain"
    >
      {item.alt}
    </video>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-border bg-background/90 hover:bg-surface-muted focus-visible:ring-ring absolute top-1/2 -translate-y-1/2 rounded-full border p-2.5 focus-visible:ring-2 focus-visible:outline-none",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{side === "left" ? "Previous" : "Next"} screenshot</span>
    </button>
  );
}
