/* eslint-disable @next/next/no-img-element */
import { PHOTO, u } from "../_lib/img";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const CREAM = "#FBF8F3";
const FOREST = "#1C3A30";
const CLAY = "#C56A45";
const SAGE = "#9FB8A4";

const PROMPTS = [
  "I need to manage bookings for my clinic",
  "Something to track my delivery drivers",
  "A CRM, but for a property agency",
  "Rota and timesheets for 40 carers",
  "An online shop that talks to my stockroom",
];

const STARTS = [
  {
    tag: "You know what you want",
    quote: "“I need a Laravel CRM script.”",
    body: "Straight to the marketplace. Filter by stack, licence and price. Try the live demo before you spend anything.",
    tone: FOREST,
    bg: "#EEF2ED",
  },
  {
    tag: "You know the outcome",
    quote: "“I need software to manage my cleaning company.”",
    body: "Talk it through with our assistant. It asks about the business, not the technology, and turns the answers into a real brief.",
    tone: CLAY,
    bg: "#F7EBE4",
  },
  {
    tag: "You’re halfway there",
    quote: "“This is almost right, but…”",
    body: "Pick the closest product and tell us what to change. You get a quote against a fixed starting point, not a blank page.",
    tone: "#6C7F8C",
    bg: "#EAEFF2",
  },
];

