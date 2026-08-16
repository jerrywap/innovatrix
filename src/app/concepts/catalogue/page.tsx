/* eslint-disable @next/next/no-img-element */
import { PHOTO, u } from "../_lib/img";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const CREAM = "#FAF7F0";
const INK = "#141210";
const ULTRA = "#1B1AFF";

const CATEGORIES = [
  "All 148",
  "CRM",
  "Booking",
  "Property",
  "Healthcare",
  "Logistics",
  "HR & Rota",
  "E‑commerce",
  "Finance",
  "Education",
  "Admin panels",
  "Starter kits",
];

const GRID = [
  { n: "Tenancy", c: "Property", p: "£450", s: "Laravel · Postgres", img: PHOTO.property },
  { n: "Roster", c: "HR & Rota", p: "£380", s: "Next.js · Mongo", img: PHOTO.teamMeeting },
  { n: "Freightline", c: "Logistics", p: "£520", s: "Laravel · MySQL", img: PHOTO.logistics },
  { n: "Chartwell", c: "Healthcare", p: "£690", s: "Django · Postgres", img: PHOTO.healthcare },
  { n: "Counter", c: "Retail", p: "£340", s: "Next.js · Stripe", img: PHOTO.retail },
  { n: "Ledgerly", c: "Finance", p: "£410", s: "Laravel · Postgres", img: PHOTO.analytics },
];

