import Link from "next/link";
import { VENDOR_FAMILIES } from "@/features/home/data";
import { EarningsSurface } from "./earnings-surface";

/**
 * The top of `/sell`.
 *
 * ## The headline goes one step past the homepage
 *
 * The homepage's vendor band already says "You build software. We help you sell it."
 * Repeating it here would waste the click. The brand guide's vendor ladder is: I can
 * sell software here, then customers can ask for modifications and services around my
 * products, then there is commercial life beyond the original sale. The headline
 * carries the first and last of those; the band four sections down carries the middle.
 *
 * ## The lede no longer claims invoices
 *
 * It used to read "the checkout, the licence keys, the delivery and the invoices".
 * `invoice-service` only ever writes quote-sourced invoices — a marketplace purchase
 * produces an order, entitlements and licences, and nothing anywhere writes an
 * order-sourced invoice. "The tax" replaces it, which the cart genuinely does compute.
 */
export function SellHero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px] opacity-[0.55]"
        style={{
          background:
            "radial-gradient(760px 460px at 20% 6%, var(--signal-soft), transparent 68%)",
        }}
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-x-0 top-0 hidden h-[560px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] opacity-40 dark:block"
      />

      <div // Tightened: the first pass left roughly a hundred pixels of trailing space
        // below both columns, which read as the section not knowing it had finished.
        className="relative mx-auto max-w-[1400px] px-5 pt-12 pb-14 lg:px-10 lg:pt-16 lg:pb-20"
      >
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <p className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
              Sell with CoSetup
            </p>

            {/*
              Seven columns and a 3.4rem cap, both set by the second line.

              "Then sell what comes next." is the longest line, and at the 4rem the
              first draft used it wrapped and left "next." orphaned on a third line —
              which reads as a mistake rather than as a three-beat headline. Measured
              across the breakpoints rather than guessed.
            */}
            <h1 className="mt-5 text-[clamp(2.1rem,4.4vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance">
              Sell your software.
              <br />
              <span className="text-signal-text">Then sell what comes next.</span>
            </h1>

            {/*
              Both halves of the headline, in one paragraph.

              The previous version explained checkout, tax, licensing and delivery —
              all of which is "Sell your software" and none of which is "Then sell
              what comes next". The second sentence is the one carrying the
              positioning, so it names the work that follows a sale by name.
            */}
            <p className="text-muted-foreground mt-6 max-w-[54ch] text-[16.5px] leading-relaxed lg:text-[17.5px]">
              Sell your applications, scripts and templates through CoSetup. We handle the
              checkout, the licence keys and the delivery — and when your customers need the
              product adapted, extended or set up, that work comes back to you as paid work.
            </p>

            {/*
              What belongs here, said before anything else.

              A Laravel developer, a template designer and somebody who writes
              plugins should each recognise themselves in one glance — which the
              eyebrow used to try to do by listing job titles. `VENDOR_FAMILIES` is
              the same list the homepage vendor band uses, and its comment says it
              mirrors what the catalogue actually holds.
            */}
            <ul className="mt-7 flex flex-wrap gap-1.5">
              {VENDOR_FAMILIES.map((family) => (
                <li
                  key={family}
                  className="border-border bg-surface text-muted-foreground rounded-full border px-3 py-1.5 text-[12.5px]"
                >
                  {family}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {/*
                Straight to the authenticated form. A signed-out visitor is bounced to
                `/login`, which returns them here afterwards — one round trip, rather
                than a second application form that only exists to be signed out.
              */}
              <Link
                href="/dashboard/selling/apply"
                className="bg-signal text-signal-contrast rounded-full px-6 py-3 text-[14px] font-medium transition hover:opacity-90"
              >
                Apply to sell
              </Link>
            </div>

            {/*
              Two facts about applying, not a marketplace statistic.

              This was a live product count — real data from
              `getPublishedProductCount`, with the same `< 25` honesty floor the
              homepage uses, so it was never fabricated. But catalogue size answers a
              customer's question, not a vendor's. What a vendor weighing the click
              wants to know is what it costs and whether it is automatic.
            */}
            <p className="text-subtle mt-6 text-[12.5px]">
              Free to apply &middot; every application is read by a person
            </p>
          </div>

          <div className="lg:col-span-5">
            <EarningsSurface />
          </div>
        </div>
      </div>
    </section>
  );
}
