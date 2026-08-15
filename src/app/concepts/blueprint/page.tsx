/* eslint-disable @next/next/no-img-element */
import { PHOTO, u } from "../_lib/img";

const BLACK = "#08090B";
const PANEL = "#0E1116";
const CYAN = "#22D3EE";
const LIME = "#A3E635";
const TEXT = "#E6E9EE";

const grid = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
  backgroundSize: "64px 64px",
};

const PIPELINE = [
  { k: "INTAKE", v: "Requirements captured", d: "conversational · structured output" },
  { k: "REVIEW", v: "Technical assessment", d: "feasibility · effort · risk" },
  { k: "QUOTE", v: "Fixed scope issued", d: "deliverables · exclusions · terms" },
  { k: "BUILD", v: "Implementation", d: "versioned · reviewed · tested" },
  { k: "DELIVER", v: "Deploy & handover", d: "signed artefacts · licence issued" },
  { k: "OPERATE", v: "Support & maintain", d: "SLA · updates · monitoring" },
];

const SPEC = [
  ["Source package", "Full source, no obfuscation, no phone-home", "included"],
  ["Licence", "Perpetual, per installation, transferable", "included"],
  ["Deployment", "Docker compose + bare-metal runbook", "included"],
  ["Documentation", "Install, configure, API reference, ERD", "included"],
  ["Updates", "12 months of releases from purchase", "included"],
  ["Support", "Business-hours, 1 business day first response", "included"],
  ["Installation service", "We deploy it to your infrastructure", "£99"],
  ["Managed hosting", "We run it, patch it and back it up", "from £45/mo"],
];

const MODULES = [
  {
    n: "atlas-crm",
    v: "2.4.1",
    stack: ["Laravel 11", "PostgreSQL 16", "Redis"],
    img: PHOTO.dashboard,
    load: "~1.2k req/s",
  },
  {
    n: "tenancy",
    v: "1.9.0",
    stack: ["Next.js 16", "MongoDB 7", "S3"],
    img: PHOTO.property,
    load: "~900 req/s",
  },
  {
    n: "freightline",
    v: "3.1.2",
    stack: ["Laravel 11", "MySQL 8", "Queue"],
    img: PHOTO.logistics,
    load: "~2.4k req/s",
  },
];

