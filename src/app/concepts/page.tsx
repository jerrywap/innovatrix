import Link from "next/link";

const CONCEPTS = [
  {
    n: "02",
    slug: "dialogue",
    name: "Dialogue",
    tagline: "Start with a sentence",
    position:
      "The AI assistant is the product. Leads with the conversation, not the catalogue.",
    who: "Non-technical business owners — the §1 “I need software for my cleaning company” customer",
    type: "Fraunces + DM Sans",
    palette: ["#FBF8F3", "#1C3A30", "#C56A45"],
    moves: [
      "Hero is a live-feeling input with rotating real prompts",
      "Soft organic blur fields instead of geometry",
      "Chat transcript rendered as the actual product surface",
    ],
    risk: "Underplays the marketplace — a buyer who knows what they want may bounce.",
    dark: false,
  },
  {
    n: "03",
    slug: "catalogue",
    name: "Catalogue",
    tagline: "Curated marketplace",
    position: "A department store for business software. Product-forward, price-transparent.",
    who: "Buyers ready to purchase; strongest for SEO and organic discovery",
    type: "Bricolage Grotesque + Newsreader",
    palette: ["#FAF7F0", "#141210", "#1B1AFF"],
    moves: [
      "Masthead with issue number — periodical, not portal",
      "Numbered products (No. 041) borrowed from print catalogues",
      "The §12 price breakdown shown openly as a design feature",
    ],
    risk: "Closest to “code marketplace” — the exact thing §16 says not to be.",
    dark: false,
  },
  {
    n: "04",
    slug: "blueprint",
    name: "Blueprint",
    tagline: "Engineered delivery",
    position: "Rigour as the pitch. Specs, pipelines, SLAs, source code always delivered.",
    who: "Technical evaluators and procurement, enterprise deals",
    type: "IBM Plex Sans + Mono",
    palette: ["#08090B", "#22D3EE", "#A3E635"],
    moves: [
      "Blueprint grid as a real background system, not decoration",
      "Requirements shown compiling: customer prose → structured JSON",
      "confirmed / assumed / unresolved rendered literally — §17 as UI",
    ],
    risk: "Alienates the non-technical half of the audience entirely.",
    dark: true,
  },
  {
    n: "05",
    slug: "atelier",
    name: "Atelier",
    tagline: "Software, commissioned",
    position: "A practice, not a platform. Case-study led, premium, relationship-first.",
    who: "Higher-value custom builds; positions against agencies, not marketplaces",
    type: "Instrument Serif + Manrope",
    palette: ["#FBFAF8", "#241D18", "#B08D57"],
    moves: [
      "Cinematic full-bleed hero, editorial alternating case studies",
      "Process as five numbered chapters with italic numerals",
      "Testimonial leads with talking a client out of spending more",
    ],
    risk: "Implies bespoke pricing — may deter self-serve marketplace buyers.",
    dark: true,
  },
];

