"use client";

import { useState, useSyncExternalStore } from "react";
import { ExternalLink, Monitor, Smartphone, Tablet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExternalDemoCard } from "./external-demo-card";
import { ScreenshotSteps, ScreenshotViewer, type PreviewImage } from "./screenshot-viewer";

/**
 * The device switcher and the frame it sizes.
 *
 * ## One `useState`, and that is the whole client bundle for this page
 *
 * Everything else — the product, which targets this viewer may see, the branding
 * — is resolved on the server and arrives as props. What has to be interactive is
 * the width of a box and which URL is in it, so that is all this owns.
 *
 * ## The targets arrive already filtered
 *
 * `targets` contains only the URLs this viewer is entitled to. It is **not** all
 * three with a flag to hide two: `demo-panel.tsx` sets out why, and it applies
 * here word for word — React serialises everything a client component is given,
 * so a URL passed and not rendered has still been sent. The server decides; this
 * draws what it was handed.
 *
 * ## "Open in a new tab" is always visible
 *
 * Not a fallback revealed when embedding fails. A site can refuse to be framed
 * with its own `X-Frame-Options` or `frame-ancestors`, and that refusal is not
 * observable from script — the frame simply stays blank, `onLoad` may or may not
 * fire, and there is nothing to catch. A control that is always there, plus a
 * line of copy under the stage, is honest; a spinner that waits for an event
 * that never comes is not.
 *
 * ## `frameable` is decided on the server, and nothing here second-guesses it
 *
 * Ticket 31 added the only detection that can work: `services/marketplace/
 * frameability.ts` reads the two headers a browser would read, before this
 * component exists. A target arrives already judged.
 *
 * **There is deliberately no timer.** Not at eight seconds, not at thirty. A
 * client-side timeout cannot distinguish a refusal from a slow host — that is
 * the same unobservability the paragraph above describes — and the failure it
 * produces is the worst one available: a working demo replaced by a message
 * saying it does not work. The probe's `unknown` verdict renders the frame for
 * exactly this reason, and the permanent open-in-a-new-tab control is what
 * covers a load that never arrives.
 */

export interface PreviewTarget {
  /** Stable across renders — used as the selected key. */
  id: string;
  label: string;
  url: string;
  /**
   * Would a browser let us frame this? Decided by the server-side probe, where
   * `allowed` and `unknown` both arrive as `true` — see the docblock above on
   * why a failed probe must render the frame rather than the fallback.
   */
  frameable: boolean;
}

const DEVICES = [
  /*
   * Widths, not device names pretending to be devices. `null` means "fill the
   * stage", which is the honest desktop case: a fixed 1440 box inside a 1200
   * viewport would be a preview of a scrollbar.
   */
  { id: "desktop", label: "Desktop", icon: Monitor, width: null },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 834 },
  { id: "mobile", label: "Mobile", icon: Smartphone, width: 390 },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

/**
 * Which preview widths this screen can honestly offer.
 *
 * A 390px phone cannot show what a 1440px desktop looks like — narrowing a box
 * that is already narrower than the box is nothing at all — so the control
 * offers only widths at or below the viewport: everything on a desktop, tablet
 * and mobile on a tablet, and on a phone nothing, because the phone *is* the
 * mobile preview.
 *
 * Ordered widest-first, which is what makes `DEVICES_FOR[bucket][0]` the right
 * thing to fall back to when a selection stops being available.
 */
const DEVICES_FOR = {
  desktop: ["desktop", "tablet", "mobile"],
  tablet: ["tablet", "mobile"],
  mobile: [],
} as const satisfies Record<string, readonly DeviceId[]>;

type ViewportBucket = keyof typeof DEVICES_FOR;

