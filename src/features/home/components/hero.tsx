import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, LayoutTemplate, Package, Wand2 } from "lucide-react";
import Image from "next/image";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { getPublishedProductCount, getTaxonomyIndex } from "@/services/marketplace";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { HERO_CHIPS, HERO_MEDIA, HERO_PATHS } from "../data";
import { HeroFilters } from "./hero-filters";
import { HeroSearch } from "./hero-search";
import { HeroSurface } from "./hero-surface";

/**
 * One id, two consumers: the `<form>` that `SearchBox` renders, and the split
 * button's Search half, which submits it from outside via `form="…"`.
 *
 * A constant rather than the same string typed twice — a silent mismatch would
 * leave a submit button that does nothing at all, and nothing would fail.
 */
const HERO_SEARCH_FORM = "hero-search-form";

/**
 * The hero — "what can I do here?" before "who is CoSetup?".
 *
 * ## The headline stays
 *
 * "Find it. Build it. Run it." is a sanctioned brand line, and it already covers
 * the three things this page has to offer plus the one it must not present as an
 * add-on. What changed is everything under it: the sub-headline used to open
 * "Most companies don't need a folder of code", which is a claim about companies,
 * and the three routes were a text list four bands further down. Now the
 * sub-headline names the inventory and the routes are the first thing under the
 * search box.
 *
 * ## Three cards, one quiet fourth route
 *
 * Applications & scripts, website templates, custom build — the ticket's three
 * focal points, equally weighted because they are three answers to one question.
 * Selling is a different audience, so it is a line rather than a fourth card:
 * four equally loud buttons is the hierarchy failure the brief names.
 */
