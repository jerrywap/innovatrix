/* eslint-disable @next/next/no-img-element */
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata, Route } from "next";
import { SHOT, placeholder } from "@/lib/placeholder-images";
import { pageMetadata } from "@/lib/seo";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { SearchBox } from "@/features/marketplace/components/search-box";
import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { getPublishedProductCount, getRail, getTaxonomyIndex } from "@/services/marketplace";

/**
 * The home page had **no metadata of its own** before ticket 27.
 *
 * It inherited the root layout's defaults, which is not nothing — but it meant
 * no canonical, no Open Graph and no Twitter card on the single most-linked URL
 * on the site. A shared link rendered as a bare hostname.
 *
 * The title is written out rather than left to the `%s · Innovatrix` template,
 * because on the home page that template would produce "Innovatrix · Innovatrix".
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: "Innovatrix",
    description:
      "Buy software that already exists, have it adapted to how you work, or commission it outright — then have it installed, supported and maintained.",
    path: "/",
  }),
  title: { absolute: "Innovatrix — Find, customise, build and run your software" },
};

/* ────────────────────────────────────────────────────────── data */

const DOORS = [
  {
    n: "01",
    title: "I found software I want",
    body: "Buy it as it stands. Licence, download and installation handled in a single pass.",
    meta: "Marketplace",
    href: "/marketplace",
  },
  {
    n: "02",
    title: "I found it, but it needs changes",
    body: "Tell our assistant what to change. We scope it, quote it and build it against a working starting point.",
    meta: "Customisation",
    href: "/marketplace",
  },
  {
    n: "03",
    title: "I need something that doesn’t exist yet",
    body: "Describe the business problem in your own words. We translate it into a system.",
    meta: "Custom build",
    href: "/custom-software",
  },
  {
    n: "04",
    title: "I need help with what I already run",
    body: "Installation, deployment, upgrades, maintenance and ongoing technical support.",
    meta: "Services",
    href: "/services",
  },
  // `as const` so each href stays a string *literal*. Widened to `string` it
  // would fail typedRoutes, and — worse — a typo in one of them would stop
  // being a compile error.
] as const;

/**
 * Rows for the stylised app-preview in the hero — an illustration, not data.
 *
 * They used to be four real seeded products (Atlas CRM, Tenancy, Roster) with
 * hardcoded prices and "adapted 23×" counts beside them. That made the home
 * page a stale mirror of live rows: a price here that disagreed with the price
 * on the product page is a screenshot in a complaint.
 *
 * Now they are descriptions of *kinds* of software rather than names of ours,
 * and they carry no prices. The picture reads the same and asserts nothing.
 * The real four are below, in `FeaturedProducts`, straight from the catalogue.
 */
const ILLUSTRATION = [
  { name: "Client manager", cat: "Sales", img: SHOT.dashboard },
  { name: "Lettings", cat: "Property", img: SHOT.property },
  { name: "Shift planner", cat: "Care & HR", img: SHOT.roster },
];

const LIFECYCLE = [
  "Discover",
  "Evaluate",
  "Purchase",
  "Clarify",
  "Deliver",
  "Configure",
  "Test",
  "Support",
  "Maintain",
];

const INDUSTRIES = [
  "Healthcare",
  "Property",
  "Logistics",
  "Hospitality",
  "Education",
  "Finance",
  "Retail",
  "Professional services",
  "Nonprofit",
  "Care",
];

/* ────────────────────────────────────────────────────────── page */

export default function Home() {
  return (
    <>
      <Hero />
      <IndustryMarquee />
      <Doors />
      <Marketplace />
      <Assistant />
      <Lifecycle />
      <ClosingCta />
    </>
  );
}

/* ────────────────────────────────────────────────────────── hero */

/**
 * The chips, as real searches.
 *
 * `label` is what reads well on a pill; `q` is what actually finds something.
 * They differ because "Rota & timesheets" is how a care manager says it and
 * "rota timesheets" is what the text index scores.
 */
const HERO_CHIPS: ReadonlyArray<{ label: string; q: string }> = [
  { label: "CRM", q: "crm" },
  { label: "Booking", q: "booking" },
  { label: "Property", q: "property" },
  { label: "Rota & timesheets", q: "rota timesheets" },
  { label: "Inventory", q: "inventory" },
];

