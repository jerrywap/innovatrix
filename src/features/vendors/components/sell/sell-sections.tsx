import Link from "next/link";
import {
  CreditCard,
  Download,
  Globe,
  KeyRound,
  Plug,
  Receipt,
  Settings2,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Band, Eyebrow, SectionHead } from "@/components/band";
import {
  CHECKS,
  LISTING_NEEDS,
  MONEY,
  PAID_AFTER_SALE,
  PAYOUT_TIMELINE,
  RELATIONSHIP_AFTER_SALE,
  STEPS,
  WE_HANDLE,
} from "../../sell-data";

/**
 * The middle of `/sell` — four bands, each with its own way of communicating.
 *
 * That variety is the point rather than decoration. Every band used to be
 * heading → grey paragraph → row of rounded cards, which is legible and monotonous:
 * by the fourth one a reader has stopped distinguishing them. So the shapes differ
 * with the argument — a scannable icon grid for what we take on, a branching diagram
 * for what follows a sale, a timeline for money, a two-part checklist for applying —
 * while the tokens, radii, type scale and section rhythm stay exactly as they are
 * everywhere else.
 *
 * Name-to-component icon maps live at the call site, matching the homepage's
 * precedent: a component cannot cross the RSC boundary, so data modules carry names.
 */

const HANDLE_ICONS = {
  card: CreditCard,
  receipt: Receipt,
  key: KeyRound,
  download: Download,
  shield: ShieldCheck,
  globe: Globe,
} as const;

const AFTER_ICONS = {
  wrench: Wrench,
  plug: Plug,
  settings: Settings2,
} as const;

/** What the platform does, so a vendor can see what they are not doing. */
export function WeHandle() {
  return (
    <Band tone="muted">
      <SectionHead
        eyebrow="What we handle"
        title="You build it. We handle the selling."
        lede="Everything between a customer deciding they want your software and them having it working — and everything afterwards that involves money."
      />

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WE_HANDLE.map((item) => {
          const Icon = HANDLE_ICONS[item.icon];
          return (
            <div
              key={item.title}
              className="border-border bg-surface hover:border-border-strong flex flex-col rounded-[22px] border p-5 transition"
            >
              {/*
                Neutral, not accent. Six peach tiles here plus the accent on the
                headline, the buttons and the branch diagram below spreads the orange
                thin enough that none of it reads as emphasis any more — and the brand
                guide is explicit that it stays an accent. These icons are for
                scanning; the orange is saved for the places that are arguing.
              */}
              <span className="bg-surface-muted grid size-9 place-items-center rounded-xl">
                <Icon className="text-muted-foreground size-[17px]" aria-hidden />
              </span>
              <h3 className="font-display mt-4 text-[15.5px] tracking-[-0.02em]">
                {item.title}
              </h3>
              <p className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">
                {item.body}
              </p>
            </div>
          );
        })}
      </div>
    </Band>
  );
}

/**
 * The signature band: one product, several ways it keeps paying.
 *
 * Four equal cards undersold this badly — they read as a feature list when the
 * argument is a *shape*: the sale is a fork, not an endpoint. So the layout is the
 * argument. One node at the top, a rule, three branches under it.
 *
 * The connectors are borders on ordinary boxes rather than an SVG, which means they
 * inherit `--border`, work in both themes, and simply do not draw below `md` where
 * the branches stack — a diagram that cannot degrade is a diagram that breaks the
 * page on a phone.
 */
