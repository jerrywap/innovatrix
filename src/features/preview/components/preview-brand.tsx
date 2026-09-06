/*
 * `no-html-link-for-pages` is disabled for this file, deliberately and with the
 * reasoning below. The rule says an internal link should be a `<Link>`, and this
 * is the one route in the app where that is the bug rather than the convention —
 * see the docblock. The disable is file-scoped because every anchor here exists
 * for that single reason.
 */
/* eslint-disable @next/next/no-html-link-for-pages */
import { BRAND } from "@/config/brand";
import { BrandMark } from "@/components/shell/brand-mark";

/**
 * The lockup for the preview bar, which has to fit a phone and has to leave by
 * loading a document.
 *
 * ## Two variants, one of them always hidden
 *
 * `Brand.compact` renders the mark alone, which is exactly what the bar needs
 * below `sm` — but it is a boolean, and this needs to change at a breakpoint. So
 * both are rendered and CSS picks one.
 *
 * **Not** a child-selector on a single lockup. `[&>span]:hidden` would hide the
 * wordmark visually *and* take it out of the accessibility tree, leaving the
 * phone with a link to the home page carrying no accessible name at all. Hence
 * the `aria-label` on the mark-only variant, which is what `Brand` does for the
 * same reason.
 *
 * ## Plain anchors, not `<Brand>`
 *
 * This is the one place that cannot use the shared component, and the reason is
 * the same one that made `purchase-panel.tsx` stop using `<Link>` to get *here*.
 *
 * `next.config.ts` gives `/preview/:slug*` a relaxed `frame-src https:` so a
 * vendor's demo can be framed. A CSP belongs to a **document**, so a client-side
 * transition out of this route carries that wide policy onto wherever it lands —
 * measured: clicking this logo left `/` running with an arbitrary `https` frame
 * permitted, `getEntriesByType("navigation")[0].name` still reading
 * `/preview/{slug}`. The relaxation is supposed to stop at this route's edge,
 * and only a document navigation makes it stop.
 *
 * So the preview shell is entered by an anchor, and left by one — the ✕ in
 * `PreviewBar` already argued this for itself ("a document navigation puts the
 * site's own chrome back with no doubt about it"), and this is the same claim
 * applied to the other control that leads out.
 *
 * `BrandMark` is still imported rather than redrawn — that is the part with the
 * traced geometry that must never drift. What is duplicated here is the two
 * classes that sit the wordmark next to it; keep them in step with `Brand`.
 */
export function PreviewBrand() {
  return (
    <>
      <a href="/" aria-label={BRAND.name} className="flex items-center sm:hidden">
        <BrandMark className="h-[26px] w-[26px] shrink-0" />
      </a>

      <a href="/" className="hidden items-center gap-2.5 sm:flex">
        <BrandMark className="h-[26px] w-[26px] shrink-0" />
        <span className="text-[15.5px] font-semibold tracking-[-0.03em]">{BRAND.name}</span>
      </a>
    </>
  );
}