export default function Catalogue() {
  return (
    <main
      className="min-h-screen font-[family-name:var(--font-newsreader)] antialiased"
      style={{ background: CREAM, color: INK }}
    >
      {/* ─────────────────────────── MASTHEAD */}
      <header className="border-b" style={{ borderColor: `${INK}1A` }}>
        <div
          className="flex items-center justify-between px-5 py-2 text-[11px] tracking-[0.18em] uppercase lg:px-8"
          style={{ background: INK, color: CREAM }}
        >
          <span>Software, catalogued</span>
          <span className="hidden sm:block">Issue 12 — Spring 2026</span>
          <span>148 products in stock</span>
        </div>
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-6 px-5 py-5 lg:px-8">
          <h1 className="font-[family-name:var(--font-bricolage)] text-[26px] leading-none font-extrabold tracking-[-0.05em] lg:text-[32px]">
            INNOVATRIX
          </h1>
          <nav className="hidden items-center gap-7 font-[family-name:var(--font-bricolage)] text-[13.5px] font-medium tracking-[-0.01em] lg:flex">
            <a className="hover:text-[#1B1AFF]" href="#catalogue">
              Catalogue
            </a>
            <a className="hover:text-[#1B1AFF]" href="#commission">
              Commission
            </a>
            <a className="hover:text-[#1B1AFF]" href="#services">
              Services
            </a>
            <a className="hover:text-[#1B1AFF]" href="#pricing">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <button className="hidden font-[family-name:var(--font-bricolage)] text-[13.5px] font-medium sm:block">
              Sign in
            </button>
            <button
              className="font-[family-name:var(--font-bricolage)] text-[13.5px] font-semibold text-white"
              style={{ background: ULTRA, padding: "10px 18px" }}
            >
              Browse →
            </button>
          </div>
        </div>
      </header>

      {/* ─────────────────────────── EDITORIAL HERO */}
      <section className="border-b" style={{ borderColor: `${INK}1A` }}>
        <div className="mx-auto grid max-w-[1320px] gap-0 px-5 lg:grid-cols-12 lg:px-8">
          <div
            className="border-b py-12 lg:col-span-7 lg:border-r lg:border-b-0 lg:py-20 lg:pr-12"
            style={{ borderColor: `${INK}1A` }}
          >
            <div
              className="font-[family-name:var(--font-bricolage)] text-[11px] font-bold tracking-[0.2em] uppercase"
              style={{ color: ULTRA }}
            >
              The premise
            </div>
            <h2 className="mt-5 font-[family-name:var(--font-bricolage)] text-[clamp(2.4rem,7vw,5.5rem)] leading-[0.88] font-extrabold tracking-[-0.05em]">
              A department store for business software.
            </h2>
            <p className="mt-7 max-w-[52ch] text-[18px] leading-[1.55] text-[#141210]/72 lg:text-[20px]">
              Every product on these pages is finished, documented, demoable and licensed. Buy
              it as it stands, or have us alter it to fit —{" "}
              <em>the same way you’d have a suit taken in.</em>
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                className="font-[family-name:var(--font-bricolage)] text-[15px] font-semibold text-white"
                style={{ background: INK, padding: "14px 28px" }}
              >
                Enter the catalogue
              </button>
              <button
                className="border font-[family-name:var(--font-bricolage)] text-[15px] font-semibold"
                style={{ borderColor: `${INK}33`, padding: "14px 28px" }}
              >
                Commission something
              </button>
            </div>
          </div>

          <div className="relative lg:col-span-5">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-[#d9d4c8] to-[#b8b2a4] lg:aspect-auto lg:h-full">
              <img
                src={u(PHOTO.studioLight, 1200)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <div
                className="absolute right-0 bottom-0 left-0 p-5 font-[family-name:var(--font-bricolage)] text-[12px] font-medium text-white"
                style={{
                  background: "linear-gradient(to top, rgba(20,18,16,0.9), transparent)",
                }}
              >
                <span style={{ color: "#9F9EFF" }}>Featured</span> — Tenancy, our most-adapted
                property system
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── CATEGORY RAIL */}
      <section className="border-b" style={{ borderColor: `${INK}1A` }}>
        <div className="mx-auto max-w-[1320px] overflow-x-auto px-5 lg:px-8">
          <div className="flex min-w-max gap-6 py-4 font-[family-name:var(--font-bricolage)] text-[13.5px] font-medium">
            {CATEGORIES.map((c, i) => (
              <button
                key={c}
                className="border-b-2 pb-1 whitespace-nowrap transition"
                style={{
                  borderColor: i === 0 ? ULTRA : "transparent",
                  color: i === 0 ? ULTRA : `${INK}A6`,
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── FEATURED SPREAD */}
      <section id="catalogue" className="border-b" style={{ borderColor: `${INK}1A` }}>
        <div className="mx-auto grid max-w-[1320px] gap-0 px-5 lg:grid-cols-12 lg:px-8">
          <div className="relative order-2 aspect-[16/10] overflow-hidden bg-[#c9c3b6] lg:order-1 lg:col-span-8 lg:aspect-auto lg:min-h-[540px]">
            <img
              src={u(PHOTO.dashboard, 1600)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
          <div
            className="order-1 border-b py-10 lg:order-2 lg:col-span-4 lg:border-b-0 lg:border-l lg:py-14 lg:pl-10"
            style={{ borderColor: `${INK}1A` }}
          >
            <div className="font-[family-name:var(--font-bricolage)] text-[11px] font-bold tracking-[0.2em] text-[#141210]/45 uppercase">
              Product no. 041
            </div>
            <h3 className="mt-4 font-[family-name:var(--font-bricolage)] text-[clamp(2rem,4.5vw,3rem)] leading-[0.94] font-extrabold tracking-[-0.04em]">
              Atlas CRM
            </h3>
            <p className="mt-4 text-[17px] leading-[1.6] text-[#141210]/72">
              A complete sales and customer system. Adapted 23 times so far — for agencies,
              clinics, brokers and one surprisingly large vineyard.
            </p>

            <dl className="mt-8 divide-y" style={{ borderColor: `${INK}1A` }}>
              {[
                ["Licence", "Single installation"],
                ["Stack", "Laravel 11 · PostgreSQL 16"],
                ["Support", "12 months included"],
                ["Customisation", "From £1,400"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-4 border-t py-3"
                  style={{ borderColor: `${INK}14` }}
                >
                  <dt className="font-[family-name:var(--font-bricolage)] text-[12px] font-semibold tracking-[0.1em] text-[#141210]/50 uppercase">
                    {k}
                  </dt>
                  <dd className="text-right text-[15px]">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex items-end justify-between">
              <div>
                <div className="font-[family-name:var(--font-bricolage)] text-[11px] font-bold tracking-[0.16em] text-[#141210]/45 uppercase">
                  Price
                </div>
                <div className="font-[family-name:var(--font-bricolage)] text-[34px] leading-none font-extrabold tracking-[-0.04em]">
                  £299
                </div>
              </div>
              <button
                className="font-[family-name:var(--font-bricolage)] text-[14px] font-semibold text-white"
                style={{ background: ULTRA, padding: "12px 22px" }}
              >
                Try the demo
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── GRID */}
      <section className="mx-auto max-w-[1320px] px-5 py-14 lg:px-8 lg:py-20">
        <div
          className="flex items-baseline justify-between border-b pb-4"
          style={{ borderColor: `${INK}1A` }}
        >
          <h3 className="font-[family-name:var(--font-bricolage)] text-[clamp(1.4rem,3vw,2.2rem)] font-extrabold tracking-[-0.04em]">
            In stock this week
          </h3>
          <a
            href="#"
            className="font-[family-name:var(--font-bricolage)] text-[13.5px] font-semibold"
            style={{ color: ULTRA }}
          >
            See all 148 →
          </a>
        </div>

        <div className="grid gap-x-6 gap-y-12 pt-10 sm:grid-cols-2 lg:grid-cols-3">
          {GRID.map((p, i) => (
            <article key={p.n} className="group">
              <div className="relative aspect-[5/4] overflow-hidden bg-[#ddd8cc]">
                <img
                  src={u(p.img, 800)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                />
                <div
                  className="absolute inset-0 opacity-0 transition group-hover:opacity-100"
                  style={{ background: `${ULTRA}1F` }}
                />
                <span className="absolute top-3 right-3 bg-white px-2 py-1 font-[family-name:var(--font-bricolage)] text-[11px] font-bold">
                  No. {String(i + 42).padStart(3, "0")}
                </span>
              </div>
              <div
                className="mt-4 flex items-baseline justify-between gap-3 border-b pb-3"
                style={{ borderColor: `${INK}1A` }}
              >
                <h4 className="font-[family-name:var(--font-bricolage)] text-[20px] font-bold tracking-[-0.03em]">
                  {p.n}
                </h4>
                <span
                  className="font-[family-name:var(--font-bricolage)] text-[17px] font-bold"
                  style={{ color: ULTRA }}
                >
                  {p.p}
                </span>
              </div>
              <div className="mt-2.5 flex justify-between text-[13.5px] text-[#141210]/60">
                <span>{p.c}</span>
                <span className="font-[family-name:var(--font-bricolage)]">{p.s}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ─────────────────────────── COMMISSION BAND */}
      <section id="commission" style={{ background: ULTRA, color: "#fff" }}>
        <div className="mx-auto max-w-[1320px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="font-[family-name:var(--font-bricolage)] text-[11px] font-bold tracking-[0.2em] text-white/60 uppercase">
                Not in the catalogue?
              </div>
              <h3 className="mt-5 font-[family-name:var(--font-bricolage)] text-[clamp(2rem,5.5vw,4rem)] leading-[0.9] font-extrabold tracking-[-0.045em]">
                Then we make it to measure.
              </h3>
              <p className="mt-6 max-w-[50ch] text-[18px] leading-[1.55] text-white/85">
                Describe the business problem to our assistant — in the words you already use.
                It turns the conversation into a brief, our team reviews it, and you get a fixed
                quote before anything is built.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  className="font-[family-name:var(--font-bricolage)] text-[15px] font-semibold"
                  style={{ background: "#fff", color: ULTRA, padding: "14px 28px" }}
                >
                  Commission software
                </button>
                <button
                  className="border border-white/35 font-[family-name:var(--font-bricolage)] text-[15px] font-semibold"
                  style={{ padding: "14px 28px" }}
                >
                  How commissioning works
                </button>
              </div>
            </div>

            <div className="lg:col-span-4 lg:col-start-9">
              <div className="divide-y divide-white/20 border-y border-white/20">
                {[
                  ["01", "Describe it", "20 minutes, conversational"],
                  ["02", "We review", "Technical read within 2 days"],
                  ["03", "Fixed quote", "Scope, exclusions, timeline"],
                  ["04", "Build & deliver", "You test before you accept"],
                ].map(([n, t, s]) => (
                  <div key={n} className="flex gap-5 py-4">
                    <span className="font-[family-name:var(--font-bricolage)] text-[13px] font-bold text-white/45">
                      {n}
                    </span>
                    <div>
                      <div className="font-[family-name:var(--font-bricolage)] text-[16px] font-bold">
                        {t}
                      </div>
                      <div className="mt-0.5 text-[14px] text-white/65">{s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── PRICING TRANSPARENCY */}
      <section id="pricing" className="mx-auto max-w-[1320px] px-5 py-16 lg:px-8 lg:py-24">
        <h3 className="max-w-[22ch] font-[family-name:var(--font-bricolage)] text-[clamp(1.6rem,4vw,2.8rem)] leading-[0.98] font-extrabold tracking-[-0.04em]">
          Everything is priced on the page.
        </h3>
        <p className="mt-4 max-w-[54ch] text-[17px] leading-[1.6] text-[#141210]/70">
          Software, installation and support are separate lines. You always see what you’re
          paying for, and you can take one without the others.
        </p>

        <div
          className="mt-11 grid gap-px border"
          style={{ borderColor: `${INK}1A`, background: `${INK}1A` }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-4">
            {[
              ["Product licence", "£299", "One-off · perpetual"],
              ["Installation", "£99", "We set it up on your server"],
              ["Brand setup", "£49", "Your colours, logo, domain"],
              ["Support, 1 year", "£149", "Updates and fixes included"],
            ].map(([t, p, s]) => (
              <div key={t} className="bg-[#FAF7F0] p-6 lg:p-8">
                <div className="font-[family-name:var(--font-bricolage)] text-[13px] font-semibold tracking-[0.1em] text-[#141210]/50 uppercase">
                  {t}
                </div>
                <div className="mt-3 font-[family-name:var(--font-bricolage)] text-[32px] leading-none font-extrabold tracking-[-0.04em]">
                  {p}
                </div>
                <div className="mt-2 text-[14px] text-[#141210]/60">{s}</div>
              </div>
            ))}
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-4 p-6 lg:p-8"
            style={{ background: INK, color: CREAM }}
          >
            <span className="font-[family-name:var(--font-bricolage)] text-[15px] font-semibold tracking-[0.1em] uppercase">
              Typical total, fully set up
            </span>
            <span className="font-[family-name:var(--font-bricolage)] text-[36px] leading-none font-extrabold tracking-[-0.04em]">
              £596
            </span>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── FOOTER */}
      <footer className="border-t" style={{ borderColor: `${INK}1A` }}>
        <div className="mx-auto max-w-[1320px] px-5 py-14 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="font-[family-name:var(--font-bricolage)] text-[26px] font-extrabold tracking-[-0.05em]">
                INNOVATRIX
              </div>
              <p className="mt-4 max-w-[36ch] text-[15px] leading-[1.6] text-[#141210]/65">
                Find, customise, build, deploy and maintain software. Catalogued since 2026.
              </p>
            </div>
            {[
              ["Catalogue", ["All products", "New this month", "Most adapted", "Starter kits"]],
              ["Services", ["Installation", "Deployment", "Maintenance", "Support"]],
              ["Company", ["About", "Contact", "Terms", "Privacy"]],
            ].map(([h, items]) => (
              <div key={h as string} className="lg:col-span-2">
                <div className="font-[family-name:var(--font-bricolage)] text-[12px] font-bold tracking-[0.14em] text-[#141210]/45 uppercase">
                  {h as string}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {(items as string[]).map((i) => (
                    <li key={i}>
                      <a
                        className="text-[14.5px] text-[#141210]/70 hover:text-[#1B1AFF]"
                        href="#"
                      >
                        {i}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="mt-12 flex flex-col gap-2 border-t pt-5 font-[family-name:var(--font-bricolage)] text-[12px] tracking-[0.14em] text-[#141210]/40 uppercase sm:flex-row sm:justify-between"
            style={{ borderColor: `${INK}1A` }}
          >
            <span>© 2026 Innovatrix Ltd</span>
            <span>Concept 03 — Catalogue</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
