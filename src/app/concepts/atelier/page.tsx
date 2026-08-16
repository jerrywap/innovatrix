/* eslint-disable @next/next/no-img-element */
import { PHOTO, u } from "../_lib/img";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const STONE = "#EDE8E1";
const ESPRESSO = "#241D18";
const BRASS = "#B08D57";
const PAPER = "#FBFAF8";

const WORK = [
  {
    no: "I",
    client: "Brightpath Care",
    sector: "Care agency · 40 staff",
    title: "From spreadsheets to a rota that runs itself",
    body: "Shift scheduling, visit assignment and timesheets, adapted from an existing product in nine weeks rather than built from nothing in nine months.",
    img: PHOTO.teamMeeting,
    meta: ["Adapted from Roster", "9 weeks", "Hosted by us"],
  },
  {
    no: "II",
    client: "Halcyon Estates",
    sector: "Property · 150 units",
    title: "A CRM that finally understood landlords",
    body: "Atlas CRM reshaped around properties, landlords and tenants, with rent reminders and a tenant portal. The base product carried 70% of the work.",
    img: PHOTO.property,
    meta: ["Adapted from Atlas CRM", "6 weeks", "Self-hosted"],
  },
  {
    no: "III",
    client: "Meridian Freight",
    sector: "Logistics · 12 depots",
    title: "Commissioned from a blank page",
    body: "Nothing in the catalogue came close, so we built it. Driver tracking, depot handovers and customer notifications, delivered in three milestones.",
    img: PHOTO.logistics,
    meta: ["Custom build", "18 weeks", "Managed"],
  },
];

const CHAPTERS = [
  [
    "Conversation",
    "We start with what the business needs to do — not with technology. Twenty minutes, in your own words.",
  ],
  [
    "Assessment",
    "Our technical team reads the brief and tells you honestly whether something we already own gets you most of the way.",
  ],
  [
    "Proposal",
    "A fixed quote with scope, deliverables and — the part most people omit — explicit exclusions.",
  ],
  [
    "Craft",
    "We build, you watch. Versioned, reviewed, and shown to you before it is called finished.",
  ],
  [
    "Custody",
    "Installation, support, updates and maintenance. The relationship continues long after the invoice.",
  ],
];