export default function Dialogue() {
  return (
    <main
      className="min-h-screen font-[family-name:var(--font-dm-sans)] antialiased"
      style={{ background: CREAM, color: FOREST }}
    >
      {/* ─────────────────────────── NAV */}
      <header className="sticky top-0 z-50 border-b border-[#1C3A30]/8 bg-[#FBF8F3]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold text-white"
              style={{ background: FOREST }}
            >
              i
            </span>
            <span className="font-[family-name:var(--font-fraunces)] text-[19px] font-semibold tracking-[-0.02em]">
              Innovatrix
            </span>
          </div>
          <nav className="hidden items-center gap-8 text-[14px] text-[#1C3A30]/65 md:flex">
            <a className="transition hover:text-[#1C3A30]" href="#start">
              How it starts
            </a>
            <a className="transition hover:text-[#1C3A30]" href="#assistant">
              The assistant
            </a>
            <a className="transition hover:text-[#1C3A30]" href="#ready">
              Ready-made
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <button className="hidden text-[14px] text-[#1C3A30]/65 transition hover:text-[#1C3A30] sm:block">
              Sign in
            </button>
            <button
              className="rounded-full px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
              style={{ background: FOREST }}
            >
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* ─────────────────────────── HERO */}
      <section className="relative overflow-hidden px-5 pt-16 pb-20 lg:px-8 lg:pt-24 lg:pb-28">
        {/* organic background shapes */}
        <div
          className="pointer-events-none absolute -top-32 -right-40 h-[520px] w-[520px] rounded-full opacity-[0.55] blur-3xl"
          style={{ background: `radial-gradient(circle, ${SAGE}, transparent 70%)` }}
        />
        <div
          className="pointer-events-none absolute top-64 -left-52 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: `radial-gradient(circle, ${CLAY}, transparent 70%)` }}
        />

        <div className="relative mx-auto max-w-3xl text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[12.5px] font-medium"
            style={{ borderColor: `${FOREST}1F`, color: `${FOREST}A6` }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: CLAY }}
            />
            No forms. No spec document. Just a conversation.
          </div>

          <h1 className="mt-7 font-[family-name:var(--font-fraunces)] text-[clamp(2.4rem,7.5vw,5rem)] leading-[1.02] font-semibold tracking-[-0.035em]">
            What should your
            <br />
            software{" "}
            <span className="relative inline-block">
              <span style={{ color: CLAY }}>actually do</span>
              <svg
                className="absolute -bottom-1 left-0 w-full"
                height="10"
                viewBox="0 0 200 10"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d="M2 7C40 2 80 2 120 5s60 3 78 1"
                  stroke={CLAY}
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.45"
                />
              </svg>
            </span>
            ?
          </h1>

          <p className="mx-auto mt-7 max-w-[52ch] text-[17px] leading-[1.65] text-[#1C3A30]/70 lg:text-[19px]">
            Tell us in plain English. We’ll find what already exists, adapt it if it’s close, or
            build it if it isn’t — then install it, support it and keep it running.
          </p>

          {/* the "live" input */}
          <div className="mx-auto mt-10 max-w-2xl">
            <div
              className="flex flex-col gap-3 rounded-[26px] border bg-white p-3 text-left shadow-[0_18px_50px_-16px_rgba(28,58,48,0.28)] sm:flex-row sm:items-center sm:rounded-full sm:p-2.5 sm:pl-6"
              style={{ borderColor: `${FOREST}14` }}
            >
              <div className="flex flex-1 items-center gap-3 px-3 sm:px-0">
                <span
                  className="hidden h-2 w-2 shrink-0 animate-pulse rounded-full sm:block"
                  style={{ background: CLAY }}
                />
                <span className="text-[16px] text-[#1C3A30]/45">
                  I need software to manage
                  <span
                    className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse"
                    style={{ background: FOREST }}
                  />
                </span>
              </div>
              <button
                className="shrink-0 rounded-full px-7 py-3.5 text-[15px] font-medium text-white transition hover:opacity-90"
                style={{ background: FOREST }}
              >
                Start talking →
              </button>
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  className="rounded-full border bg-white/70 px-3.5 py-2 text-[13px] text-[#1C3A30]/70 transition hover:bg-white hover:shadow-sm"
                  style={{ borderColor: `${FOREST}14` }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-8 text-[13px] text-[#1C3A30]/45">
            Or{" "}
            <a
              href="#ready"
              className="underline decoration-1 underline-offset-4 hover:text-[#1C3A30]"
            >
              browse 148 products we’ve already built
            </a>
          </p>
        </div>
      </section>

      {/* ─────────────────────────── THREE STARTS */}
      <section id="start" className="px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-[18ch] font-[family-name:var(--font-fraunces)] text-[clamp(1.75rem,4.5vw,3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
            People arrive knowing very different amounts.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[16px] leading-relaxed text-[#1C3A30]/65">
            That’s fine. All three of these end up in the same place — a system that’s yours,
            installed and supported.
          </p>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STARTS.map((s) => (
              <article
                key={s.tag}
                className="group flex flex-col rounded-[24px] p-7 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_rgba(28,58,48,0.3)] lg:p-8"
                style={{ background: s.bg }}
              >
                <div
                  className="text-[12px] font-semibold tracking-[0.1em] uppercase"
                  style={{ color: s.tone }}
                >
                  {s.tag}
                </div>
                <p className="mt-5 font-[family-name:var(--font-fraunces)] text-[21px] leading-[1.3] tracking-[-0.02em] lg:text-[23px]">
                  {s.quote}
                </p>
                <p className="mt-4 flex-1 text-[14.5px] leading-[1.6] text-[#1C3A30]/65">
                  {s.body}
                </p>
                <div
                  className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium transition-transform group-hover:translate-x-1"
                  style={{ color: s.tone }}
                >
                  Start here →
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── ASSISTANT */}
      <section id="assistant" className="px-5 py-16 lg:px-8 lg:py-24">
        <div
          className="mx-auto max-w-6xl overflow-hidden rounded-[32px] px-6 py-14 lg:px-14 lg:py-20"
          style={{ background: FOREST, color: CREAM }}
        >
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div
                className="text-[12px] font-semibold tracking-[0.14em] uppercase"
                style={{ color: SAGE }}
              >
                The assistant
              </div>
              <h2 className="mt-4 font-[family-name:var(--font-fraunces)] text-[clamp(1.8rem,4.5vw,3rem)] leading-[1.06] font-semibold tracking-[-0.03em]">
                It asks one good question at a time.
              </h2>
              <p className="mt-5 max-w-[46ch] text-[16px] leading-[1.7] text-white/65">
                Not forty fields on one screen. It listens, suggests what’s usually needed for a
                business like yours, and shows you a summary you can edit before a single person
                at Innovatrix reads it.
              </p>

              <div className="mt-9 space-y-4">
                {[
                  [
                    "Plain language only",
                    "No stack, no schema, no jargon unless you raise it.",
                  ],
                  [
                    "Nothing is assumed silently",
                    "Anything it inferred is labelled, so you can strike it.",
                  ],
                  ["It won’t price your job", "Pricing is a person’s decision. Always."],
                ].map(([t, b]) => (
                  <div key={t} className="flex gap-4">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: SAGE }}
                    />
                    <div>
                      <div className="text-[15px] font-medium">{t}</div>
                      <div className="mt-0.5 text-[14px] text-white/55">{b}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* chat */}
            <div className="space-y-3.5">
              {[
                { who: "ai", text: "What are you trying to achieve?" },
                {
                  who: "you",
                  text: "I run a care agency. Everything’s on spreadsheets and it’s falling apart.",
                },
                {
                  who: "ai",
                  text: "That’s a common place to start. Is the bigger pain scheduling staff, or keeping client records straight?",
                },
                { who: "you", text: "Scheduling, mostly. And timesheets." },
                {
                  who: "ai",
                  text: "Got it. Agencies your size usually also want staff mobile access and automatic timesheet totals. Shall I include those?",
                },
              ].map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.who === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] rounded-[20px] px-5 py-3.5 text-[15px] leading-[1.55] ${
                      m.who === "ai"
                        ? "rounded-tl-md bg-white text-[#1C3A30]"
                        : "rounded-tr-md text-white"
                    }`}
                    style={
                      m.who === "you" ? { background: "rgba(255,255,255,0.13)" } : undefined
                    }
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-3 pl-1">
                {["Yes, both", "Just timesheets", "Tell me more"].map((c) => (
                  <button
                    key={c}
                    className="rounded-full border border-white/25 px-4 py-2 text-[13.5px] text-white/80 transition hover:bg-white/10"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── READY-MADE */}
      <section id="ready" className="px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <h2 className="max-w-[20ch] font-[family-name:var(--font-fraunces)] text-[clamp(1.75rem,4.5vw,3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
                Sometimes we already built it.
              </h2>
              <p className="mt-3 max-w-[50ch] text-[16px] text-[#1C3A30]/65">
                If something in the marketplace covers most of it, we’ll say so — even when a
                custom build would earn us more.
              </p>
            </div>
            <a
              href="#"
              className="rounded-full border px-5 py-2.5 text-[14px] font-medium transition hover:bg-white"
              style={{ borderColor: `${FOREST}22` }}
            >
              Browse all →
            </a>
          </div>

          <div className="mt-11 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                n: "Roster",
                d: "Shift scheduling & timesheets for care agencies",
                p: "From £380",
                img: PHOTO.teamMeeting,
                t: "Care & HR",
              },
              {
                n: "Tenancy",
                d: "Listings, landlords, tenants and rent reminders",
                p: "From £450",
                img: PHOTO.property,
                t: "Property",
              },
              {
                n: "Bookline",
                d: "Appointments, reminders and deposits",
                p: "From £290",
                img: PHOTO.hospitality,
                t: "Booking",
              },
            ].map((p) => (
              <article
                key={p.n}
                className="group overflow-hidden rounded-[24px] bg-white transition hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_rgba(28,58,48,0.28)]"
              >
                <div
                  className="relative aspect-[16/10] overflow-hidden"
                  style={{ background: SAGE }}
                >
                  <img
                    src={u(p.img, 800)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
                  />
                  <span className="absolute top-3 left-3 rounded-full bg-white/95 px-3 py-1 text-[11.5px] font-medium">
                    {p.t}
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="font-[family-name:var(--font-fraunces)] text-[20px] font-semibold tracking-[-0.02em]">
                    {p.n}
                  </h3>
                  <p className="mt-2 text-[14.5px] leading-[1.55] text-[#1C3A30]/60">{p.d}</p>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-[14px] font-medium">{p.p}</span>
                    <span className="text-[13px] text-[#1C3A30]/45 transition group-hover:text-[#1C3A30]">
                      Try the demo →
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── TESTIMONIAL */}
      <section className="px-5 py-16 lg:px-8 lg:py-24">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[auto_1fr] md:gap-14">
          <div
            className="relative mx-auto h-40 w-40 shrink-0 overflow-hidden rounded-full md:h-52 md:w-52"
            style={{ background: SAGE }}
          >
            <img
              src={u(PHOTO.p1, 500)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <blockquote className="font-[family-name:var(--font-fraunces)] text-[clamp(1.35rem,3.2vw,2.1rem)] leading-[1.32] font-medium tracking-[-0.02em]">
              “I described the problem the way I’d describe it to a colleague. Four days later I
              had a quote that actually matched what I meant.”
            </blockquote>
            <div className="mt-6 text-[14.5px]">
              <div className="font-semibold">Amara Okonjo</div>
              <div className="text-[#1C3A30]/55">Director, Brightpath Care · 40 staff</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── CTA */}
      <section className="px-5 pb-20 lg:px-8">
        <div
          className="mx-auto max-w-6xl rounded-[32px] px-6 py-16 text-center lg:py-24"
          style={{ background: CLAY, color: "#FFF9F5" }}
        >
          <h2 className="mx-auto max-w-[20ch] font-[family-name:var(--font-fraunces)] text-[clamp(1.9rem,5.5vw,3.6rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
            Start with a sentence. We’ll take it from there.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[16.5px] leading-[1.6] text-white/80">
            No commitment, no card, no sales call until you ask for one.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              className="rounded-full px-8 py-4 text-[15px] font-medium transition hover:opacity-90"
              style={{ background: "#FFF9F5", color: CLAY }}
            >
              Describe what you need
            </button>
            <button className="rounded-full border border-white/35 px-8 py-4 text-[15px] font-medium transition hover:bg-white/10">
              Browse the marketplace
            </button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── FOOTER */}
      <footer className="px-5 pb-12 lg:px-8">
        <div
          className="mx-auto max-w-6xl border-t pt-10"
          style={{ borderColor: `${FOREST}14` }}
        >
          <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="font-[family-name:var(--font-fraunces)] text-[19px] font-semibold tracking-[-0.02em]">
                Innovatrix
              </div>
              <p className="mt-3 max-w-[30ch] text-[13.5px] leading-relaxed text-[#1C3A30]/55">
                Find, customise, build, deploy and maintain software.
              </p>
            </div>
            {[
              ["Platform", ["Marketplace", "Custom build", "Services"]],
              ["Company", ["About", "Work", "Contact"]],
              ["Legal", ["Terms", "Privacy", "Licences"]],
            ].map(([h, items]) => (
              <div key={h as string}>
                <div className="text-[13px] font-semibold">{h as string}</div>
                <ul className="mt-3.5 space-y-2.5">
                  {(items as string[]).map((i) => (
                    <li key={i}>
                      <a
                        className="text-[13.5px] text-[#1C3A30]/60 hover:text-[#1C3A30]"
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
          <div className="mt-10 flex flex-col gap-2 text-[12.5px] text-[#1C3A30]/40 sm:flex-row sm:justify-between">
            <span>© 2026 Innovatrix Ltd</span>
            <span>Concept 02 — Dialogue</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