/** Name → component, resolved server-side. See the note at the call site. */
const PATH_ICONS = {
  package: Package,
  layout: LayoutTemplate,
  wand: Wand2,
} as const;

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/*
        The photograph, on the left, with the subject in the clear.

        ## Three columns, and why the photo is not a backdrop

        The obvious arrangement — text left, everything else right — puts the
        photograph behind the product panels, which occlude the person entirely and
        leave a warm blur that reads as an accident. So the hero is three columns
        instead: photograph, then type, then the panels. Nothing overlaps anything
        it was meant to be seen through, and the one genuinely human thing on the
        page is the first thing in the reading order.

        The asset is the right-hand half of the supplied file. That file is a
        diptych — plain plaster wall, then the studio, with a **hard vertical seam**
        between them — and the wall was doing a job the page ground already does
        better. Cropping it removed the seam and took 471KB down to 88KB.

        ## The gradient is the join, and it finishes before the type starts

        The photograph has no border and no rounded corner; it dissolves into the
        page on its right edge and along its bottom, which is what stops it reading
        as an image pasted into a layout.

        `35%` is not a taste decision. On a 1440px viewport the type column begins
        at 513px, and 35% is 504px — so the gradient has already resolved to flat
        page colour before any text starts. At 43% the fade tail ran under the first
        hundred pixels of the paragraph, which put `--muted-foreground` at roughly
        4.3:1 against a blend of page and photograph: under AA, and *variably* under
        it, since the blend changes with the viewport. Ending the band short of the
        column means no text is ever over the photograph, so the contrast is just
        the token contrast.

        ## Below `lg` it goes behind, not away

        There are not three columns on a phone. The photograph becomes a full-width
        ground with a heavy veil over it — present enough to set the tone, faint
        enough that the headline on top of it keeps its contrast.

        Static, as asked: no parallax, no scroll coupling. A hero that moves under a
        headline fights the headline — and it would then owe
        `prefers-reduced-motion` an opinion.
      */}
      <div
        aria-hidden
        // Height, not `inset-y-0`. Left to fill the section the photograph runs
        // under the three path cards and the vendor line beneath them, and text
        // over a photograph is text with no contrast guarantee. The band stops
        // above the cards and the bottom gradient covers the handover.
        className="pointer-events-none absolute top-0 left-0 h-full w-full lg:h-[700px] lg:w-[35%]"
      >
        <Image
          src={HERO_MEDIA.background}
          alt=""
          fill
          sizes="(min-width: 1024px) 35vw, 100vw"
          // The page's LCP element, so it is fetched with the document.
          priority
          className="object-cover object-[60%_center] dark:opacity-[0.22]"
        />
        {/* the join: photograph on the left, page on the right */}
        <div className="to-background absolute inset-0 bg-gradient-to-r from-transparent from-40% lg:from-45%" />
        {/* and along the bottom, so it never ends on a line */}
        <div className="to-background absolute inset-x-0 bottom-0 h-52 bg-gradient-to-b from-transparent" />
        {/* phone only: the veil that keeps the headline legible on top of it */}
        <div className="bg-background/78 absolute inset-0 lg:hidden" />
      </div>

      {/* atmosphere — decorative, and never in the way of the text */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[860px] opacity-[0.55]"
        style={{
          background:
            "radial-gradient(760px 460px at 18% 8%, var(--signal-soft), transparent 68%)",
        }}
      />
      <div
        aria-hidden
        // Dark only. In light mode the photograph supplies the texture and a grid
        // on top of it is just noise; in dark the photograph sits at 18% and the
        // grid is what stops the band reading as flat black.
        className="bg-grid pointer-events-none absolute inset-x-0 top-0 hidden h-[620px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] opacity-40 dark:block"
      />

      <div className="relative mx-auto max-w-[1400px] px-5 pt-12 pb-16 lg:px-10 lg:pt-20 lg:pb-24">
        {/*
          Twelve columns, and the first four are the photograph's.

          The type starts at column five rather than column one, which is what
          leaves the left of the band to the photograph instead of putting the two
          on top of each other. Below `lg` the grid collapses and the photograph
          moves behind — see the note on the media layer above.
        */}
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4 lg:col-start-5">
            {/*
              A claim, not a label — so it is set as a sentence.

              This said "SOFTWARE MARKETPLACE & DELIVERY" in tracked-out mono
              uppercase, which is the house style for a *category* eyebrow and the
              wrong treatment for a line that is trying to make somebody stop:
              at 10.5px with 0.16em of tracking, in muted grey, a sentence this
              long is decoration rather than something read.

              So it keeps the pill and the pulsing dot and changes everything that
              was making it quiet — sentence case, 13.5px, `--foreground` instead
              of `--muted-foreground`, an opaque surface rather than 70%, and the
              stronger border. `shadow-lift` sits it above the photograph behind it
              rather than flat against it.

              Deliberately *not* orange. The headline's third line and the primary
              buttons already carry the accent, and the brand guide is explicit
              that orange stays an accent rather than flooding a surface.
            */}
            <div className="border-border-strong bg-surface shadow-lift inline-flex items-center gap-2.5 rounded-full border py-2 pr-5 pl-2.5">
              <span className="animate-pulse-ring bg-signal inline-block size-2 rounded-full" />
              <span className="text-foreground text-[13.5px] font-medium tracking-[-0.01em]">
                Your app might already exist
              </span>
            </div>

            {/*
              "Make it yours" rather than "Build it".

              Closer to the customer-journey line in the brand guide — Find it,
              Fit it, Launch it, Run it — and it names the thing that actually
              distinguishes this marketplace: almost everything on it can be
              adapted, so the middle step is adaptation rather than construction.
              "Build it" also read as a promise of bespoke work, which is one of
              four routes here and not the main one.
            */}
            {/*
              The scale is set by the *longest* line inside the *narrowest*
              column it has to live in.

              Two things shrank it. "Make it yours." is fourteen characters where
              "Build it." was nine, and the three-column hero gives the type four
              columns where it used to have six. Together those took the headline
              from `8.5vw` to `4.1vw`: at anything larger it wraps to four lines
              somewhere between `lg` and `xl`, which breaks the three-beat rhythm
              the whole headline is built on. Measured across seven widths rather
              than guessed — see the note in the commit.
            */}
            <h1 className="mt-6 text-[clamp(2.4rem,4.1vw,3.7rem)] leading-[1] font-semibold tracking-[-0.04em]">
              Find it.
              <br />
              Make it yours.
              <br />
              <span className="text-signal-text">Run it.</span>
            </h1>

            <p className="text-muted-foreground mt-6 max-w-[42ch] text-[16px] leading-[1.6] lg:text-[17px]">
              Ready-made applications, scripts and website templates — including free ones. Use
              them as they are, have them adapted, or tell us what to build.
            </p>

            <div className="mt-8 max-w-[560px]">
              {/*
                The search is persistent — `HeroSearch` docks it under the nav once
                the hero scrolls past and returns it here when the hero comes back.

                That is a departure from the note above about scroll coupling, and
                the distinction is worth stating: the *media* is still static and
                parallax is still refused. What moves is one control, between two
                discrete states, which is a different thing from motion driven
                continuously by scroll position — and it docks instantly under
                `prefers-reduced-motion` rather than sliding.

                `SearchBox` stays inside its own `<Suspense>` because it reads
                `useSearchParams()`, which opts the whole route out of prerendering
                otherwise — the build prints `ƒ /` instead of `◐ /` the moment that
                boundary goes. The fallback reserves the control's height so the
                chips below do not jump when it hydrates. The filter panel gets a
                second boundary for the same reason: it reads the taxonomy.
              */}
              <HeroSearch
                searchFormId={HERO_SEARCH_FORM}
                panel={
                  <Suspense fallback={<div className="h-40" />}>
                    <HeroFilters />
                  </Suspense>
                }
              >
                <Suspense fallback={<div className="h-[52px]" />}>
                  {/*
                    `/search`, not `/marketplace`.

                    The placeholder has always promised "apps, scripts,
                    templates" and the destination has always been the scripts
                    catalogue — so a home-page search for "landing page" returned
                    nothing while a whole shelf of them sat one path away. The
                    placeholder is now true.

                    `mode="navigate"` stays: a search from here takes you
                    somewhere else, and Back should return to the home page.
                  */}
                  <SearchBox
                    basePath="/search"
                    mode="navigate"
                    inputId="hero-search"
                    formId={HERO_SEARCH_FORM}
                    placeholder="Search apps, scripts, templates…"
                  />
                </Suspense>
              </HeroSearch>

              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                {HERO_CHIPS.map((chip) => (
                  <Link
                    key={chip.label}
                    href={`/search?q=${encodeURIComponent(chip.q)}` as Route}
                    className="border-border text-muted-foreground hover:border-border-strong hover:text-foreground rounded-full border px-3 py-1.5 text-[12.5px] transition"
                  >
                    {chip.label}
                  </Link>
                ))}
              </div>

              {/*
                Its own boundary, so the hero's text is in the first flush and the
                catalogue read cannot hold it up. The fallback reserves the line's
                height rather than collapsing it, so nothing below shifts.
              */}
              <div className="mt-5">
                <Suspense
                  fallback={<p className="text-muted-foreground text-[13.5px]">&nbsp;</p>}
                >
                  <CatalogueSummary />
                </Suspense>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4">
            <HeroSurface />
          </div>
        </div>

        {/*
          The three doors — the ticket's focal points, as the first thing under
          the search box.

          Typographic rather than illustrated: see `HERO_PATHS`. The icon is
          resolved here from a name, because these are rendered on the server and
          a component function cannot cross into a client boundary — the same
          discipline `nav-icons.ts` enforces for the sidebar.
        */}
        <div className="mt-16 grid gap-3 sm:grid-cols-3 lg:mt-20">
          {HERO_PATHS.map((path) => {
            const Icon = PATH_ICONS[path.icon];
            return (
              <Link
                key={path.href}
                href={path.href}
                className="group border-border bg-surface hover:border-border-strong shadow-lift flex flex-col rounded-[22px] border p-5 transition lg:p-6"
              >
                <span className="flex items-center justify-between">
                  <span className="bg-signal-soft grid size-9 place-items-center rounded-xl">
                    <Icon className="text-signal-text size-[18px]" aria-hidden />
                  </span>
                  <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                    {path.eyebrow}
                  </span>
                </span>

                <span className="mt-5 flex items-center gap-2 text-[17.5px] font-medium tracking-[-0.02em]">
                  {path.title}
                  <ArrowRight
                    className="text-subtle size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden
                  />
                </span>
                <span className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">
                  {path.body}
                </span>
              </Link>
            );
          })}
        </div>

        {/* the vendor route — present, and deliberately quiet */}
        <p className="text-muted-foreground mt-6 text-[13.5px]">
          Built something yourself?{" "}
          <Link href="/sell" className="text-signal-text underline underline-offset-4">
            Sell it on CoSetup
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/**
 * What is actually in the catalogue, or nothing at all.
 *
 * Suspended by the caller, because both reads are cached but still async — and an
 * `await` in the page body would make the whole homepage dynamic.
 *
 * The `< 25` floor is the honesty rule this component exists for: the page once
 * claimed "148 products across 31 industries" as a hardcoded string while the
 * catalogue held four. Below a threshold where a count is worth saying, it says
 * something true instead.
 */
export async function CatalogueSummary() {
  const [count, taxonomy] = await Promise.all([
    getPublishedProductCount(DEFAULT_CURRENCY, "script"),
    getTaxonomyIndex("script"),
  ]);

  if (count < 25) {
    return (
      <p className="text-muted-foreground text-[13.5px]">
        Ready-made software, adapted to how you actually work.
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-[13.5px]">
      <span className="text-foreground font-medium tabular-nums">{count}</span> products across{" "}
      <span className="text-foreground font-medium tabular-nums">
        {taxonomy.industry.length}
      </span>{" "}
      industries &middot; every one of them adaptable
    </p>
  );
}
