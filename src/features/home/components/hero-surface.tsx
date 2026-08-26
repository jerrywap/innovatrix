import Image from "next/image";
import { Check, Lock } from "lucide-react";
import { HERO_MEDIA, HERO_WINDOWS } from "../data";

/**
 * The hero's foreground — the catalogue, and a front-end running in a browser.
 *
 * ## Chrome is drawn, content is real
 *
 * The split matters and it is deliberate. Everything structural — the panels, the
 * browser frame, the address bar, the badges — is composed from the design tokens,
 * so it is theme-aware, weighs nothing and cannot go stale. Everything *shown
 * inside* it is a real supplied asset: a real front-end screenshot in the browser,
 * real category thumbnails in the rows.
 *
 * That is the arrangement the brief actually asks for — "layered browser/product
 * windows" whose media is product, not stock. An earlier pass had this the other
 * way round, drawing a grey-bar wireframe *because* the only images available were
 * stock photographs of devices; given a genuine product shot the wireframe has
 * nothing left to argue for.
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
 * The address bar says `your-website.com` for the same reason: it names the
 * customer's outcome rather than the file they are buying.
 *
 * ## Smaller, not busier, on a phone
 *
 * The failure mode for a layered composition is "a pile of tiny unreadable
 * screenshots". The step pills are hidden below `sm` and the overlap tightens, so
 * two legible surfaces survive instead of five illegible ones.
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
              <span className="border-border bg-surface-muted relative size-11 shrink-0 overflow-hidden rounded-xl border">
                <Image src={item.src} alt="" fill sizes="44px" className="object-cover" />
              </span>
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
          {/*
            The address bar reads as the customer's own domain, not ours.

            It used to say `website-template.preview`, which describes the file
            they are buying. `https://your-website.com` describes the outcome —
            the same shift the headline makes from "Build it" to "Make it yours".
          */}
          <span className="bg-background text-subtle ml-2 flex flex-1 items-center gap-1.5 truncate rounded-md px-2 py-1 font-mono text-[9.5px]">
            <Lock className="size-2.5 shrink-0" />
            {HERO_MEDIA.templateUrl}
          </span>
        </div>

        {/*
          A real screenshot of a real front-end, at its own aspect ratio.

          This was a hand-drawn wireframe — grey bars standing in for a page —
          because the alternative at the time was a stock photograph. Given an
          actual product shot, the wireframe has nothing left to argue for: the
          brief asks for product previews as the hero media, and this is one.

          `width`/`height` are the intrinsic pixels, so the box is reserved before
          the bytes land and the panel cannot jump. `loading="eager"` rather than
          `priority`, because the background photograph is the LCP element and
          promoting two images competes for the same first connections.
        */}
        <Image
          src={HERO_MEDIA.templateShot}
          alt=""
          width={HERO_MEDIA.templateShotSize.width}
          height={HERO_MEDIA.templateShotSize.height}
          sizes="(min-width: 1024px) 480px, 90vw"
          loading="eager"
          className="block h-auto w-full"
        />
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