/**
 * The hero's search field.
 *
 * `navigate` mode: this is not a page with results to filter, so typing here
 * takes you to the marketplace on submit rather than replacing the URL as you
 * pause. Its own component because `SearchBox` reads `useSearchParams()` and so
 * has to sit under a `<Suspense>` — the same treatment `/marketplace` gives it.
 */
function HeroSearch() {
  return (
    <SearchBox
      basePath="/marketplace"
      mode="navigate"
      inputId="hero-search"
      label="Search the marketplace"
      placeholder="Search products, or describe what you need…"
    />
  );
}

/**
 * The trust line, from the database.
 *
 * Async and suspended so `Home()` stays synchronous: the `(public)` layout goes
 * to some trouble to keep these pages prerendered, and an `await` in the page
 * body would make the whole route dynamic.
 */
async function CatalogueSummary() {
  const [count, taxonomy] = await Promise.all([getPublishedProductCount(), getTaxonomyIndex()]);

  const industries = taxonomy.industry?.length ?? 0;

  // A brand-new catalogue should not boast. "Search 4 products" is worse than
  // saying nothing, so below a threshold the copy drops the numbers entirely.
  if (count < 25) {
    return (
      <p className="text-muted-foreground text-[13.5px]">
        Ready-made software, adapted to how you actually work.
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-[13.5px]">
      <span className="text-foreground font-medium">
        {count.toLocaleString("en-GB")} products
      </span>
      {industries > 0 && ` across ${industries} industries`} · every one of them adaptable
    </p>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* atmosphere */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[860px] opacity-[0.55]"
        style={{
          background:
            "radial-gradient(760px 460px at 18% 8%, var(--signal-soft), transparent 68%)",
        }}
      />
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[620px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] opacity-40" />

      <div className="relative mx-auto max-w-[1400px] px-5 pt-14 pb-16 lg:px-10 lg:pt-24 lg:pb-24">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          {/* ── left */}
          <div className="lg:col-span-6 xl:col-span-6">
            <div className="border-border bg-surface/70 inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-2 backdrop-blur">
              <span className="animate-pulse-ring bg-signal inline-block h-2 w-2 rounded-full" />
              <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.16em] uppercase">
                Software acquisition &amp; delivery
              </span>
            </div>

            <h1 className="mt-7 text-[clamp(2.75rem,8.5vw,5.75rem)] leading-[0.9] font-semibold tracking-[-0.045em]">
              Find it.
              <br />
              Change it.
              <br />
              <span className="text-signal-text">Build it.</span>
            </h1>

            <p className="text-muted-foreground mt-7 max-w-[46ch] text-[17px] leading-[1.65] lg:text-[18.5px]">
              Most companies don’t need a folder of code. They need the software found, adapted,
              delivered, installed and kept alive. Innovatrix is the one system that does all of
              it.
            </p>

            {/*
              The two doors of §107, in one control.

              This used to be a `<span>` styled to look like a search field,
              with five `<button>`s under it that had no handlers — in a Server
              Component, so they could not have had any. It was the first thing
              on the site and the only part of it that did nothing.
            */}
            <div className="mt-9 max-w-[560px]">
              <div className="shadow-lift border-border bg-surface flex flex-col gap-2 rounded-[22px] border p-2 sm:flex-row sm:items-center sm:rounded-full sm:pl-2.5">
                <div className="flex-1">
                  <Suspense fallback={<div className="h-11" />}>
                    <HeroSearch />
                  </Suspense>
                </div>
                <Link
                  href="/custom-software"
                  className="bg-signal text-signal-contrast shrink-0 rounded-full px-6 py-3 text-center text-[14px] font-medium transition hover:opacity-90"
                >
                  Describe it
                </Link>
              </div>

              <div className="mt-3.5 flex flex-wrap gap-2">
                {HERO_CHIPS.map((chip) => (
                  <Link
                    key={chip.label}
                    href={`/marketplace?q=${encodeURIComponent(chip.q)}` as Route}
                    className="border-border bg-surface/60 text-muted-foreground hover:border-border-strong hover:text-foreground rounded-full border px-3.5 py-1.5 text-[12.5px] transition"
                  >
                    {chip.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* trust */}
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex -space-x-2.5">
                {[SHOT.roster, SHOT.office, SHOT.analytics, SHOT.retail].map((s, i) => (
                  <span
                    key={i}
                    className="border-background bg-surface-muted h-8 w-8 overflow-hidden rounded-full border-2"
                  >
                    <img
                      src={placeholder(s, 80, 80)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </span>
                ))}
              </div>
              {/*
                Was "148 products across 31 industries · median quote in 4.2
                days". The catalogue held a thousand across nine, and nothing
                measures quote turnaround — the figure was copied from a design
                mock-up that labels its own numbers illustrative. Two of the
                three are now derived; the third is gone, because a claim we
                cannot compute is one we should not print.
              */}
              <Suspense
                fallback={<p className="text-muted-foreground text-[13.5px]">&nbsp;</p>}
              >
                <CatalogueSummary />
              </Suspense>
            </div>
          </div>

          {/* ── right: layered product surface */}
          <div className="lg:col-span-6 xl:col-span-6">
            <HeroSurface />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Two stacked panels showing both doors at once: the catalogue you can browse,
 * and the assistant you can talk to. Built in markup rather than a screenshot
 * so it re-themes correctly and stays sharp on any display.
 */
function HeroSurface() {
  return (
    <div className="relative mx-auto max-w-[560px] lg:max-w-none">
      {/* back panel — marketplace */}
      <div className="shadow-lift border-border bg-surface rounded-[26px] border p-4 sm:p-5">
        <div className="flex items-center justify-between px-1 pb-3.5">
          <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            Marketplace
          </span>
          <span className="text-subtle font-mono text-[10px]">Search &amp; filter</span>
        </div>

        <div className="space-y-2">
          {ILLUSTRATION.map((p) => (
            <div
              key={p.name}
              className="border-border bg-background/60 hover:border-border-strong flex items-center gap-3.5 rounded-2xl border p-2.5 transition"
            >
              <span className="bg-surface-muted h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                <img
                  src={placeholder(p.img, 120, 120)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{p.name}</div>
                <div className="text-subtle font-mono text-[10.5px]">{p.cat}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* front panel — assistant */}
      <div className="shadow-float border-border bg-surface relative z-10 mt-[-14px] ml-auto w-[92%] rounded-[26px] border p-4 sm:mt-[-18px] sm:p-5 lg:w-[88%]">
        <div className="flex items-center justify-between pb-4">
          <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            Your request
          </span>
          <span className="bg-signal-soft text-signal-text flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-[0.14em] uppercase">
            <span className="bg-signal inline-block h-1.5 w-1.5 rounded-full" />
            Live
          </span>
        </div>

        <div className="space-y-3">
          <Bubble side="ai">What would you like to change about Atlas CRM?</Bubble>
          <Bubble side="you">I want it for a property agency.</Bubble>
          <Bubble side="ai">
            Should it also handle listings, landlords and tenants — or is this mainly branding?
          </Bubble>
        </div>

        <div className="border-border mt-4 border-t pt-4">
          <div className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Confirmed so far
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {["Properties", "Landlords", "Tenants", "Rent reminders"].map((t) => (
              <span
                key={t}
                className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-1 text-[11.5px]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* floating status pill */}
      <div className="shadow-lift border-border bg-surface absolute bottom-16 -left-2 z-20 hidden items-center gap-2.5 rounded-full border px-3.5 py-2.5 sm:flex lg:-left-6">
        <span className="bg-signal-soft grid h-6 w-6 place-items-center rounded-full">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-signal-text"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="text-[12px] font-medium">Licence issued</span>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "ai" | "you"; children: React.ReactNode }) {
  const isAi = side === "ai";
  return (
    <div className={isAi ? "" : "flex justify-end"}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-[1.5] ${
          isAi
            ? "bg-surface-muted text-foreground rounded-tl-md"
            : "bg-foreground text-background rounded-tr-md"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── marquee */

function IndustryMarquee() {
  return (
    <section className="border-border bg-surface-muted/40 overflow-hidden border-y py-5">
      <div className="animate-marquee flex w-max gap-3">
        {[...INDUSTRIES, ...INDUSTRIES].map((industry, i) => (
          <span
            key={`${industry}-${i}`}
            className="border-border bg-surface/60 text-muted-foreground flex items-center gap-3 rounded-full border px-5 py-2 text-[13px] whitespace-nowrap"
          >
            <span className="bg-signal h-1 w-1 rounded-full" />
            {industry}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── doors */

function Doors() {
  return (
    <section id="paths" className="mx-auto max-w-[1400px] px-5 py-20 lg:px-10 lg:py-32">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <h2 className="max-w-[14ch] text-[clamp(1.9rem,4.8vw,3.4rem)] leading-[0.98] font-semibold tracking-[-0.04em] text-balance">
          Four ways in. One relationship.
        </h2>
        <p className="text-subtle max-w-[38ch] font-mono text-[11px] leading-relaxed tracking-[0.14em] uppercase">
          However you arrive, everything after lives in one dashboard
        </p>
      </div>

      <div className="mt-12 space-y-2">
        {DOORS.map((d) => (
          <Link
            key={d.n}
            href={d.href}
            className="group hover:border-border hover:bg-surface grid grid-cols-12 items-center gap-x-4 gap-y-2 rounded-[22px] border border-transparent px-4 py-6 transition lg:px-6 lg:py-7"
          >
            <span className="text-signal-text col-span-2 font-mono text-[11px] tracking-[0.14em] lg:col-span-1">
              {d.n}
            </span>
            <h3 className="col-span-10 text-[clamp(1.15rem,2.5vw,1.75rem)] leading-[1.15] font-medium tracking-[-0.03em] lg:col-span-5">
              {d.title}
            </h3>
            <p className="text-muted-foreground col-span-12 text-[14.5px] leading-relaxed lg:col-span-4">
              {d.body}
            </p>
            <div className="col-span-12 flex items-center justify-between gap-3 lg:col-span-2 lg:justify-end">
              <span className="bg-surface-muted text-muted-foreground rounded-full px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase">
                {d.meta}
              </span>
              <span className="border-border text-muted-foreground group-hover:border-signal group-hover:bg-signal group-hover:text-signal-contrast grid h-8 w-8 place-items-center rounded-full border transition">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── marketplace */

function Marketplace() {
  return (
    <section id="marketplace" className="border-border bg-surface-muted/40 border-y">
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mb-11 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
              Marketplace
            </div>
            <h2 className="mt-3.5 max-w-[18ch] text-[clamp(1.75rem,4.2vw,3rem)] leading-[1] font-semibold tracking-[-0.04em]">
              Built already. Yours today.
            </h2>
          </div>
          <Link
            href="/marketplace"
            className="border-border bg-surface hover:border-border-strong rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition"
          >
            Browse the marketplace →
          </Link>
        </div>

        <Suspense fallback={<FeaturedSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </div>
    </section>
  );
}

/**
 * Four real products, from the same rail `/marketplace` renders.
 *
 * These were four hardcoded objects with invented prices and "adapted 23×"
 * counts — and three of the four names (Atlas CRM, Tenancy, Roster) are real
 * seeded products, so the home page was showing stale copies of live rows. A
 * price shown here that disagrees with the price on the product page is the
 * kind of thing a customer screenshots.
 *
 * `ProductCardTile` is the tile the marketplace and its rails already use, so
 * this section now cannot drift from them by construction.
 */
async function FeaturedProducts() {
  const cards = await getRail("featured", DEFAULT_CURRENCY, 4);

  if (cards.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <ProductCardTile key={card.id} card={card} />
      ))}
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="border-border bg-surface h-[280px] rounded-[22px] border" />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── assistant */

function Assistant() {
  return (
    <section id="assistant" className="mx-auto max-w-[1400px] px-5 py-20 lg:px-10 lg:py-32">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            Requirements assistant
          </div>
          <h2 className="mt-4 text-[clamp(1.9rem,4.5vw,3.2rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
            You describe the business.
            <br />
            <span className="text-muted-foreground">We handle the technical.</span>
          </h2>
          <p className="text-muted-foreground mt-6 max-w-[46ch] text-[16.5px] leading-[1.65]">
            No forty-field brief. A conversation that asks one sensible question at a time, then
            hands you a structured requirement document you can edit before anyone at Innovatrix
            reads it.
          </p>

          <ul className="mt-9 space-y-2.5">
            {[
              "Never invents a requirement you didn’t confirm",
              "Flags what it assumed, separately from what you said",
              "Won’t quote a price or promise a date — a person does that",
            ].map((t) => (
              <li
                key={t}
                className="border-border bg-surface flex items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-[14.5px]"
              >
                <span className="bg-signal-soft mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-signal-text"
                    aria-hidden
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <div className="shadow-lift border-border bg-surface overflow-hidden rounded-[26px] border">
            <div className="border-border flex items-center justify-between border-b px-5 py-3.5">
              <span className="text-subtle font-mono text-[10px] tracking-[0.14em] uppercase">
                Requirements summary
              </span>
              <span className="bg-surface-muted text-muted-foreground rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                Editable
              </span>
            </div>

            <div className="space-y-5 p-5 lg:p-7">
              {/* Names the product the bubble above asks about. The version
                  number that used to be here (`· v2.4.1`) was invented. */}
              <Field label="Base product" value="Atlas CRM" />
              <Field label="Business type" value="Property management" />

              <div>
                <div className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  Confirmed by you
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {[
                    "Properties",
                    "Landlords",
                    "Tenants",
                    "Rent reminders",
                    "Tenant login",
                    "Company branding",
                  ].map((t) => (
                    <span
                      key={t}
                      className="border-border bg-background rounded-full border px-3 py-1.5 text-[12.5px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-signal-text font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  Assumed — confirm or remove
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {["Stripe payments", "Hosting by Innovatrix"].map((t) => (
                    <span
                      key={t}
                      className="border-signal/50 bg-signal-soft text-signal-text rounded-full border border-dashed px-3 py-1.5 text-[12.5px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-border flex flex-wrap gap-2 border-t p-5 lg:px-7">
              <button className="bg-foreground text-background rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90">
                Submit to Innovatrix
              </button>
              <button className="border-border hover:border-border-strong rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition">
                Keep talking
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-4 border-b pb-3.5">
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </span>
      <span className="text-right text-[14.5px] font-medium">{value}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── lifecycle */

function Lifecycle() {
  return (
    <section className="border-border border-t py-20 lg:py-28">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-10">
        <h2 className="max-w-[22ch] text-[clamp(1.6rem,3.6vw,2.6rem)] leading-[1.06] font-semibold tracking-[-0.04em] text-balance">
          One purchase is the start of the relationship, not the end of it.
        </h2>
      </div>

      <div className="mt-11 overflow-x-auto pb-2">
        <div className="mx-auto flex max-w-[1400px] min-w-max gap-2.5 px-5 lg:px-10">
          {LIFECYCLE.map((s, i) => (
            <div
              key={s}
              className={`min-w-[132px] flex-1 rounded-2xl border px-4 py-4 ${
                i < 4 ? "border-signal/30 bg-signal-soft" : "border-border bg-surface-muted/50"
              }`}
            >
              <div
                className={`font-mono text-[9.5px] tracking-[0.16em] ${
                  i < 4 ? "text-signal-text" : "text-subtle"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="mt-1.5 text-[14.5px] font-medium tracking-[-0.02em]">{s}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── cta */

function ClosingCta() {
  return (
    <section className="px-5 py-16 lg:px-10 lg:py-24">
      <div className="grain bg-surface-inverse text-foreground-inverse relative mx-auto max-w-[1400px] overflow-hidden rounded-[32px] px-6 py-16 lg:px-14 lg:py-24">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px 320px at 78% 12%, var(--signal-soft), transparent 70%)",
          }}
        />
        <div className="relative grid gap-10 lg:grid-cols-12">
          <h2 className="text-[clamp(2.1rem,6vw,4.5rem)] leading-[0.92] font-semibold tracking-[-0.045em] lg:col-span-7">
            Tell us what your business needs to do.
          </h2>
          <div className="flex flex-col justify-end gap-6 lg:col-span-4 lg:col-start-9">
            <p className="text-[16.5px] leading-[1.6] opacity-70">
              Not what stack it should use. Not what the schema looks like. Just the outcome —
              we take it from there.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/custom-software"
                className="bg-signal text-signal-contrast rounded-full px-7 py-4 text-center text-[14.5px] font-medium transition hover:opacity-90"
              >
                Start a conversation
              </Link>
              <Link
                href="/marketplace"
                className="rounded-full border border-current/25 px-7 py-4 text-center text-[14.5px] font-medium opacity-80 transition hover:opacity-100"
              >
                Browse first
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