export default function Atelier() {
  return (
    <main
      className="min-h-screen font-[family-name:var(--font-manrope)] antialiased"
      style={{ background: PAPER, color: ESPRESSO }}
    >
      {/* ─────────────────────────── HERO */}
      <section
        className="relative min-h-[92vh] overflow-hidden"
        style={{ background: ESPRESSO }}
      >
        <img
          src={u(PHOTO.officeCalm, 2400)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(36,29,24,0.75) 0%, rgba(36,29,24,0.35) 35%, rgba(36,29,24,0.9) 100%)",
          }}
        />

        {/* nav */}
        <header className="relative z-20">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-6 lg:px-10 lg:py-8">
            <div
              className="font-[family-name:var(--font-instrument-serif)] text-[24px] tracking-[-0.01em]"
              style={{ color: STONE }}
            >
              Innovatrix
            </div>
            <nav
              className="hidden items-center gap-10 text-[12px] tracking-[0.16em] uppercase md:flex"
              style={{ color: `${STONE}B3` }}
            >
              <a className="transition hover:text-white" href="#work">
                Work
              </a>
              <a className="transition hover:text-white" href="#process">
                Process
              </a>
              <a className="transition hover:text-white" href="#ready">
                Ready-made
              </a>
              <a className="transition hover:text-white" href="#contact">
                Contact
              </a>
            </nav>
            <button
              className="border px-5 py-2.5 text-[12px] tracking-[0.14em] uppercase transition hover:bg-white hover:text-[#241D18]"
              style={{ borderColor: `${STONE}59`, color: STONE }}
            >
              Enquire
            </button>
          </div>
        </header>

        {/* statement */}
        <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col justify-end px-5 pt-24 pb-16 lg:px-10 lg:pt-40 lg:pb-24">
          <div className="text-[11px] tracking-[0.28em] uppercase" style={{ color: BRASS }}>
            Software, commissioned
          </div>
          <h1
            className="mt-7 max-w-[19ch] font-[family-name:var(--font-instrument-serif)] text-[clamp(2.8rem,9vw,7rem)] leading-[0.95] tracking-[-0.02em]"
            style={{ color: STONE }}
          >
            We find it, shape it,
            <br />
            build it and <em style={{ color: BRASS }}>keep it</em> running.
          </h1>
          <p
            className="mt-9 max-w-[54ch] text-[17px] leading-[1.7] lg:text-[19px]"
            style={{ color: `${STONE}BF` }}
          >
            A practice, not a shop. Some clients buy something we have already made. Some have
            it altered. Some commission it outright. All of them leave with software that is
            theirs.
          </p>
          <div className="mt-11 flex flex-wrap gap-4">
            <button
              className="px-8 py-4 text-[13px] tracking-[0.14em] uppercase transition hover:opacity-85"
              style={{ background: STONE, color: ESPRESSO }}
            >
              Begin a conversation
            </button>
            <button
              className="border px-8 py-4 text-[13px] tracking-[0.14em] uppercase transition hover:bg-white/10"
              style={{ borderColor: `${STONE}59`, color: STONE }}
            >
              See selected work
            </button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── MANIFESTO */}
      <section className="px-5 py-24 lg:px-10 lg:py-40">
        <div className="mx-auto max-w-[900px] text-center">
          <div className="text-[11px] tracking-[0.28em] uppercase" style={{ color: BRASS }}>
            The premise
          </div>
          <p className="mt-9 font-[family-name:var(--font-instrument-serif)] text-[clamp(1.6rem,4.5vw,3.1rem)] leading-[1.28] tracking-[-0.015em]">
            Most companies do not want a folder of code. They want the thing working on a
            Tuesday morning, with someone to call when it isn’t.{" "}
            <em style={{ color: BRASS }}>
              That gap — between buying software and having software — is the whole of our work.
            </em>
          </p>
          <div className="mx-auto mt-12 h-px w-24" style={{ background: `${ESPRESSO}33` }} />
          <div className="mt-8 grid gap-8 text-left sm:grid-cols-3">
            {[
              ["148", "products in the catalogue, all demoable"],
              ["31", "industries we have delivered into"],
              ["2026", "the year we stopped calling it a marketplace"],
            ].map(([v, l]) => (
              <div key={l}>
                <div
                  className="font-[family-name:var(--font-instrument-serif)] text-[40px] leading-none"
                  style={{ color: BRASS }}
                >
                  {v}
                </div>
                <div
                  className="mt-3 text-[14px] leading-relaxed"
                  style={{ color: `${ESPRESSO}A6` }}
                >
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── SELECTED WORK */}
      <section id="work" style={{ background: STONE }}>
        <div className="mx-auto max-w-[1280px] px-5 py-20 lg:px-10 lg:py-32">
          <div
            className="flex flex-wrap items-end justify-between gap-6 border-b pb-7"
            style={{ borderColor: `${ESPRESSO}26` }}
          >
            <h2 className="font-[family-name:var(--font-instrument-serif)] text-[clamp(2rem,5vw,3.6rem)] leading-[1] tracking-[-0.02em]">
              Selected work
            </h2>
            <span
              className="text-[11px] tracking-[0.2em] uppercase"
              style={{ color: `${ESPRESSO}80` }}
            >
              2025 — 2026
            </span>
          </div>

          <div className="mt-16 space-y-24 lg:space-y-32">
            {WORK.map((w, i) => (
              <article
                key={w.client}
                className={`grid items-center gap-10 lg:grid-cols-12 lg:gap-16 ${
                  i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div className="lg:col-span-7">
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#d6cec2] lg:aspect-[16/11]">
                    <img
                      src={u(w.img, 1400)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-700 hover:scale-[1.03]"
                    />
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="flex items-baseline gap-5">
                    <span
                      className="font-[family-name:var(--font-instrument-serif)] text-[28px] italic"
                      style={{ color: BRASS }}
                    >
                      {w.no}
                    </span>
                    <div
                      className="text-[11px] tracking-[0.2em] uppercase"
                      style={{ color: `${ESPRESSO}80` }}
                    >
                      {w.client} — {w.sector}
                    </div>
                  </div>

                  <h3 className="mt-6 font-[family-name:var(--font-instrument-serif)] text-[clamp(1.5rem,3.2vw,2.4rem)] leading-[1.16] tracking-[-0.015em]">
                    {w.title}
                  </h3>
                  <p
                    className="mt-5 text-[16px] leading-[1.72]"
                    style={{ color: `${ESPRESSO}B3` }}
                  >
                    {w.body}
                  </p>

                  <div
                    className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t pt-5"
                    style={{ borderColor: `${ESPRESSO}26` }}
                  >
                    {w.meta.map((m) => (
                      <span
                        key={m}
                        className="text-[12.5px] tracking-[0.12em] uppercase"
                        style={{ color: `${ESPRESSO}8C` }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── PROCESS */}
      <section id="process" className="px-5 py-20 lg:px-10 lg:py-32">
        <div className="mx-auto max-w-[1280px]">
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <div className="text-[11px] tracking-[0.28em] uppercase" style={{ color: BRASS }}>
                How we work
              </div>
              <h2 className="mt-6 font-[family-name:var(--font-instrument-serif)] text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.04] tracking-[-0.02em]">
                Five chapters, every time.
              </h2>
              <p
                className="mt-6 max-w-[38ch] text-[16px] leading-[1.7]"
                style={{ color: `${ESPRESSO}A6` }}
              >
                Whether you spend three hundred pounds or thirty thousand, the sequence does not
                change. Only its length does.
              </p>
            </div>

            <div className="lg:col-span-7 lg:col-start-6">
              {CHAPTERS.map(([t, b], i) => (
                <div
                  key={t}
                  className="grid grid-cols-[auto_1fr] gap-6 border-t py-8 lg:gap-10"
                  style={{ borderColor: `${ESPRESSO}26` }}
                >
                  <span
                    className="font-[family-name:var(--font-instrument-serif)] text-[20px] italic"
                    style={{ color: BRASS }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-[family-name:var(--font-instrument-serif)] text-[clamp(1.25rem,2.4vw,1.75rem)] tracking-[-0.01em]">
                      {t}
                    </h3>
                    <p
                      className="mt-3 text-[15.5px] leading-[1.72]"
                      style={{ color: `${ESPRESSO}A6` }}
                    >
                      {b}
                    </p>
                  </div>
                </div>
              ))}
              <div className="border-t" style={{ borderColor: `${ESPRESSO}26` }} />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── READY-MADE */}
      <section id="ready" style={{ background: ESPRESSO, color: STONE }}>
        <div className="mx-auto max-w-[1280px] px-5 py-20 lg:px-10 lg:py-32">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="text-[11px] tracking-[0.28em] uppercase" style={{ color: BRASS }}>
                Ready-made
              </div>
              <h2 className="mt-6 font-[family-name:var(--font-instrument-serif)] text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.04] tracking-[-0.02em]">
                Not everything needs commissioning.
              </h2>
              <p
                className="mt-6 max-w-[42ch] text-[16px] leading-[1.72]"
                style={{ color: `${STONE}A6` }}
              >
                One hundred and forty-eight finished systems, each with a live demo and a
                published price. If one of them is already right, we will tell you — even when
                building would pay us better.
              </p>
              <a
                href="#"
                className="mt-9 inline-block border-b pb-1 text-[13px] tracking-[0.16em] uppercase transition hover:opacity-70"
                style={{ borderColor: BRASS, color: BRASS }}
              >
                Enter the catalogue →
              </a>
            </div>

            <div className="grid gap-5 sm:grid-cols-3 lg:col-span-6 lg:col-start-7">
              {[
                { n: "Atlas CRM", p: "£299", img: PHOTO.dashboard },
                { n: "Tenancy", p: "£450", img: PHOTO.deskMinimal },
                { n: "Roster", p: "£380", img: PHOTO.notesMeeting },
              ].map((p) => (
                <article key={p.n} className="group">
                  <div className="relative aspect-[3/4] overflow-hidden bg-[#3a2f27]">
                    <img
                      src={u(p.img, 700)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover opacity-70 transition duration-700 group-hover:scale-[1.05] group-hover:opacity-100"
                    />
                  </div>
                  <div
                    className="mt-4 flex items-baseline justify-between border-t pt-3"
                    style={{ borderColor: `${STONE}26` }}
                  >
                    <span className="font-[family-name:var(--font-instrument-serif)] text-[19px]">
                      {p.n}
                    </span>
                    <span className="text-[13px]" style={{ color: BRASS }}>
                      {p.p}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── TESTIMONIAL */}
      <section className="px-5 py-24 lg:px-10 lg:py-36" style={{ background: STONE }}>
        <div className="mx-auto max-w-[880px] text-center">
          <blockquote className="font-[family-name:var(--font-instrument-serif)] text-[clamp(1.5rem,4vw,2.75rem)] leading-[1.32] tracking-[-0.015em]">
            “They talked me out of a custom build and into a product they already owned. It cost
            a fifth of what I had budgeted.{" "}
            <em style={{ color: BRASS }}>That is why we went back to them twice.</em>”
          </blockquote>
          <div className="mt-10 flex items-center justify-center gap-4">
            <div className="h-12 w-12 overflow-hidden rounded-full bg-[#d6cec2]">
              <img
                src={u(PHOTO.p2, 200)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="text-left">
              <div className="text-[14.5px] font-semibold">Daniel Osei</div>
              <div className="text-[13px]" style={{ color: `${ESPRESSO}99` }}>
                Managing Director, Halcyon Estates
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── CONTACT */}
      <section
        id="contact"
        className="relative overflow-hidden"
        style={{ background: ESPRESSO }}
      >
        <img
          src={u(PHOTO.coworking, 2000)}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
        <div className="relative mx-auto max-w-[1280px] px-5 py-24 text-center lg:px-10 lg:py-36">
          <div className="text-[11px] tracking-[0.28em] uppercase" style={{ color: BRASS }}>
            Begin
          </div>
          <h2
            className="mx-auto mt-7 max-w-[18ch] font-[family-name:var(--font-instrument-serif)] text-[clamp(2.2rem,7vw,5rem)] leading-[1.0] tracking-[-0.02em]"
            style={{ color: STONE }}
          >
            Tell us what it needs to <em style={{ color: BRASS }}>do</em>.
          </h2>
          <p
            className="mx-auto mt-7 max-w-[46ch] text-[17px] leading-[1.7]"
            style={{ color: `${STONE}A6` }}
          >
            Twenty minutes, in your own words. No brief to write, no technical vocabulary
            required, no obligation at the end of it.
          </p>
          <div className="mt-11 flex flex-wrap justify-center gap-4">
            <button
              className="px-9 py-4 text-[13px] tracking-[0.14em] uppercase transition hover:opacity-85"
              style={{ background: STONE, color: ESPRESSO }}
            >
              Start a conversation
            </button>
            <button
              className="border px-9 py-4 text-[13px] tracking-[0.14em] uppercase transition hover:bg-white/10"
              style={{ borderColor: `${STONE}59`, color: STONE }}
            >
              Browse the catalogue
            </button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── FOOTER */}
      <footer style={{ background: ESPRESSO, color: `${STONE}A6` }}>
        <div
          className="mx-auto max-w-[1280px] border-t px-5 py-14 lg:px-10"
          style={{ borderColor: `${STONE}1F` }}
        >
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div
                className="font-[family-name:var(--font-instrument-serif)] text-[22px]"
                style={{ color: STONE }}
              >
                Innovatrix
              </div>
              <p className="mt-4 max-w-[30ch] text-[14px] leading-relaxed">
                Software found, shaped, built and kept running.
              </p>
            </div>
            {[
              ["Practice", ["Selected work", "Process", "Services", "Contact"]],
              ["Catalogue", ["All products", "Demos", "Licensing", "Support"]],
              ["Legal", ["Terms", "Privacy", "Licences", "Security"]],
            ].map(([h, items]) => (
              <div key={h as string}>
                <div
                  className="text-[11px] tracking-[0.18em] uppercase"
                  style={{ color: BRASS }}
                >
                  {h as string}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {(items as string[]).map((i) => (
                    <li key={i}>
                      <a className="text-[14px] transition hover:text-white" href="#">
                        {i}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="mt-12 flex flex-col gap-2 border-t pt-6 text-[12px] tracking-[0.14em] uppercase sm:flex-row sm:justify-between"
            style={{ borderColor: `${STONE}1F` }}
          >
            <span>© 2026 Innovatrix Ltd</span>
            <span>Concept 05 — Atelier</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