export default function ConceptIndex() {
  return (
    <main className="min-h-screen bg-[#09090B] font-[family-name:var(--font-archivo)] text-white antialiased">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:px-8 lg:py-24">
        <div className="font-[family-name:var(--font-jetbrains)] text-[11px] tracking-[0.24em] text-white/40 uppercase">
          Innovatrix — design exploration
        </div>
        <h1 className="mt-6 max-w-[20ch] text-[clamp(2rem,6vw,4rem)] leading-[0.95] font-semibold tracking-[-0.04em]">
          Five landing pages. Five different companies.
        </h1>
        <p className="mt-6 max-w-[62ch] text-[16.5px] leading-[1.7] text-white/60">
          These aren’t five skins on one layout — each takes a genuinely different position on
          what Innovatrix <em>is</em>, because §107 of the technical doc leaves that open. Pick
          the positioning first; the visual language follows from it.
        </p>

        <Link
          href="/"
          className="mt-8 flex flex-col gap-3 rounded-2xl border border-[#E8552A]/40 bg-[#E8552A]/10 p-5 transition hover:border-[#E8552A] sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-[#E8552A] px-2.5 py-1 font-[family-name:var(--font-jetbrains)] text-[10px] font-semibold tracking-[0.14em] text-black uppercase">
                Selected
              </span>
              <span className="text-[19px] font-semibold tracking-[-0.03em]">
                01 — Meridian
              </span>
            </div>
            <p className="mt-2.5 max-w-[64ch] text-[14px] leading-relaxed text-white/60">
              Chosen and promoted to the live site, where it now carries light and dark themes,
              a softened radius scale and a reworked hero. The four below remain as a record of
              what was considered.
            </p>
          </div>
          <span className="shrink-0 text-[14px] font-medium">View the live site →</span>
        </Link>

        <div className="mt-14 space-y-5">
          {CONCEPTS.map((c) => (
            <Link
              key={c.slug}
              href={`/concepts/${c.slug}`}
              className="group block border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/30 hover:bg-white/[0.04] lg:p-8"
            >
              <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
                <div className="lg:col-span-4">
                  <div className="flex items-center gap-3">
                    <span className="font-[family-name:var(--font-jetbrains)] text-[12px] text-[#E8552A]">
                      {c.n}
                    </span>
                    <div className="flex gap-1">
                      {c.palette.map((p) => (
                        <span
                          key={p}
                          className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20"
                          style={{ background: p }}
                        />
                      ))}
                    </div>
                  </div>
                  <h2 className="mt-3 text-[clamp(1.5rem,3vw,2.1rem)] font-semibold tracking-[-0.035em]">
                    {c.name}
                  </h2>
                  <div className="mt-1 text-[14px] text-white/45">{c.tagline}</div>
                  <div className="mt-4 font-[family-name:var(--font-jetbrains)] text-[10.5px] tracking-[0.12em] text-white/35 uppercase">
                    {c.type}
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <p className="text-[15.5px] leading-[1.6] text-white/80">{c.position}</p>
                  <div className="mt-4">
                    <div className="font-[family-name:var(--font-jetbrains)] text-[10px] tracking-[0.14em] text-white/35 uppercase">
                      Aimed at
                    </div>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-white/55">{c.who}</p>
                  </div>
                  <div className="mt-4">
                    <div className="font-[family-name:var(--font-jetbrains)] text-[10px] tracking-[0.14em] text-white/35 uppercase">
                      Trade-off
                    </div>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-[#E8552A]/80">
                      {c.risk}
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <div className="font-[family-name:var(--font-jetbrains)] text-[10px] tracking-[0.14em] text-white/35 uppercase">
                    Notable moves
                  </div>
                  <ul className="mt-2.5 space-y-2">
                    {c.moves.map((m) => (
                      <li
                        key={m}
                        className="flex gap-2.5 text-[13.5px] leading-snug text-white/55"
                      >
                        <span className="text-white/25">—</span>
                        {m}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 inline-flex items-center gap-2 text-[13.5px] font-medium transition-transform group-hover:translate-x-1">
                    View concept
                    <span className="text-[#E8552A]">→</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-14 border-t border-white/10 pt-8">
          <div className="font-[family-name:var(--font-jetbrains)] text-[10px] tracking-[0.14em] text-white/35 uppercase">
            Notes
          </div>
          <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-white/50">
            <li>
              — Photography is Unsplash placeholder only. Real product screenshots replace every
              marketplace image before launch.
            </li>
            <li>
              — Copy is written to be plausible, not final. Numbers (148 products, 99.1% SLA)
              are illustrative.
            </li>
            <li>
              — These use plain <code className="text-white/70">&lt;img&gt;</code> deliberately,
              to avoid remote-pattern config while exploring. Production uses{" "}
              <code className="text-white/70">next/image</code> per ticket 27.
            </li>
            <li>
              — Nothing here is wired to data. The winning direction becomes the real design
              system in ticket 04.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