/**
 * The viewport, as an external store rather than `useState` in an effect.
 *
 * Same shape as `useHydrated` in `components/theme-toggle.tsx`, and for the same
 * reason: React takes the **server** snapshot for the hydration pass and the
 * client one after, so there is no mismatch to warn about and no second render
 * cascading out of an effect.
 *
 * `getServerSnapshot` is `"desktop"` deliberately. The server cannot know the
 * viewport, and rendering the full control and narrowing it is the harmless
 * direction — the alternative, guessing "mobile", would flash an empty bar on
 * every desktop load.
 *
 * The breakpoints are Tailwind's `lg` and `sm` as numbers, because the same two
 * boundaries are expressed in classes elsewhere in this file and the JS and the
 * CSS have to agree about where the bar changes shape.
 */
const QUERIES = ["(min-width: 1024px)", "(min-width: 640px)"] as const;

function subscribeToViewport(onChange: () => void): () => void {
  const lists = QUERIES.map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function readViewport(): ViewportBucket {
  if (window.matchMedia(QUERIES[0]).matches) return "desktop";
  if (window.matchMedia(QUERIES[1]).matches) return "tablet";
  return "mobile";
}

function useViewportBucket(): ViewportBucket {
  return useSyncExternalStore(subscribeToViewport, readViewport, () => "desktop" as const);
}

export function PreviewStage({
  targets,
  images,
  productName,
  productHref,
  brand,
}: {
  targets: readonly PreviewTarget[];
  /**
   * The product's screenshots, for a target that cannot be framed.
   *
   * Ticket 31: a blocked demo degrades to the thing every product has rather
   * than to an empty card with a button in it. Safe to send unconditionally —
   * these are the same public image URLs the product page already renders, so
   * there is nothing here that `demo-panel.tsx`'s serialisation rule protects.
   */
  images: readonly PreviewImage[];
  productName: string;
  /** Back to the listing. A `string` because `Link` is not used — see below. */
  productHref: string;
  /** `<Brand />`, rendered on the server and passed through as a slot. */
  brand: React.ReactNode;
}) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [shot, setShot] = useState(0);

  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0];

  /*
   * The selection is **clamped, not corrected**. Shrinking the window past 1024px
   * takes "Desktop" out of `available` while `device` still holds it, and the
   * visible consequence of leaving that alone is a segmented control with no
   * segment selected. Falling back to `available[0]` — the widest that still
   * fits — puts the highlight where the frame actually is.
   *
   * Derived rather than pushed into state by an effect: the effect version
   * renders the wrong thing once, then corrects it, which is the flash this
   * whole hook exists to avoid. It also means widening the window back restores
   * the visitor's original choice, because `device` was never overwritten.
   */
  const bucket = useViewportBucket();
  // Widened from the `as const` tuples, which are otherwise narrow enough that
  // `includes` on the union resolves its parameter to `never`.
  const available: readonly DeviceId[] = DEVICES_FOR[bucket];
  // `undefined` on a phone, where the list is empty. That reaches `width` as
  // `null`, which is "fill the stage" — the right answer for a screen that is
  // already the mobile preview.
  const selected = available.includes(device) ? device : available[0];
  const width = DEVICES.find((candidate) => candidate.id === selected)?.width ?? null;

  if (!target) return null;

  return (
    <>
      <PreviewBar
        brand={brand}
        productName={productName}
        productHref={productHref}
        openUrl={target.url}
      >
        {/*
          Only where there is a choice. One tab is not a switcher, and drawing it
          would imply the other roles exist and are locked rather than that this
          viewer simply has one address.

          A blocked target keeps its tab. `embeddable()` drops a non-https target
          outright, and that is right for an address no viewer could ever reach —
          but an entitled viewer silently losing the Admin tab is worse than
          being shown a link to it, so this one is marked rather than removed.
        */}
        {targets.length > 1 && (
          <SegmentedControl
            label="Demo view"
            options={targets.map(({ id, label }) => ({ id, label }))}
            selected={target.id}
            onSelect={setTargetId}
          />
        )}

        {/*
          The width switcher resizes a frame. With no frame it is a control that
          appears to do something and does not — the same reasoning that keeps it
          off `ScreenshotStage` entirely. The screenshot steps take its place,
          which is also where that stage puts them.
        */}
        {target.frameable ? (
          /*
            `available.length > 1` on the same principle as the target tabs above:
            a control offering one option is not a switcher. On a phone that is
            zero options, which is what keeps this bar to a single row.
          */
          available.length > 1 && (
            <SegmentedControl
              label="Preview width"
              className="hidden sm:flex"
              options={DEVICES.filter(({ id }) => available.includes(id)).map(
                ({ id, label, icon }) => ({
                  id,
                  label,
                  icon,
                  // Matches `QUERIES[0]`. Only ever visible pre-hydration, when
                  // the bucket is assumed to be desktop.
                  ...(id === "desktop" ? { className: "hidden lg:flex" } : {}),
                }),
              )}
              selected={selected ?? "desktop"}
              onSelect={(next) => setDevice(next as DeviceId)}
              iconOnly
            />
          )
        ) : (
          <ScreenshotSteps index={shot} count={images.length} onIndex={setShot} />
        )}
      </PreviewBar>

      {target.frameable ? (
        <div className="bg-surface-muted/40 flex min-h-0 flex-1 flex-col items-center">
          {/*
            No padding, and the chrome is conditional.

            At full width the frame *is* the page below the bar: a border and a
            corner radius there only draw a box around something with nothing
            beside it, and the padding that used to surround it was muted
            background pretending to be a margin. Flush to both edges and to the
            bottom is what a preview of a website should be.

            A device width is the opposite case — the frame no longer reaches the
            edges, so `border-x` is what separates the simulated screen from the
            muted surface either side of it.
          */}
          <div
            className={cn(
              "bg-surface min-h-0 w-full flex-1 overflow-hidden",
              width && "border-border border-x shadow-sm",
            )}
            style={width ? { maxWidth: width } : undefined}
          >
            {/*
              `key` on the URL, not on the width. Changing the device must resize
              the frame, not reload the demo — a reload would throw away wherever
              the visitor had navigated to inside it, which is most of what a
              preview is for. Changing the *target* is a different page and should
              load fresh.
            */}
            <iframe
              key={target.url}
              src={target.url}
              title={`${productName} demo`}
              /*
                `allow-scripts` beside `allow-same-origin` is the pair to think
                twice about, because together they let a frame reach out of the
                sandbox — but only when the framed document is same-origin with us.
                This one never is: the page refuses any target that is not an
                absolute `https:` URL on another host, so `allow-same-origin` grants
                the demo its own origin and nothing of ours.
              */
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              // The demo host has no business knowing which product page sent them.
              referrerPolicy="no-referrer"
              className="size-full border-0"
            />
          </div>

          {/*
            There was a line of small print here about demos that stay blank. It
            cost a row of the stage on every visit to describe a case the probe
            now catches before the frame is rendered at all — and for the residue
            it cannot catch, ticket 31 §7 already settled that the permanent
            open-in-a-new-tab control is the honest answer and that adding
            anything beside it is not.
          */}
        </div>
      ) : (
        /*
          The frame is absent, not hidden and not zero-height. A demo the server
          has judged unframeable must not be requested at all — rendering it and
          covering it would still hit the vendor's server on every visit and
          still leave a blank rectangle behind the card on any browser that
          disagreed with the verdict.
        */
        <div className="bg-surface-muted/40 flex min-h-0 flex-1 flex-col items-center gap-3 p-3 sm:p-4">
          <ExternalDemoCard
            productName={productName}
            url={target.url}
            {...(target.id === "public" ? {} : { targetLabel: target.label })}
          />

          {images.length > 0 && (
            <ScreenshotViewer images={images} index={shot} productName={productName} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * The bar, shared by the live-demo stage and the screenshot one.
 *
 * Exported because the two stages have different middles and the same edges, and
 * a second copy of "logo left, controls right, close far right" is how the two
 * drift apart.
 */
export function PreviewBar({
  brand,
  productName,
  productHref,
  openUrl,
  children,
}: {
  brand: React.ReactNode;
  productName: string;
  productHref: string;
  /** Absent on the screenshot stage — there is nothing to open. */
  openUrl?: string;
  children?: React.ReactNode;
}) {
  return (
    /*
      One row, at every width.

      `flex-wrap` with a `gap-y` was how this bar handled a phone: the controls
      dropped to a second line, which cost a row of the stage and made the header
      taller than the thing it labels. Nothing wraps now — what does not fit on a
      phone is *removed* rather than rewrapped, and the two things removed are the
      wordmark (`PreviewBrand` swaps in the mark alone) and the product name.

      That is not information lost. The name is in the browser tab, in the ✕'s
      accessible name, and on the page the ✕ leads back to.
    */
    <header className="border-border bg-surface flex shrink-0 items-center gap-x-3 border-b px-2.5 py-2 sm:gap-x-4 sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        {/*
          `<Brand />`, passed in from the server rather than imported here.

          Its docblock is explicit that the logo goes to `/` on every surface, and
          that the `homeHref` prop was deleted because "a knob that can only hold
          one correct value is a knob that drifts back". So it keeps its default,
          and getting back to the product is the ✕ at the other end of the bar —
          which is the control that should carry that job anyway.
        */}
        {brand}
        <span aria-hidden className="text-border hidden sm:inline">
          /
        </span>
        <span className="hidden truncate text-[13px] font-medium sm:inline">{productName}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {children}

        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border hover:bg-surface-muted flex size-8 items-center justify-center rounded-lg border transition"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">Open the demo in a new tab</span>
          </a>
        )}

        {/*
          A plain anchor, not `next/link`. This is the way *out* of a full-screen
          mode, and a client-side transition would leave the preview's `h-dvh`
          shell in the router cache to be reused; a document navigation puts the
          site's own chrome back with no doubt about it.
        */}
        <a
          href={productHref}
          className="border-border hover:bg-surface-muted flex size-8 items-center justify-center rounded-lg border transition"
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close the preview and go back to {productName}</span>
        </a>
      </div>
    </header>
  );
}

/**
 * A radio group wearing a segmented control.
 *
 * Radios rather than buttons: these are one choice from a set, and a screen
 * reader should hear "Preview width, Tablet, 2 of 3" rather than three unrelated
 * buttons. The `fieldset`/`legend` is what supplies the group's name; the legend
 * is `sr-only` because the icons carry it visually.
 */
function SegmentedControl({
  label,
  options,
  selected,
  onSelect,
  iconOnly = false,
  className,
}: {
  label: string;
  options: ReadonlyArray<{
    id: string;
    label: string;
    icon?: React.ElementType;
    /** See `className` below — the same trick, one option at a time. */
    className?: string;
  }>;
  selected: string;
  onSelect: (id: string) => void;
  iconOnly?: boolean;
  /**
   * A **pre-hydration** guard, and nothing else.
   *
   * `useViewportBucket` cannot know the viewport on the server, so the first
   * paint is drawn as though every width were available and hydration then
   * narrows it. On a phone that is three device icons appearing and vanishing —
   * small, but on exactly the screen this control is not supposed to exist on.
   *
   * So the same two boundaries are stated a second time in CSS, where they cost
   * nothing and apply to the very first frame. The JS stays the source of truth
   * about which options exist and which is selected; this only stops the wrong
   * answer being visible for one paint. The two must agree — if the breakpoints
   * in `QUERIES` move, these move with them.
   */
  className?: string;
}) {
  return (
    <fieldset
      className={cn("border-border flex items-center rounded-lg border p-0.5", className)}
    >
      <legend className="sr-only">{label}</legend>

      {options.map(({ id, label: optionLabel, icon: Icon, className: optionClassName }) => {
        const active = id === selected;

        return (
          <label
            key={id}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition",
              active
                ? "bg-surface-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
              optionClassName,
            )}
          >
            <input
              type="radio"
              name={label}
              value={id}
              checked={active}
              onChange={() => onSelect(id)}
              className="sr-only"
            />
            {Icon && <Icon className="size-3.5" aria-hidden />}
            <span className={iconOnly ? "sr-only sm:not-sr-only" : ""}>{optionLabel}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
