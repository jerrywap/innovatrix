import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, PackageOpen, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { LICENCE_TYPES } from "@/lib/db/enums";
import { LICENCE_COPY, licenceTypeLabel } from "@/lib/licence-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description: "What things cost, and how quotes work.",
  path: "/pricing",
});

/**
 * §51 and §49, explained rather than tabulated.
 *
 * ## No tiers, because there are none
 *
 * The obvious pricing page is three columns with prices at the top, and it
 * would be a lie: a marketplace product is priced individually (§43), custom
 * work is quoted after scoping (§51), and services are a mix of the two. An
 * invented Starter/Pro/Enterprise would be the single most misleading thing on
 * the site — and the first thing a customer quotes back at us in a dispute.
 *
 * So this page answers the question behind the question — *how will I be
 * charged, and when do I find out* — and sends people to the marketplace for
 * actual numbers.
 *
 * Licence wording comes from `LICENCE_COPY`, the same map the customer's own
 * licence screen renders. Two descriptions of what a licence permits, one on
 * the page that sells it and one on the page that proves it, is how a refund
 * argument starts.
 */

const SHAPES = [
  {
    icon: PackageOpen,
    eyebrow: "Marketplace",
    title: "A price on the page",
    body: "Every product carries its own price, set per currency by hand rather than converted at yesterday's rate. What you see is what you pay, and what you paid is what stays on the order — repricing the catalogue never rewrites an old invoice.",
    foot: "Pay by card or bank transfer. Access appears as soon as payment is confirmed.",
  },
  {
    icon: Wrench,
    eyebrow: "Add-ons",
    title: "Fixed, from, or quoted",
    body: "Installation, branding, data migration and the rest attach to a product. Some are a fixed price, some show a starting price because the work varies, and some are quoted once we understand the specifics. The product page says which before you add it.",
    foot: "Bought alongside the licence, in the same basket.",
  },
  {
    icon: FileText,
    eyebrow: "Custom & customisation",
    title: "Scoped first, priced second",
    body: "Changes to an existing product, or something built from scratch. We talk it through, write down what we understood, and only then send a quote with the scope, the deliverables and — just as prominently — what is excluded.",
    foot: "Nothing is charged before you accept. A deposit starts the work; the balance follows on delivery.",
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader title="Pricing" description="What things cost, and how quotes work." />

      <p className="text-muted-foreground mt-6 max-w-[62ch] text-[15px] leading-relaxed">
        There is no price list, because the three things we sell are not priced the same way.
        Ready-made software has a price on it. Work that has to be scoped gets a written quote.
        Here is how each one works, so nothing arrives as a surprise.
      </p>

      <section className="mt-14 grid gap-4 lg:grid-cols-3">
        {SHAPES.map((shape) => (
          <article
            key={shape.title}
            className="border-border bg-surface hover:border-border-strong flex flex-col gap-3 rounded-[22px] border p-6 transition"
          >
            <shape.icon className="text-signal-text size-5" aria-hidden />
            <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
              {shape.eyebrow}
            </div>
            <h2 className="font-display text-[17px] leading-tight tracking-[-0.02em]">
              {shape.title}
            </h2>
            <p className="text-muted-foreground text-[13.5px] leading-relaxed">{shape.body}</p>
            <p className="text-subtle border-border mt-auto border-t pt-3 text-[12.5px] leading-relaxed">
              {shape.foot}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-16 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            Licences
          </div>
          <h2 className="font-display mt-3 max-w-[26ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            What you are actually buying.
          </h2>
          <p className="text-muted-foreground mt-3 max-w-[62ch] text-[14px] leading-relaxed">
            Buying software here is buying a licence to use it, not the copyright. Each product
            says which licence it comes with and how many installations it covers — and the same
            wording appears on the licence itself once it is yours.
          </p>
        </div>

        <dl className="border-border divide-border bg-surface divide-y overflow-hidden rounded-[22px] border">
          {LICENCE_TYPES.map((type) => (
            <div key={type} className="flex flex-col gap-1 p-5 sm:flex-row sm:gap-6">
              <dt className="font-display w-full text-[14px] tracking-[-0.02em] sm:w-56 sm:shrink-0">
                {licenceTypeLabel(type)}
              </dt>
              <dd className="text-muted-foreground text-[13.5px] leading-relaxed">
                {LICENCE_COPY[type]}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-16 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            The small print, in plain words
          </div>
          <h2 className="font-display mt-3 max-w-[24ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Things worth knowing before you pay.
          </h2>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          <Fact term="Currencies">
            Prices are set individually in {STOREFRONT_CURRENCIES.join(", ")} — never converted
            from a base currency, so a rate that moved overnight cannot reprice the catalogue.
            Which payment methods are available depends on the currency you choose.
          </Fact>
          <Fact term="Tax">
            Any VAT or sales tax that applies is calculated at checkout from your billing
            country and shown as its own line before you pay.
          </Fact>
          <Fact term="Updates and support">
            Each product states how long updates and support are included for. When that window
            ends you keep everything released inside it, permanently — nothing stops working.
          </Fact>
          <Fact term="Quotes">
            A quote lists scope, deliverables, exclusions, line items and an expiry date. It is
            not a bill: nothing is owed until you accept it.
          </Fact>
        </ul>
      </section>

      <section className="border-border bg-surface-muted/40 mt-16 flex flex-col gap-4 rounded-[26px] border p-7 lg:p-9">
        <h2 className="font-display max-w-[24ch] text-[clamp(1.3rem,2.6vw,1.8rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
          The real answer is on the product.
        </h2>
        <p className="text-muted-foreground max-w-[58ch] text-[14px] leading-relaxed">
          Every listing shows its price, its licence, what is included and what it would cost to
          have us install it. If what you need is not there, describe it and we will quote it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/marketplace"
            className="bg-foreground text-background inline-flex w-fit items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
          >
            See prices in the marketplace
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link
            href="/custom-software"
            className="border-border bg-surface hover:border-border-strong w-fit rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition"
          >
            Get something quoted
          </Link>
        </div>
      </section>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <li className="border-border bg-surface rounded-[22px] border p-5">
      <h3 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{term}</h3>
      <p className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">{children}</p>
    </li>
  );
}
