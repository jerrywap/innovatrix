import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, LayoutTemplate, Package, Wand2 } from "lucide-react";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { getPublishedProductCount, getTaxonomyIndex } from "@/services/marketplace";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { HERO_CHIPS, HERO_PATHS } from "../data";
import { HeroSurface } from "./hero-surface";

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
        className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[620px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] opacity-40"
      />

      <div className="relative mx-auto max-w-[1400px] px-5 pt-12 pb-16 lg:px-10 lg:pt-20 lg:pb-24">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <div className="border-border bg-surface/70 inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-2 backdrop-blur">
              <span className="animate-pulse-ring bg-signal inline-block size-2 rounded-full" />
              <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.16em] uppercase">
                Software marketplace &amp; delivery
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
              `6.4vw`, down from `8.5vw`.

              The scale is set by the *longest* line, and that is now "Make it
              yours." at fourteen characters rather than "Build it." at nine. At
              the old rate it wrapped to four lines from `lg` up to about 1200px,
              which broke the three-beat rhythm the whole headline depends on.
              6.4vw keeps all three lines unwrapped from 390px to the 5.75rem cap.
            */}
            <h1 className="mt-7 text-[clamp(2.6rem,6.4vw,5.75rem)] leading-[0.95] font-semibold tracking-[-0.045em]">
              Find it.
              <br />
              Make it yours.
              <br />
              <span className="text-signal-text">Run it.</span>
            </h1>

            <p className="text-muted-foreground mt-7 max-w-[46ch] text-[17px] leading-[1.65] lg:text-[18.5px]">
              Ready-made applications, scripts and website templates — including free ones. Use
              them as they are, have them adapted, or tell us what to build.
            </p>

            <div className="mt-9 max-w-[560px]">
              {/*
                `SearchBox` reads `useSearchParams()`, which opts the whole route
                out of prerendering unless it is behind a boundary — the build
                prints `ƒ /` instead of `◐ /` the moment this wrapper goes. The
                fallback reserves the control's height so the chips below do not
                jump when it hydrates.
              */}
              <Suspense fallback={<div className="h-[52px]" />}>
                <SearchBox
                  basePath="/marketplace"
                  mode="navigate"
                  inputId="hero-search"
                  placeholder="Search apps, scripts, templates…"
                />
              </Suspense>

              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                {HERO_CHIPS.map((chip) => (
                  <Link
                    key={chip.label}
                    href={`/marketplace?q=${encodeURIComponent(chip.q)}` as Route}
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

          <div className="lg:col-span-6">
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
