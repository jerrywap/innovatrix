"use client";

import { useState } from "react";
import { ExternalLink, Monitor, Smartphone, Tablet, X } from "lucide-react";

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
 */

export interface PreviewTarget {
  /** Stable across renders — used as the selected key. */
  id: string;
  label: string;
  url: string;
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

export function PreviewStage({
  targets,
  productName,
  productHref,
  brand,
}: {
  targets: readonly PreviewTarget[];
  productName: string;
  /** Back to the listing. A `string` because `Link` is not used — see below. */
  productHref: string;
  /** `<Brand />`, rendered on the server and passed through as a slot. */
  brand: React.ReactNode;
}) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");

  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0];
  const width = DEVICES.find((candidate) => candidate.id === device)?.width ?? null;

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
        */}
        {targets.length > 1 && (
          <SegmentedControl
            label="Demo view"
            options={targets.map(({ id, label }) => ({ id, label }))}
            selected={target.id}
            onSelect={setTargetId}
          />
        )}

        <SegmentedControl
          label="Preview width"
          options={DEVICES.map(({ id, label, icon }) => ({ id, label, icon }))}
          selected={device}
          onSelect={(next) => setDevice(next as DeviceId)}
          iconOnly
        />
      </PreviewBar>

      <div className="bg-surface-muted/40 flex min-h-0 flex-1 flex-col items-center gap-2 p-3 sm:p-4">
        <div
          className="border-border bg-surface min-h-0 w-full flex-1 overflow-hidden rounded-xl border shadow-sm"
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

        <p className="text-subtle text-center text-[11.5px]">
          Some demos don&rsquo;t allow being embedded. If the frame stays blank, open it in a
          new tab.
        </p>
      </div>
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
    <header className="border-border bg-surface flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 sm:px-4">
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
        <span aria-hidden className="text-border">
          /
        </span>
        <span className="truncate text-[13px] font-medium">{productName}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
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
}: {
  label: string;
  options: ReadonlyArray<{ id: string; label: string; icon?: React.ElementType }>;
  selected: string;
  onSelect: (id: string) => void;
  iconOnly?: boolean;
}) {
  return (
    <fieldset className="border-border flex items-center rounded-lg border p-0.5">
      <legend className="sr-only">{label}</legend>

      {options.map(({ id, label: optionLabel, icon: Icon }) => {
        const active = id === selected;

        return (
          <label
            key={id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition ${
              active
                ? "bg-surface-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
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
