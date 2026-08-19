import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description: "How buying, licensing and commissioning work here.",
  path: "/terms",
  type: "article",
});

/**
 * How the service operates — deliberately not a drafted contract.
 *
 * ## Why there is no clause numbering here
 *
 * A terms-of-service document allocates liability, sets a governing law and
 * limits remedies. Writing one without a lawyer produces something that looks
 * enforceable, is relied on by customers, and fails at the first moment it
 * matters. README decision #12 has this blocking launch, not development.
 *
 * What is written here is true and useful in the meantime: the operational
 * rules the software already enforces. Every statement corresponds to real
 * behaviour — the frozen order snapshot (§61), webhook-verified fulfilment
 * (§13), the entitlement windows on `EntitlementDoc`, and quote acceptance
 * being audited with actor, timestamp and version (§90).
 *
 * When counsel's text arrives it replaces this page. Until then this is a
 * description, and says so in the first thing you read.
 */

const SECTIONS = [
  {
    /*
     * Added with the CoSetup rebrand, because the rebrand is what made it
     * necessary: the brand and the company are now different names, and a
     * customer signing up to a licence is entitled to know which one is on the
     * other side of it. §29's "clear ownership" is the rule, and a terms page
     * that never names its counterparty fails it however accurate the rest is.
     */
    heading: "Who you are buying from",
    body: [
      `${BRAND.name} is a trading name of ${BRAND.legalName}. When you buy software or commission work here, your contract is with ${BRAND.legalName}, and that is the name that appears on your invoice and on the account you pay into.`,
      `${BRAND.legalName} is the seller of record for everything sold here, including software listed by third-party vendors. You buy from us and we invoice you; the vendor licenses their software to you through us. That is why a refund conversation, a licence key or a chargeback is ours to answer rather than theirs.`,
    ],
  },
  {
    heading: "What you are buying",
    body: [
      "Buying software here grants you a licence to use it under the terms shown on the product. It does not transfer ownership of the software or its copyright, and it does not give you the right to resell it unless the licence explicitly says so.",
      "Each product states its licence type and how many installations it covers. That wording appears again on the licence itself once the purchase completes, so there is one description rather than two.",
    ],
  },
  {
    heading: "Prices and payment",
    body: [
      "Prices are shown per currency and include any add-ons you select. Applicable tax is calculated at checkout from your billing country and shown separately before you pay.",
      "The price recorded on your order is the price at the moment you ordered. Later changes to a product's price never alter an existing order or invoice.",
      "Access is released when payment is confirmed by the payment provider — not when your browser returns from it. Paying by bank transfer means access follows once the transfer has been received and recorded, which is not instant.",
    ],
  },
  {
    heading: "Updates and support",
    body: [
      "Products state how long updates and support are included. When that period ends, everything released during it remains yours permanently and continues to work; you simply stop receiving newer versions.",
      "Support covers the software behaving as described. Work to make it do something it was never described as doing is a change, and is quoted as one.",
    ],
  },
  {
    heading: "Quoted work",
    body: [
      "Custom builds, customisations and standalone services are quoted before anything starts. A quote sets out the scope, the deliverables, what is excluded, the line items and an expiry date.",
      "Accepting a quote is recorded with who accepted it, when, and which version they accepted — a later revision supersedes rather than edits it, so what you agreed to stays legible.",
      "Work begins after the deposit is paid. Anything outside the accepted scope is a change request, priced separately, and never assumed.",
    ],
  },
  {
    heading: "Refunds",
    body: [
      "Digital goods are hard to return, so ask before you buy if you are unsure — that is what the demos and the questions are for.",
      "Where something does not work as described and cannot be put right, we will refund it. Refunds are reviewed by a person, and a refunded licence stops being valid.",
    ],
  },
  {
    heading: "Using the platform",
    body: [
      "Keep your account credentials to yourself; anyone in your organisation with the right role can act on its behalf, and you control who those people are.",
      "Do not upload anything you do not have the right to share, and do not put passwords or server credentials into the assistant or a message thread — ask us for a secure route instead.",
      "We may suspend an account that is being used to attack the platform or another customer.",
    ],
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Terms"
        description="How buying, licensing and commissioning work here."
      />

      <div className="border-border bg-surface-muted/50 mt-6 flex max-w-[74ch] gap-3 rounded-[22px] border p-5">
        <TriangleAlert className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          <span className="text-foreground font-medium">
            This describes how we operate; it is not yet the contract.
          </span>{" "}
          Everything below is an accurate account of how purchases, licences and quoted work
          actually behave. The formal terms of service — governing law, liability, dispute
          resolution — are with our advisers and will replace this page before launch. Where a
          specific commitment matters to you, get it in writing on your quote.
        </p>
      </div>

      <div className="mt-14 flex flex-col gap-12">
        {SECTIONS.map((section, index) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <span className="text-subtle font-mono text-[10px] tracking-[0.2em]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="font-display max-w-[26ch] text-[clamp(1.25rem,2.4vw,1.6rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
                {section.heading}
              </h2>
            </div>
            <div className="flex max-w-[70ch] flex-col gap-3 pl-0 sm:pl-9">
              {section.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="text-muted-foreground text-[14px] leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="border-border bg-surface-muted/40 mt-16 flex flex-col gap-4 rounded-[26px] border p-7 lg:p-9">
        <h2 className="font-display max-w-[26ch] text-[clamp(1.3rem,2.6vw,1.8rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
          Something here that does not fit how you buy?
        </h2>
        <p className="text-muted-foreground max-w-[58ch] text-[14px] leading-relaxed">
          Procurement rules, a licence that has to cover more installations, a different payment
          schedule — these are normal requests. Raise them before you order rather than after.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/custom-software"
            className="bg-foreground text-background w-fit rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
          >
            Talk to us
          </Link>
          <Link
            href="/privacy"
            className="border-border bg-surface hover:border-border-strong w-fit rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition"
          >
            Read the privacy page
          </Link>
        </div>
      </section>
    </div>
  );
}