export default function Blueprint() {
  return (
    <main
      className="min-h-screen font-[family-name:var(--font-plex-sans)] antialiased"
      style={{ background: BLACK, color: TEXT }}
    >
      {/* ─────────────────────────── NAV */}
      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#08090B]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3.5 lg:px-8">
          <div className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="21" height="21" stroke={CYAN} strokeWidth="1.4" />
              <path
                d="M1.5 8.5h21M1.5 15.5h21M8.5 1.5v21M15.5 1.5v21"
                stroke={CYAN}
                strokeWidth="0.7"
                opacity="0.5"
              />
            </svg>
            <span className="font-[family-name:var(--font-plex-mono)] text-[14px] font-semibold tracking-[-0.01em]">
              innovatrix
            </span>
          </div>
          <nav className="hidden items-center gap-7 font-[family-name:var(--font-plex-mono)] text-[12px] text-white/55 md:flex">
            <a className="hover:text-white" href="#pipeline">
              /pipeline
            </a>
            <a className="hover:text-white" href="#spec">
              /spec
            </a>
            <a className="hover:text-white" href="#modules">
              /modules
            </a>
            <a className="hover:text-white" href="#compiler">
              /compiler
            </a>
            <a className="hover:text-white" href="#sla">
              /sla
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/45 sm:flex">
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ background: LIME }}
              />
              all systems operational
            </span>
            <button
              className="font-[family-name:var(--font-plex-mono)] text-[12px] font-semibold text-black"
              style={{ background: CYAN, padding: "9px 16px" }}
            >
              start_build()
            </button>
          </div>
        </div>
      </header>

      {/* ─────────────────────────── HERO */}
      <section className="relative overflow-hidden border-b border-white/8" style={grid}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(900px 500px at 70% 0%, ${CYAN}14, transparent 70%)`,
          }}
        />
        <div className="relative mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 border border-white/12 px-3 py-1.5 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/60">
                <span style={{ color: LIME }}>●</span> spec v2026.1 — software acquisition &amp;
                delivery
              </div>

              <h1 className="mt-7 text-[clamp(2.3rem,6.5vw,4.75rem)] leading-[0.98] font-semibold tracking-[-0.035em]">
                Software delivery,
                <br />
                <span style={{ color: CYAN }}>specified</span> before it’s
                <br />
                ever written.
              </h1>

              <p className="mt-7 max-w-[56ch] text-[17px] leading-[1.65] text-white/65">
                Requirements become a versioned document. Quotes carry exclusions. Builds ship
                with source, runbook and ERD. Nothing about your system is a verbal agreement.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  className="font-[family-name:var(--font-plex-mono)] text-[13px] font-semibold text-black"
                  style={{ background: CYAN, padding: "14px 26px" }}
                >
                  ./describe-requirements
                </button>
                <button
                  className="border border-white/20 font-[family-name:var(--font-plex-mono)] text-[13px] font-semibold transition hover:border-white/45"
                  style={{ padding: "14px 26px" }}
                >
                  ./browse-modules
                </button>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-px border border-white/10 sm:grid-cols-4">
                {[
                  ["148", "modules"],
                  ["99.1%", "sla met"],
                  ["4.2d", "median quote"],
                  ["0", "vendor lock-in"],
                ].map(([v, k]) => (
                  <div key={k} className="bg-[#0E1116] px-4 py-3.5">
                    <div
                      className="font-[family-name:var(--font-plex-mono)] text-[20px] font-semibold"
                      style={{ color: LIME }}
                    >
                      {v}
                    </div>
                    <div className="mt-0.5 font-[family-name:var(--font-plex-mono)] text-[10px] tracking-[0.14em] text-white/40 uppercase">
                      {k}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* annotated schematic */}
            <div className="lg:col-span-5">
              <div className="relative border border-white/12 bg-[#0E1116] p-5 lg:p-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-3 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/45">
                  <span>system.topology</span>
                  <span style={{ color: CYAN }}>fig. 01</span>
                </div>

                <div className="space-y-2.5 pt-5">
                  {[
                    { l: "Public site & marketplace", c: CYAN },
                    { l: "Customer portal", c: CYAN },
                    { l: "Operations portal", c: "#8B95A5" },
                    { l: "Admin & catalogue", c: "#8B95A5" },
                  ].map((r) => (
                    <div
                      key={r.l}
                      className="flex items-center justify-between border border-white/10 px-3.5 py-2.5 text-[13px]"
                      style={{ background: "rgba(255,255,255,0.02)" }}
                    >
                      <span>{r.l}</span>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.c }} />
                    </div>
                  ))}

                  <div className="py-2 text-center font-[family-name:var(--font-plex-mono)] text-[11px] text-white/30">
                    ↓ domain layer ↓
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-[family-name:var(--font-plex-mono)] text-[11px]">
                    {[
                      "identity",
                      "marketplace",
                      "commerce",
                      "requirements",
                      "requests",
                      "billing",
                      "licensing",
                      "support",
                    ].map((m) => (
                      <div
                        key={m}
                        className="border border-white/10 px-2.5 py-2 text-white/60"
                        style={{ background: "rgba(255,255,255,0.02)" }}
                      >
                        {m}
                      </div>
                    ))}
                  </div>

                  <div className="py-2 text-center font-[family-name:var(--font-plex-mono)] text-[11px] text-white/30">
                    ↓ persistence ↓
                  </div>

                  <div
                    className="flex items-center justify-between border px-3.5 py-2.5 font-[family-name:var(--font-plex-mono)] text-[12px]"
                    style={{ borderColor: `${LIME}55`, background: `${LIME}0F`, color: LIME }}
                  >
                    <span>database · object storage · queue</span>
                    <span>▮</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── PIPELINE */}
      <section id="pipeline" className="border-b border-white/8">
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <h2 className="max-w-[18ch] text-[clamp(1.6rem,4vw,2.9rem)] leading-[1.02] font-semibold tracking-[-0.03em]">
              Every engagement runs the same pipeline.
            </h2>
            <span className="font-[family-name:var(--font-plex-mono)] text-[11px] text-white/40">
              {"// no stage is skipped, no stage is implicit"}
            </span>
          </div>

          <div className="mt-12 grid gap-px border border-white/10 lg:grid-cols-6">
            {PIPELINE.map((s, i) => (
              <div
                key={s.k}
                className="group relative bg-[#0E1116] p-5 transition hover:bg-[#12161C]"
              >
                <div
                  className="flex items-center gap-2 font-[family-name:var(--font-plex-mono)] text-[10px] tracking-[0.14em]"
                  style={{ color: i < 3 ? CYAN : "#6B7684" }}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <span>{s.k}</span>
                </div>
                <div className="mt-3 text-[15px] leading-snug font-medium">{s.v}</div>
                <div className="mt-2 font-[family-name:var(--font-plex-mono)] text-[11px] leading-relaxed text-white/40">
                  {s.d}
                </div>
                <div
                  className="absolute bottom-0 left-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full"
                  style={{ background: CYAN }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── SPEC TABLE */}
      <section id="spec" className="border-b border-white/8" style={{ background: PANEL }}>
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div
                className="font-[family-name:var(--font-plex-mono)] text-[11px] tracking-[0.18em] uppercase"
                style={{ color: LIME }}
              >
                What you actually get
              </div>
              <h2 className="mt-4 text-[clamp(1.6rem,3.5vw,2.6rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
                Read the spec before you read the price.
              </h2>
              <p className="mt-5 text-[15.5px] leading-[1.65] text-white/60">
                Every module ships the same way. If something isn’t on this table, it isn’t in
                the box — and we say so before you buy, not after.
              </p>
            </div>

            <div className="lg:col-span-8">
              <div className="border border-white/10">
                <div className="hidden grid-cols-12 gap-4 border-b border-white/10 px-5 py-3 font-[family-name:var(--font-plex-mono)] text-[10px] tracking-[0.14em] text-white/40 uppercase sm:grid">
                  <span className="col-span-4">component</span>
                  <span className="col-span-6">description</span>
                  <span className="col-span-2 text-right">cost</span>
                </div>
                {SPEC.map(([c, d, p]) => (
                  <div
                    key={c}
                    className="grid grid-cols-1 gap-1 border-b border-white/[0.07] px-5 py-4 transition hover:bg-white/[0.02] sm:grid-cols-12 sm:gap-4"
                  >
                    <span className="font-[family-name:var(--font-plex-mono)] text-[13px] sm:col-span-4">
                      {c}
                    </span>
                    <span className="text-[14px] text-white/55 sm:col-span-6">{d}</span>
                    <span
                      className="font-[family-name:var(--font-plex-mono)] text-[12.5px] sm:col-span-2 sm:text-right"
                      style={{ color: p === "included" ? LIME : CYAN }}
                    >
                      {p}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── MODULES */}
      <section id="modules" className="border-b border-white/8">
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-[clamp(1.6rem,4vw,2.9rem)] font-semibold tracking-[-0.03em]">
              Modules in the registry
            </h2>
            <a
              href="#"
              className="font-[family-name:var(--font-plex-mono)] text-[12px]"
              style={{ color: CYAN }}
            >
              registry.list() → 148 results
            </a>
          </div>

          <div className="mt-11 grid gap-5 md:grid-cols-3">
            {MODULES.map((m) => (
              <article
                key={m.n}
                className="group border border-white/10 bg-[#0E1116] transition hover:border-white/25"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <img
                    src={u(m.img, 800)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover opacity-35 saturate-0 transition duration-500 group-hover:opacity-60 group-hover:saturate-100"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: `linear-gradient(180deg, transparent, ${PANEL})` }}
                  />
                  <div className="absolute inset-0" style={grid} />
                </div>
                <div className="p-5">
                  <div className="flex items-baseline justify-between">
                    <h3
                      className="font-[family-name:var(--font-plex-mono)] text-[16px] font-semibold"
                      style={{ color: CYAN }}
                    >
                      {m.n}
                    </h3>
                    <span className="font-[family-name:var(--font-plex-mono)] text-[11px] text-white/40">
                      v{m.v}
                    </span>
                  </div>
                  <div className="mt-3.5 flex flex-wrap gap-1.5">
                    {m.stack.map((s) => (
                      <span
                        key={s}
                        className="border border-white/12 px-2 py-1 font-[family-name:var(--font-plex-mono)] text-[10.5px] text-white/55"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3.5 font-[family-name:var(--font-plex-mono)] text-[11px]">
                    <span className="text-white/40">benchmark {m.load}</span>
                    <span
                      className="transition group-hover:translate-x-0.5"
                      style={{ color: LIME }}
                    >
                      inspect →
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── REQUIREMENTS COMPILER */}
      <section
        id="compiler"
        className="border-b border-white/8"
        style={{ ...grid, background: PANEL }}
      >
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <div className="max-w-[46ch]">
            <div
              className="font-[family-name:var(--font-plex-mono)] text-[11px] tracking-[0.18em] uppercase"
              style={{ color: CYAN }}
            >
              requirements compiler
            </div>
            <h2 className="mt-4 text-[clamp(1.6rem,4vw,2.9rem)] leading-[1.03] font-semibold tracking-[-0.03em]">
              Natural language in. Structured spec out.
            </h2>
          </div>

          <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr]">
            {/* input */}
            <div className="border border-white/12 bg-[#08090B] p-5 lg:p-6">
              <div className="border-b border-white/10 pb-3 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/40">
                stdin — customer, unedited
              </div>
              <p className="pt-5 text-[16px] leading-[1.65] text-white/75">
                “We run a care agency. Everything is on spreadsheets. I need to schedule about
                forty carers across client visits, and the timesheets are killing us. Staff
                should be able to see their shifts on their phones.”
              </p>
            </div>

            <div className="flex items-center justify-center py-2 lg:py-0">
              <div
                className="font-[family-name:var(--font-plex-mono)] text-[13px] lg:rotate-0"
                style={{ color: LIME }}
              >
                ──▶
              </div>
            </div>

            {/* output */}
            <div
              className="border p-5 lg:p-6"
              style={{ borderColor: `${LIME}44`, background: "#08090B" }}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3 font-[family-name:var(--font-plex-mono)] text-[11px]">
                <span className="text-white/40">stdout — requirements.json</span>
                <span style={{ color: LIME }}>valid ✓</span>
              </div>
              <pre className="overflow-x-auto pt-5 font-[family-name:var(--font-plex-mono)] text-[12px] leading-[1.75] text-white/75">
                {`{
  "domain": "care_agency",
  "scale":  { "staff": 40, "sites": "multi" },
  "confirmed": [
    "shift_scheduling",
    "visit_assignment",
    "timesheet_capture",
    "staff_mobile_access"
  ],
  "assumed": [
    "payroll_export",
    "compliance_records"
  ],
  "unresolved": [
    "does_client_need_login"
  ]
}`}
              </pre>
            </div>
          </div>

          <p className="mt-8 max-w-[62ch] font-[family-name:var(--font-plex-mono)] text-[12px] leading-relaxed text-white/45">
            {"// `assumed` is never promoted to `confirmed` without the customer saying so."}
            <br />
            {"// `unresolved` becomes the next question, not a guess."}
          </p>
        </div>
      </section>

      {/* ─────────────────────────── SLA */}
      <section id="sla" className="border-b border-white/8">
        <div className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
          <h2 className="text-[clamp(1.6rem,4vw,2.9rem)] font-semibold tracking-[-0.03em]">
            Commitments, in numbers
          </h2>
          <div className="mt-10 grid gap-px border border-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["1 business day", "first response on support", CYAN],
              ["4.2 days", "median time to quote", LIME],
              ["12 months", "updates included, from purchase", CYAN],
              ["100%", "source code delivered, always", LIME],
            ].map(([v, l, c]) => (
              <div key={l as string} className="bg-[#0E1116] p-6 lg:p-8">
                <div
                  className="text-[clamp(1.5rem,3vw,2.2rem)] font-semibold tracking-[-0.03em]"
                  style={{ color: c as string }}
                >
                  {v as string}
                </div>
                <div className="mt-2 font-[family-name:var(--font-plex-mono)] text-[11.5px] leading-relaxed text-white/45">
                  {l as string}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────── CTA */}
      <section className="mx-auto max-w-[1400px] px-5 py-16 lg:px-8 lg:py-24">
        <div className="border border-white/12 bg-[#0E1116]">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/40">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="ml-3">innovatrix — new engagement</span>
          </div>
          <div className="p-6 lg:p-14">
            <div className="font-[family-name:var(--font-plex-mono)] text-[13px] leading-[2] text-white/55">
              <div>
                <span style={{ color: LIME }}>$</span> innovatrix init
              </div>
              <div className="text-white/35">→ what should the system do?</div>
              <div className="mt-2">
                <span style={{ color: CYAN }}>_</span>
                <span
                  className="ml-1 inline-block h-[1.05em] w-[8px] translate-y-[2px] animate-pulse"
                  style={{ background: CYAN }}
                />
              </div>
            </div>
            <h2 className="mt-9 max-w-[20ch] text-[clamp(1.75rem,5vw,3.4rem)] leading-[1.0] font-semibold tracking-[-0.035em]">
              Specify it once. Own it forever.
            </h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                className="font-[family-name:var(--font-plex-mono)] text-[13px] font-semibold text-black"
                style={{ background: CYAN, padding: "14px 28px" }}
              >
                ./start
              </button>
              <button
                className="border border-white/20 font-[family-name:var(--font-plex-mono)] text-[13px] font-semibold transition hover:border-white/45"
                style={{ padding: "14px 28px" }}
              >
                ./book-technical-call
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── FOOTER */}
      <footer className="border-t border-white/8">
        <div className="mx-auto max-w-[1400px] px-5 py-12 lg:px-8">
          <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="font-[family-name:var(--font-plex-mono)] text-[14px] font-semibold">
                innovatrix
              </div>
              <p className="mt-3 max-w-[34ch] text-[13.5px] leading-relaxed text-white/45">
                Software acquisition and delivery, specified end to end.
              </p>
            </div>
            {[
              ["registry", ["modules", "versions", "changelog", "licences"]],
              ["build", ["requirements", "quotes", "delivery", "handover"]],
              ["operate", ["support", "sla", "hosting", "status"]],
            ].map(([h, items]) => (
              <div key={h as string}>
                <div className="font-[family-name:var(--font-plex-mono)] text-[10px] tracking-[0.16em] text-white/35 uppercase">
                  {h as string}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {(items as string[]).map((i) => (
                    <li key={i}>
                      <a
                        className="font-[family-name:var(--font-plex-mono)] text-[12.5px] text-white/55 hover:text-white"
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
          <div className="mt-11 flex flex-col gap-2 border-t border-white/8 pt-5 font-[family-name:var(--font-plex-mono)] text-[11px] text-white/30 sm:flex-row sm:justify-between">
            <span>© 2026 innovatrix ltd</span>
            <span>concept 04 — blueprint</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
