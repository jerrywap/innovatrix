"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Maximize2,
  Minus,
  Play,
  Plus,
  X,
} from "lucide-react";
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
 * ## …but the hero is still clickable
 *
 * It was not, and that read as broken: the biggest image on the page, with a
 * lightbox one thumbnail away, ignoring every click. The fix keeps the LCP
 * property intact — `<HeroExpand>` is a transparent button *layered over* the
 * server-rendered `<Image>`, not a wrapper around it, so the markup that paints
 * is unchanged and only the button waits for hydration.
 *
 * That is why the state lives in `<ProductMedia>` rather than in `<Gallery>`:
 * two siblings — the hero overlay and the thumbnail strip — both open the same
 * lightbox, so the one thing they share is a provider around both.
 *
 * ## The names are load-bearing — do not rename `Gallery` or the page's `hero`
 *
 * `product-page.test.ts` locates the hero block with
 * `slice(indexOf("{hero &&"), indexOf("<Gallery"))`. Rename either and `indexOf`
 * returns `-1`, the slice silently becomes most of the file, and the assertion
 * **passes vacuously** — a weakened enforcement test showing a green tick, which
 * is worse than a red one because nobody goes looking.
 *
 * The provider is called `ProductMedia` for the same reason, and it is not a
 * free choice: that `indexOf("<Gallery")` is a **prefix match**, so a provider
 * named `<GalleryProvider>` would be found first, the slice would end before the
 * `<Image>`, and the hero assertion would fail against a page that is perfectly
 * correct.
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
 * ## Zoom, and what it can honestly promise
 *
 * There was none, deliberately, and the argument was sound as far as it went:
 * `deviceSizes` tops out at **1920** — confirmed against the running app, the
 * srcset really does stop there — so past the point where the served candidate
 * is exhausted, a zoom is magnifying an upscale.
 *
 * The conclusion drawn from it was too strong, though. Between `object-contain`
 * in a 70vh box and 1920px there is real, unshown detail: a 1280px-wide panel
 * showing a 1920px candidate is holding back a third of its pixels, and on a
 * dense screenshot — a dashboard, a table, a settings page, which is most of
 * what this catalogue sells — that is exactly the detail somebody is squinting
 * for. So `sizes` widens on the first zoom, which makes the browser fetch the
 * larger candidate it had skipped.
 *
 * Beyond that it interpolates, and that is left visible rather than prevented.
 * A cap tuned per image would mean the `+` button greying out at a different
 * point on every screenshot for reasons no one can see, which is a worse
 * experience than a soft pixel — and blur at 4× is a thing every person reading
 * this already understands.
 *
 * Zoom is offered for **screenshots only**. A `<video>` has its own controls and
 * an iframe cannot be transformed usefully.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

const clampZoom = (value: number) =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));

type GalleryItem = { kind: "screenshot" | "video"; url: string; alt: string };

interface MediaContextValue {
  images: ReadonlyArray<GalleryItem>;
  total: number;
  open: (index: number) => void;
}

const MediaContext = createContext<MediaContextValue | null>(null);

function useMedia(): MediaContextValue {
  const value = useContext(MediaContext);
  if (!value) {
    throw new Error("<Gallery> and <HeroExpand> must be rendered inside <ProductMedia>.");
  }
  return value;
}

/**
 * Owns the lightbox, and lends "open it" to everything inside.
 *
 * Renders its children untouched — the hero `<Image>` among them stays a Server
 * Component's output, passed through as `children` and never re-created here.
 */
