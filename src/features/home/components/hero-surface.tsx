import { Check } from "lucide-react";
import { HERO_WINDOWS } from "../data";

/**
 * The hero illustration — layered product surfaces, **drawn rather than
 * photographed**.
 *
 * ## Why there is no photograph in here
 *
 * The brief rules out generic stock imagery — people at laptops, phones in hands,
 * offices — and asks for the product itself: browser windows, dashboard previews,
 * storefronts, template thumbnails. A stock photo of a device is the thing it bans
 * wearing the costume of the thing it wants, and the first attempt at this
 * component proved it: three Unsplash tiles and a phone-in-a-hand shot, which said
 * nothing about software.
 *
 * So the surfaces are composed from the design tokens: browser chrome, a list of
 * catalogue rows, and a wireframe of a template's front page. It reads as a
 * product preview because it *is* a product interface, drawn in the same system as
 * the real one — and it cannot go stale, cannot 404, and costs no image bytes on
 * the LCP path.
 *
 * ## What it deliberately does not claim
 *
 * Kinds of software, not names of ours, and no prices. These rows were once four
 * real seeded products with hardcoded prices, which made the homepage a stale
 * mirror of live data — a price here disagreeing with the product page is a
 * screenshot in a complaint. Named, priced, linkable inventory is three bands
 * below, straight from the catalogue. One `Free` badge and two `Paid` because both
 * exist; showing only one would misrepresent the shelf.
 *
 * ## Smaller, not busier, on a phone
 *
 * The failure mode for a layered composition is "a pile of tiny unreadable
 * screenshots". The floating pill is hidden below `sm` and the overlap tightens,
 * so three legible surfaces survive instead of five illegible ones.
 */
/** What happens after a purchase, in order. Drawn as a cascade below. */
const STEPS = ["Download", "Setup", "Go live"] as const;

export function HeroSurface() {
  return (
    <div
      className="relative mx-auto w-full max-w-[520px] lg:max-w-none"
      // Decorative in full: every word in here appears as real text or a real
      // link elsewhere on the page, so announcing it again would only make the
      // hero longer to listen to.
      aria-hidden
    >
      {/* the catalogue */}
      <div className="shadow-lift border-border bg-surface rounded-[26px] border p-4 sm:p-5">
        <div className="flex items-center justify-between px-1 pb-3.5">
          <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            Marketplace
          </span>
          <span className="text-subtle font-mono text-[10px]">Search &amp; filter</span>
        </div>

        <div className="space-y-2">
          {HERO_WINDOWS.map((item) => (
            <div
              key={item.title}
              className="border-border bg-background/60 flex items-center gap-3.5 rounded-2xl border p-2.5"
            >
              <Thumb kind={item.thumb} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{item.title}</div>
                <div className="text-subtle font-mono text-[10.5px]">{item.kind}</div>
              </div>
              {item.free ? (
                <span className="bg-signal-soft text-signal-text rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-[0.12em] uppercase">
                  Free
                </span>
              ) : (
                <span className="text-subtle font-mono text-[10.5px]">Paid</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* the template, in a browser */}
      <div className="shadow-float border-border bg-surface relative z-10 mt-[-14px] ml-auto w-[92%] overflow-hidden rounded-[26px] border sm:mt-[-18px] lg:w-[88%]">
        <div className="border-border flex items-center gap-1.5 border-b px-4 py-3">
          <span className="bg-border-strong size-2 rounded-full" />
          <span className="bg-border-strong size-2 rounded-full" />
          <span className="bg-border-strong size-2 rounded-full" />
          <span className="bg-background text-subtle ml-2 flex-1 truncate rounded-md px-2 py-1 font-mono text-[9.5px]">
            website-template.preview
          </span>
        </div>

        {/* a front page, wireframed */}
        <div className="bg-background/40 flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="bg-foreground/80 h-2.5 w-16 rounded-full" />
            <span className="flex gap-1.5">
              <span className="bg-border-strong h-2 w-8 rounded-full" />
              <span className="bg-border-strong h-2 w-8 rounded-full" />
              <span className="bg-signal h-2 w-10 rounded-full" />
            </span>
          </div>

          <div className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-3.5">
            <span className="bg-foreground/70 h-3 w-2/3 rounded-full" />
            <span className="bg-border-strong h-2 w-full rounded-full" />
            <span className="bg-border-strong h-2 w-4/5 rounded-full" />
            <span className="bg-signal mt-1 h-5 w-24 rounded-full" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((tile) => (
              <div
                key={tile}
                className="border-border bg-surface flex flex-col gap-1.5 rounded-lg border p-2"
              >
                <span className="bg-surface-muted aspect-[4/3] w-full rounded-md" />
                <span className="bg-border-strong h-1.5 w-3/4 rounded-full" />
                <span className="bg-border-strong h-1.5 w-1/2 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/*
        The outcome — three steps, cascading.

        One pill said "Licence issued", which is the moment of purchase and the
        least interesting thing that happens here. Three say what the customer
        actually gets, in order, and the staircase is the point: each step is
        indented from the one above so the group reads as a sequence rather than a
        list of features. It mirrors the headline's three lines.

        Hidden below `sm`, like the single pill was. At phone width the stack would
        cover the template preview it is supposed to be floating in front of, and
        the same three words are the Services band further down the page.
      */}
      <div className="absolute -bottom-9 -left-3 z-20 hidden flex-col gap-2 sm:flex lg:-left-6">
        {STEPS.map((step, index) => (
          <span
            key={step}
            className="shadow-lift border-border bg-surface flex w-fit items-center gap-2.5 rounded-full border px-3.5 py-2.5"
            // Indented by step, not by a class per row: the offset *is* the
            // index, and hard-coding three margins invites the fourth to be wrong.
            style={{ marginLeft: `${index * 28}px` }}
          >
            <span className="bg-signal-soft grid size-6 shrink-0 place-items-center rounded-full">
              <Check className="text-signal-text size-3" strokeWidth={3} />
            </span>
            <span className="text-[12px] font-medium whitespace-nowrap">{step}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A catalogue row's thumbnail, as a miniature of what that kind of software
 * looks like — a chart, a grid of products, a week of shifts.
 *
 * Three tiny compositions rather than three cropped photographs: at 44px a
 * photograph is a smudge, while a bar chart is still recognisably a bar chart.
 */
function Thumb({ kind }: { kind: "chart" | "grid" | "rows" }) {
  return (
    <span className="border-border bg-surface grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border">
      {kind === "chart" && (
        <span className="flex h-5 items-end gap-[3px]">
          <span className="bg-border-strong h-2 w-1 rounded-sm" />
          <span className="bg-border-strong h-3.5 w-1 rounded-sm" />
          <span className="bg-signal h-5 w-1 rounded-sm" />
          <span className="bg-border-strong h-2.5 w-1 rounded-sm" />
        </span>
      )}
      {kind === "grid" && (
        <span className="grid grid-cols-2 gap-[3px]">
          {[0, 1, 2, 3].map((cell) => (
            <span
              key={cell}
              className={
                cell === 0
                  ? "bg-signal size-2 rounded-sm"
                  : "bg-border-strong size-2 rounded-sm"
              }
            />
          ))}
        </span>
      )}
      {kind === "rows" && (
        <span className="flex w-5 flex-col gap-[3px]">
          <span className="bg-signal h-1 w-full rounded-full" />
          <span className="bg-border-strong h-1 w-3/4 rounded-full" />
          <span className="bg-border-strong h-1 w-full rounded-full" />
          <span className="bg-border-strong h-1 w-2/3 rounded-full" />
        </span>
      )}
    </span>
  );
}
