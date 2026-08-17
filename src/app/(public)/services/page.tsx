import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  DatabaseZap,
  GaugeCircle,
  LifeBuoy,
  Plug,
  Rocket,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Services",
  description: "Installation, deployment, support and maintenance around the software you run.",
  path: "/services",
});

/**
 * §58's technical services, as a page.
 *
 * ## Everything here is something we actually do
 *
 * The temptation on a services page is to list the whole of §58 and let the
 * customer discover later which parts are real. Two things are deliberately
 * *not* claimed:
 *
 * - **Tech Assistant hours (§59).** Buying a block of hours is Phase 4 and the
 *   balance machinery does not exist. Offering it would take money for something
 *   nobody can deliver against.
 * - **Named maintenance plans (§67).** Essential / Business / Managed are in the
 *   spec and deferred in the MVP, so maintenance is described as quoted work
 *   rather than a tier with a price next to it.
 *
 * What *is* claimed maps to something in the product: installation options are
 * per-product fields (`ProductDoc.installation`), add-ons are real rows
 * (`ProductDoc.addons`) with §49's three pricing modes, and anything else routes
 * into the same quote flow the custom-build door uses.
 */

const AT_PURCHASE = [
  {
    icon: Rocket,
    title: "Install it for you",
    body: "We put it on your server or ours, configure it, and hand it over working. Most products can also be self-installed — the product page says which.",
  },
  {
    icon: Plug,
    title: "Connect it up",
    body: "Payment gateway, email sending, domain and SSL, and the integrations the software expects. The fiddly half-day that turns a working install into a working business.",
  },
  {
    icon: Boxes,
    title: "Make it yours",
    body: "Your name, your colours, your terminology. Branding is the change customers ask for most often, and the cheapest one to make.",
  },
  {
    icon: DatabaseZap,
    title: "Bring your data across",
    body: "Customers, products, bookings, history — out of the spreadsheet or the old system and into the new one, checked before you rely on it.",
  },
];

const STANDALONE = [
  {
    icon: Wrench,
    title: "Fix and finish",
    body: "Something you already own that does not work, or never got finished. Bring us the code and the problem.",
  },
  {
    icon: Rocket,
    title: "Deploy and host",
    body: "Servers, containers, domains, DNS, certificates, backups. Set up once and documented so it is not a mystery later.",
  },
  {
    icon: GaugeCircle,
    title: "Make it faster",
    body: "Slow pages, slow queries, a database that has outgrown its indexes. Measured first, changed second.",
  },
  {
    icon: ShieldCheck,
    title: "Update and secure",
    body: "Framework and dependency upgrades, security patches, and the version bumps that get postponed until they cannot be.",
  },
  {
    icon: Plug,
    title: "Integrate",
    body: "Two systems that should talk to each other and do not. APIs, webhooks, imports, exports.",
  },
  {
    icon: LifeBuoy,
    title: "Keep it running",
    body: "Monitoring, backups, updates and someone to call. Arranged per system rather than sold as a tier — what a shop needs and what a clinic needs are not the same thing.",
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Services"
        description="Installation, deployment, support and maintenance around the software you run."
      />

      <p className="text-muted-foreground mt-6 max-w-[62ch] text-[15px] leading-relaxed">
        Software is not finished when the code is. It has to be installed somewhere, wired to
        the things it needs, filled with your data, and kept working afterwards. That is most of
        what we do — whether or not you bought the software from us.
      </p>

      <section className="mt-14 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            With a marketplace product
          </div>
          <h2 className="font-display mt-3 max-w-[24ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Add it to the basket, not to a to-do list.
          </h2>
          <p className="text-muted-foreground mt-3 max-w-[62ch] text-[14px] leading-relaxed">
            Products can carry service add-ons you buy at the same time as the licence. Some
            have a fixed price, some a starting price, and some are quoted once we know a bit
            more — the product page tells you which before you commit.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {AT_PURCHASE.map((item) => (
            <li
              key={item.title}
              className="border-border bg-surface hover:border-border-strong rounded-[22px] border p-5 transition"
            >
              <item.icon className="text-signal-text size-5" aria-hidden />
              <h3 className="font-display mt-3.5 text-[15px] tracking-[-0.02em]">
                {item.title}
              </h3>
              <p className="text-muted-foreground mt-1.5 text-[13.5px] leading-relaxed">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            On its own
          </div>
          <h2 className="font-display mt-3 max-w-[26ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            You do not have to have bought it here.
          </h2>
          <p className="text-muted-foreground mt-3 max-w-[62ch] text-[14px] leading-relaxed">
            Plenty of this work is on software we had nothing to do with. Tell us what you have
            and what is wrong with it; if it is not something we should take on, we will say so.
          </p>
        </div>

        <ul className="border-border divide-border bg-surface divide-y overflow-hidden rounded-[22px] border">
          {STANDALONE.map((item) => (
            <li key={item.title} className="flex gap-4 p-5">
              <item.icon className="text-subtle mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <h3 className="font-display text-[15px] tracking-[-0.02em]">{item.title}</h3>
                <p className="text-muted-foreground mt-1 text-[13.5px] leading-relaxed">
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border bg-surface-muted/40 mt-16 flex flex-col gap-4 rounded-[26px] border p-7 lg:p-9">
        <h2 className="font-display max-w-[22ch] text-[clamp(1.3rem,2.6vw,1.8rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
          Not sure which of these you need?
        </h2>
        <p className="text-muted-foreground max-w-[58ch] text-[14px] leading-relaxed">
          That is the normal starting point. Describe the situation in your own words and we
          will work out what it actually takes — and tell you if the answer is something you can
          buy off the shelf instead.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/custom-software"
            className="bg-foreground text-background inline-flex w-fit items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
          >
            Tell us what you need
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link
            href="/marketplace"
            className="border-border bg-surface hover:border-border-strong w-fit rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition"
          >
            Browse the marketplace
          </Link>
        </div>
        <p className="text-subtle text-[12.5px]">
          Nothing is charged until you have accepted a written quote.
        </p>
      </section>
    </div>
  );
}