export function BeyondTheSale() {
  return (
    <Band id="beyond">
      <SectionHead
        eyebrow="Beyond the first sale"
        title="The sale is where it starts."
        lede="Most of what a customer needs happens after they have bought something. On CoSetup, most of that is work you can be paid for."
      />

      <div className="mt-14 flex flex-col items-center">
        {/* the product */}
        <div className="border-signal/40 bg-signal-soft/40 rounded-full border px-5 py-2.5 text-[13.5px] font-medium">
          Your software
        </div>

        {/* down into the fork, drawn only where the branches are side by side */}
        <div aria-hidden className="bg-border-strong h-8 w-px" />
        <div className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          A customer buys it
        </div>
        <div aria-hidden className="bg-border-strong h-8 w-px" />
        <div aria-hidden className="border-border hidden h-px w-2/3 border-t md:block" />

        <div className="grid w-full gap-3 md:mt-0 md:grid-cols-3 md:gap-4">
          {PAID_AFTER_SALE.map((item) => {
            const Icon = AFTER_ICONS[item.icon];
            return (
              <div key={item.title} className="flex flex-col items-center">
                {/* the stem, so each branch visibly hangs off the rule above */}
                <div aria-hidden className="bg-border-strong hidden h-8 w-px md:block" />
                <div className="border-border bg-surface flex w-full flex-1 flex-col rounded-[22px] border p-5">
                  <span className="flex items-center gap-2.5">
                    <Icon className="text-signal-text size-4 shrink-0" aria-hidden />
                    <h3 className="text-[15.5px] font-medium tracking-[-0.02em]">
                      {item.title}
                    </h3>
                  </span>
                  <p className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        The other half of the relationship, kept visually quieter on purpose — these
        two are not revenue and are not dressed up as it. See `RELATIONSHIP_AFTER_SALE`.
      */}
      <div className="border-border mt-10 grid gap-6 border-t pt-8 sm:grid-cols-2">
        {RELATIONSHIP_AFTER_SALE.map((item) => (
          <div key={item.title}>
            <h3 className="text-[14.5px] font-medium tracking-[-0.02em]">{item.title}</h3>
            <p className="text-muted-foreground mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed">
              {item.body}
            </p>
          </div>
        ))}
      </div>
    </Band>
  );
}

/** Money, as a shape first and three facts second. */
export function MoneyAndWhen() {
  return (
    <Band tone="muted">
      <SectionHead
        eyebrow="Getting paid"
        title="From the sale to your account."
        lede="The part people are usually asked to take on trust. Your own rate — and where it came from — is on your earnings screen once you are in."
      />

      {/* the timeline: a strip on desktop, a stack with the same beats on a phone */}
      <ol className="border-border bg-surface mt-10 grid overflow-hidden rounded-[22px] border md:grid-cols-4">
        {PAYOUT_TIMELINE.map((beat, index) => (
          <li
            key={beat.label}
            className={
              index === 0
                ? "flex flex-col p-5"
                : "border-border flex flex-col border-t p-5 md:border-t-0 md:border-l"
            }
          >
            <span className="flex items-center gap-2">
              <span
                className={
                  index === PAYOUT_TIMELINE.length - 1
                    ? "bg-signal size-1.5 rounded-full"
                    : "bg-border-strong size-1.5 rounded-full"
                }
                aria-hidden
              />
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                {beat.when}
              </span>
            </span>
            <h3 className="mt-2.5 text-[15px] font-medium tracking-[-0.02em]">{beat.label}</h3>
            <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
              {beat.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {MONEY.map((item) => (
          <div key={item.title} className="border-border bg-surface rounded-[22px] border p-5">
            <h3 className="text-[14.5px] font-medium tracking-[-0.02em]">{item.title}</h3>
            <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
              {item.body}
            </p>
          </div>
        ))}
      </div>
    </Band>
  );
}

/**
 * How to become a vendor — the four steps, then the two checks.
 *
 * These were two bands and are now one, because they answer one question. The steps
 * are a strip rather than four more cards, which both distinguishes them from every
 * other band and keeps the page from ending on its third card grid.
 *
 * "Verify once. Start listing." replaced "Two checks, and only one of them holds you
 * up" — which was true and made the reader work out which one. What an applicant
 * needs is the mapping, and it is now the label on each check.
 */
export function BecomingAVendor() {
  return (
    <Band id="apply-steps">
      <SectionHead
        eyebrow="What you'll need"
        title="Verify once. Start listing."
        lede="Applying takes a few minutes. Nothing here is automatic — which is slower than a sign-up form, and the reason a buyer trusts what is on the shelf."
      />

      <ol className="border-border bg-surface mt-10 grid overflow-hidden rounded-[22px] border sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={
              index === 0
                ? "flex flex-col p-5"
                : "border-border flex flex-col border-t p-5 sm:border-t sm:border-l lg:border-t-0"
            }
          >
            <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2.5 text-[15px] font-medium tracking-[-0.02em]">{step.title}</h3>
            <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {CHECKS.map((check) => (
          <div
            key={check.title}
            className="border-border bg-surface flex flex-col rounded-[22px] border p-5 lg:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15.5px] font-medium tracking-[-0.02em]">{check.title}</h3>
              <span className="bg-surface-muted text-muted-foreground rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-[0.12em] uppercase">
                {check.unlocks}
              </span>
            </div>

            <ul className="mt-4 flex flex-col gap-2">
              {check.items.map((item) => (
                <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed">
                  <span
                    aria-hidden
                    className="bg-border-strong mt-[7px] size-1.5 shrink-0 rounded-full"
                  />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>

            <p className="text-subtle mt-4 text-[12.5px] leading-relaxed">{check.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Eyebrow>And for the listing itself</Eyebrow>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {LISTING_NEEDS.map((need) => (
            <li key={need} className="text-muted-foreground text-[13.5px]">
              {need}
            </li>
          ))}
        </ul>
        <p className="text-subtle mt-5 max-w-[76ch] text-[12.5px] leading-relaxed">
          A reviewer checks your first product before it goes on sale and tells you what to
          change if it isn&rsquo;t ready. Passing that review means it is accepted, not that it
          is on sale yet &mdash;{" "}
          <Link href="/terms/vendor" className="underline underline-offset-4">
            the agreement
          </Link>{" "}
          sets out both.
        </p>
      </div>
    </Band>
  );
}