export function ProductMedia({
  images,
  productName,
  children,
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
  images: ReadonlyArray<GalleryItem>;
  productName: string;
  children: React.ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  /*
   * Zoom and pan in **one** state value, not two.
   *
   * They are not independent: every change to the scale has to re-clamp the
   * offset against the new overhang, and the offset can only be clamped if the
   * scale it belongs to is known. Held apart, that needs one setter to read the
   * other's result — which is either a stale closure or a `setState` in an
   * effect, and the second is a render cascade the linter is right to refuse.
   * Together, a single functional updater has both and neither can be stale.
   */
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  /*
   * State rather than a ref, even though the ref beside it holds the same
   * gesture. The transition below is *rendered* from it, and a ref read during
   * render neither re-renders when it changes nor is allowed to be read there —
   * so the easing would have been whatever the previous commit happened to leave.
   * Two extra commits per drag, against the one per pointermove the pan already
   * costs.
   */
  const [dragging, setDragging] = useState(false);

  /*
   * Pointer coordinates, for a swipe or a pan. A ref, not state: nothing renders
   * from them, and re-rendering on every `pointermove` would be a wasted commit
   * on top of the one the pan itself causes.
   */
  const from = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  const total = images.length;

  const resetZoom = useCallback(() => setView({ zoom: MIN_ZOOM, x: 0, y: 0 }), []);

  /*
   * Wrap-around, both directions.
   *
   * At the last image "next" going nowhere reads as a broken button — there is
   * no affordance saying you have reached the end — whereas returning to the
   * first is a normal thing for a carousel to do, and the counter says where you
   * are the whole time.
   *
   * Zoom resets with the image. Carrying a 3× magnification and a pan offset onto
   * the next screenshot lands the viewer on an arbitrary corner of a picture they
   * have not seen whole yet.
   */
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => (current === null ? null : (current + delta + total) % total));
      resetZoom();
    },
    [total, resetZoom],
  );

  const openAt = useCallback(
    (index: number) => {
      setOpenIndex(index);
      resetZoom();
    },
    [resetZoom],
  );

  /**
   * Keep the image's edges outside the frame.
   *
   * Without clamping, a drag can fling a 4×-scaled screenshot far enough that the
   * panel shows nothing but background and there is no cue about which way to go
   * back. The reachable offset is exactly the overhang: half the extra width the
   * scale created, in each direction.
   */
  const clampPan = useCallback((next: { x: number; y: number }, scale: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return next;
    const maxX = (box.width * (scale - 1)) / 2;
    const maxY = (box.height * (scale - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  /*
   * Both of these take the *previous* value rather than reading the current zoom
   * from the render closure, and that is not style. Holding `+` down, or
   * pressing it twice inside one frame, computes every step from the same stale
   * value and the level advances once — measured, not theorised, while testing
   * the keyboard bindings.
   *
   * The offset is re-clamped rather than reset, so zooming out from a panned
   * corner walks the image back toward centre as the overhang shrinks instead of
   * snapping it there.
   */
  const zoomTo = useCallback(
    (next: (current: number) => number) =>
      setView((current) => {
        const zoom = clampZoom(next(current.zoom));
        if (zoom === MIN_ZOOM) return { zoom, x: 0, y: 0 };
        return { zoom, ...clampPan({ x: current.x, y: current.y }, zoom) };
      }),
    [clampPan],
  );

  const value = useMemo<MediaContextValue>(
    () => ({ images, total, open: openAt }),
    [images, total, openAt],
  );

  const open = openIndex !== null ? images[openIndex] : undefined;
  const canZoom = open?.kind === "screenshot";
  const zoomed = canZoom && view.zoom > MIN_ZOOM;

  // Nothing to show, and nothing to say about it: a "Screenshots" heading over
  // an empty strip reads as a broken page. The children still render — the hero
  // is the page's business, not this component's.
  if (total === 0) return <>{children}</>;

  return (
    <MediaContext.Provider value={value}>
      {children}

      <Dialog
        open={openIndex !== null}
        onOpenChange={(next) => {
          if (!next) {
            setOpenIndex(null);
            resetZoom();
          }
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
              Arrow keys, Home/End, and the zoom set. On the content rather than
              the window, so they only apply while the lightbox has focus — which,
              given the trap, is exactly whenever it is open. Escape is Radix's.

              `+`/`-`/`0` are the bindings every image viewer and browser already
              uses, so they need no discovering. `=` because `+` is shifted on most
              layouts and people press the unshifted key.
            */
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") step(1);
              else if (event.key === "ArrowLeft") step(-1);
              else if (event.key === "Home") openAt(0);
              else if (event.key === "End") openAt(total - 1);
              else if (canZoom && (event.key === "+" || event.key === "=")) {
                zoomTo((z) => z + ZOOM_STEP);
              } else if (canZoom && (event.key === "-" || event.key === "_")) {
                zoomTo((z) => z - ZOOM_STEP);
              } else if (canZoom && event.key === "0") resetZoom();
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

              <div className="flex items-center gap-1.5">
                {canZoom && (
                  <ZoomControls
                    zoom={view.zoom}
                    onZoomBy={(d) => zoomTo((z) => z + d)}
                    onReset={resetZoom}
                  />
                )}
                <DialogClose className="border-border bg-background hover:bg-surface-muted focus-visible:ring-ring rounded-full border p-2 focus-visible:ring-2 focus-visible:outline-none">
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">Close the screenshot</span>
                </DialogClose>
              </div>
            </div>

            <div
              ref={frame}
              className={cn(
                "relative h-[70vh] w-full overflow-hidden",
                // `touch-pan-y` lets the page keep vertical scrolling while a
                // horizontal drag is ours; once zoomed, both axes are ours.
                zoomed ? "touch-none" : "touch-pan-y",
                zoomed && "cursor-grab active:cursor-grabbing",
              )}
              /*
                One pointer handler, two jobs, decided by whether we are zoomed.
                A swipe while magnified would be unusable — the gesture people
                expect there is panning, and stepping to the next screenshot
                mid-inspection is the opposite of what they meant.

                Pointer events rather than touch events: a mouse drag comes down
                the same path and needs no separate branch.
              */
              onPointerDown={(event) => {
                from.current = {
                  x: event.clientX,
                  y: event.clientY,
                  panX: view.x,
                  panY: view.y,
                };
                if (zoomed) {
                  setDragging(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }
              }}
              onPointerMove={(event) => {
                const start = from.current;
                if (!start || !zoomed) return;
                setView((current) => ({
                  ...current,
                  ...clampPan(
                    {
                      x: start.panX + (event.clientX - start.x),
                      y: start.panY + (event.clientY - start.y),
                    },
                    current.zoom,
                  ),
                }));
              }}
              onPointerUp={(event) => {
                const start = from.current;
                from.current = null;
                setDragging(false);
                if (!start || zoomed) return;
                /*
                  40px so a tap with a shaky thumb is not a navigation, and
                  `|dx| > |dy|` so scrolling the page vertically past the image
                  does not change it.
                */
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
              }}
              onPointerCancel={() => {
                from.current = null;
                setDragging(false);
              }}
              // The gesture everyone tries first. 1× ⇄ 2×, so it is a toggle
              // rather than a ratchet that needs the keyboard to undo.
              onDoubleClick={() => {
                if (canZoom) zoomTo((z) => (z > MIN_ZOOM ? MIN_ZOOM : 2));
              }}
            >
              <div
                className="absolute inset-0 origin-center"
                style={
                  canZoom
                    ? {
                        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
                        // No easing while dragging, or the image lags the finger.
                        transition: dragging ? "none" : "transform 150ms ease-out",
                      }
                    : undefined
                }
              >
                <Viewer item={open} zoomed={zoomed} />
              </div>
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
                        onClick={() => openAt(index)}
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
    </MediaContext.Provider>
  );
}

/**
 * The transparent layer that makes the hero open the lightbox.
 *
 * Absolutely positioned over the server-rendered `<Image>` rather than wrapping
 * it, which is what keeps the LCP element out of this island: the picture is in
 * the initial HTML either way, and only this button waits for hydration.
 *
 * The badge is `opacity-0` until hover or keyboard focus. A permanent icon over
 * the hero would be chrome on the one image the page is selling.
 */
export function HeroExpand() {
  const { open, total } = useMedia();

  return (
    <button
      type="button"
      onClick={() => open(0)}
      className="group focus-visible:ring-ring absolute inset-0 z-10 cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <span
        aria-hidden
        className="border-border bg-background/90 absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <Maximize2 className="size-3.5" />
        View full size
      </span>
      <span className="sr-only">View full size{total > 1 ? ` — ${total} images` : ""}</span>
    </button>
  );
}

/**
 * The thumbnail strip under the hero.
 *
 * Keeps its name: `product-page.test.ts` finds the end of the hero block with
 * `indexOf("<Gallery")`.
 */
export function Gallery() {
  const { images, total, open } = useMedia();

  if (total === 0) return null;

  /*
    A single screenshot used to render **nothing at all** — `images.length <= 1`
    returned null — so every product with one image had no way to see it any
    larger than the hero. That is most of the seeded catalogue and plenty of
    real listings. One image gets the control without the strip.

    Kept even though the hero itself now opens the lightbox: the hero's own
    affordance only appears on hover, which a touch device never does.
  */
  if (total === 1) {
    return (
      <button
        type="button"
        onClick={() => open(0)}
        className="border-border hover:bg-surface-muted focus-visible:ring-ring text-muted-foreground self-start rounded-lg border px-2.5 py-1.5 text-[12.5px] focus-visible:ring-2 focus-visible:outline-none"
      >
        <Expand className="mr-1.5 inline size-3.5" aria-hidden />
        View full size
      </button>
    );
  }

  return (
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
            onClick={() => open(index)}
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
  );
}

/**
 * Minus / level / plus, and a reset that only exists once there is something to
 * reset.
 *
 * The percentage is a `role="status"` for the same reason the counter is: the
 * keyboard bindings change it without moving focus, and a control whose value
 * only exists visually is one a screen-reader user cannot operate.
 */
function ZoomControls({
  zoom,
  onZoomBy,
  onReset,
}: {
  zoom: number;
  onZoomBy: (delta: number) => void;
  onReset: () => void;
}) {
  const button =
    "border-border bg-background hover:bg-surface-muted focus-visible:ring-ring rounded-full border p-2 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-[var(--background)]";

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={button}
        onClick={() => onZoomBy(-ZOOM_STEP)}
        disabled={zoom <= MIN_ZOOM}
      >
        <Minus className="size-4" aria-hidden />
        <span className="sr-only">Zoom out</span>
      </button>

      <p role="status" className="text-muted-foreground w-12 text-center font-mono text-[12px]">
        {Math.round(zoom * 100)}%
      </p>

      <button
        type="button"
        className={button}
        onClick={() => onZoomBy(ZOOM_STEP)}
        disabled={zoom >= MAX_ZOOM}
      >
        <Plus className="size-4" aria-hidden />
        <span className="sr-only">Zoom in</span>
      </button>

      {zoom > MIN_ZOOM && (
        <button
          type="button"
          className="border-border bg-background hover:bg-surface-muted focus-visible:ring-ring rounded-full border px-2.5 py-1.5 font-mono text-[11px] focus-visible:ring-2 focus-visible:outline-none"
          onClick={onReset}
        >
          Reset
          <span className="sr-only"> zoom to fit</span>
        </button>
      )}
    </div>
  );
}

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
function Viewer({ item, zoomed }: { item: GalleryItem; zoomed: boolean }) {
  const youTube = youTubeIdOf(item);

  if (item.kind === "screenshot") {
    return (
      <Image
        src={item.url}
        alt={item.alt}
        fill
        /*
          Widened on zoom, which is what makes the control resolve detail rather
          than magnify what is already on screen: `deviceSizes` runs to 1920, and
          a 1280px panel would otherwise never ask for the larger candidate. The
          fetch happens on the first `+` rather than on open, so a viewer who
          never zooms pays nothing for the option.
        */
        sizes={zoomed ? "1920px" : "(min-width: 1280px) 1280px, 100vw"}
        className="object-contain"
        // Dragging the image itself would start a native image drag and fight
        // the pan.
        draggable={false}
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
