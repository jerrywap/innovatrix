import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";
import { VENDOR_AGREEMENT_VERSION } from "@/services/vendors/vendor-service";

export const metadata: Metadata = pageMetadata({
  title: "Vendor agreement",
  description:
    "The terms you accept when you sell your software on Innovatrix — commission, payouts, support, and what happens if the relationship ends.",
  path: "/terms/vendor",
  type: "article",
});

/**
 * The vendor agreement — vendor tickets 01 and 07.
 *
 * ## Why this page had to exist
 *
 * `VENDOR_AGREEMENT_VERSION` has been in the code since vendor ticket 01, the apply form makes
 * every applicant accept it, and `assertAgreementCurrent` blocks submissions when it is stale. But
 * the document it named did not exist: the "Read the agreement" link pointed at `/terms`, which is
 * written entirely for a *buyer* and contains no mention of vendors, sellers or third parties.
 *
 * A vendor accepting a versioned agreement that resolves to nothing is worse than having no
 * agreement at all — ticket 13 leans on that acceptance as the record a takedown is weighed
 * against, and an acceptance of nothing is not evidence of anything.
 *
 * ## The same discipline as `/terms` and `/privacy`
 *
 * This is **an accurate description of how the platform actually behaves**, with the banner saying
 * so, not a drafted contract. Every clause below corresponds to code that exists: the commission
 * snapshot on the order line (ticket 07), the clearance period and its assertion against the refund
 * window (ticket 08), the payout claim on ledger entries (ticket 09), the attestation stored with a
 * statement version (ticket 05), the suspension that leaves entitlements untouched (ticket 12), and
 * the dispute that cannot be closed without an outcome and a reason (ticket 13).
 *
 * Keep it in step with the code. A clause that has drifted from the software is worse than a
 * missing one, because a vendor will have relied on it.
 *
 * **The version string is imported, not typed.** If `VENDOR_AGREEMENT_VERSION` moves, this page
 * moves with it — the alternative is a page claiming to be one version while the acceptance
 * recorded against it is another.
 */

const SECTIONS: ReadonlyArray<{ heading: string; body: readonly string[] }> = [
  {
    heading: "Who sells to the customer",
    body: [
      "Innovatrix is the seller of record. The customer buys from us, pays us, and is invoiced by us; you licence your software to them through us. That is why we can take payment, issue the licence key, handle the refund conversation and answer a chargeback — and why you never hold the customer's money.",
      "You keep ownership of your software and its copyright. Nothing here transfers any of it. What you grant us is the right to list it, describe it, sell licences to it and deliver it to the people who buy.",
      "We are not your employer, your agent or your partner. You decide what you build, what it costs and when it changes.",
    ],
  },
  {
    heading: "Applying, and being verified",
    body: [
      "Somebody reads every application. Being accepted is not automatic and we do not have to explain a rejection, though we will tell you plainly that it is one.",
      "Identity verification — a government ID and a proof of address — is what lets you list a product. Business verification is separate and only matters when money leaves: until it is approved you can sell and earn, and payouts wait.",
      "The documents you upload are read by a person, and what they decided is recorded along with a checksum of what they read. We keep the decision; we do not need to keep the document indefinitely.",
    ],
  },
  {
    heading: "What you may list",
    body: [
      "You may only list software you own or are licensed to distribute. Each time you submit a product for review you confirm that in writing, and we record the confirmation with the date, your name and the exact wording you agreed to.",
      "That record is what we weigh a copyright or licence claim against. If it turns out to have been false, that is the end of the relationship rather than the start of a negotiation.",
      "No malware, no code you cannot relicense, and nothing that phones home in ways your product description does not disclose.",
    ],
  },
  {
    heading: "Review before sale",
    body: [
      "A reviewer checks a product before it goes on sale. If it is not ready you are told what to change, in specific terms, and you resubmit — the history of what was said is kept so a third submission makes sense next to the first two.",
      "We do not review your source code for correctness and we are not warranting your software to the customer. The review checks that what the listing claims matches what is delivered.",
      "We may decline to list something without that being a judgement on its quality. A product we cannot support, cannot describe honestly, or cannot deliver safely is one we will not sell.",
    ],
  },
  {
    heading: "Commission, and when the rate is fixed",
    body: [
      "We keep a percentage of each sale. The standard rate is set on the platform and may be varied for an individual vendor by agreement; you can see your own effective rate, and where it comes from, on your earnings screen.",
      "The rate is recorded on the order at the moment the customer buys, and is never re-read afterwards. A change to your rate applies to future orders only — it can never alter what you earned on a sale that has already happened.",
      "The commission is taken on the price after any discount and before tax. Tax is not our revenue, and a discount we chose to fund is not charged to you.",
      "Add-ons such as installation or branding are work we perform. Those lines carry no commission and no earning, because they are not a sale of your software.",
    ],
  },
  {
    heading: "Earnings, clearance and payouts",
    body: [
      "An earning is recorded when the customer's payment succeeds. It is held for thirty days before it becomes payable — that period is deliberately longer than the window in which a customer can ask for a refund, so we are never paying out money that is still refundable.",
      "Once cleared, earnings are paid on a regular run to the account you gave us, provided your business verification is complete and the balance is over the minimum. If a run passes you over you are told which run it was and why, on your payouts screen, rather than being left to notice.",
      "Every payout names exactly which earnings it settles, and comes with a statement you can reconcile against your own records. We issue that statement on your behalf, because you never invoiced the customer.",
      "No tax is withheld. You are responsible for accounting for your own tax on what you earn here.",
      "Changing your payout account pauses payouts until we have checked the new details against a bank document. Nothing else stops — your products stay on sale and you keep earning.",
    ],
  },
  {
    heading: "Refunds and chargebacks",
    body: [
      "We decide refunds, because we took the payment. You can say what you think in the thread and we read it before deciding; you cannot approve or refuse one.",
      "A refund reverses the earning on that sale. If it had not yet been paid out, the two cancel; if it had, your balance goes negative and the next payout is reduced. We recover it from future earnings rather than invoicing you for it.",
      "A refunded customer keeps their licence in a suspended state rather than losing it outright, because a refund is sometimes a dispute in progress and reversing a deletion is not possible.",
    ],
  },
  {
    heading: "Delivery, and why we hold a copy",
    body: [
      "However you supply your releases — uploading an archive, letting us mirror a link, or letting us pull a tagged release from your repository — we keep a copy in our own storage and serve the customer from there.",
      "That is not a preference. It is what lets us promise a customer that their download keeps working, and it is why your uptime is never their problem. A release whose bytes have not arrived and been verified is not released.",
    ],
  },
  {
    heading: "Support, and how fast",
    body: [
      "You answer questions about your own software first. You wrote it, and routing every question through us helps nobody.",
      "There is a first-response target — one working day if your business verification is complete, two otherwise. Customers are shown it before they open a thread, so it is a promise rather than a guideline. We measure it.",
      "Either you or the customer can ask us to step in, and a thread that goes past its target is escalated automatically. Escalation adds us to the conversation; it does not remove you, because the person who can fix it is still you.",
    ],
  },
  {
    heading: "Reviews of your products",
    body: [
      "Only customers who have bought a product can review it, and only once per purchase. You can reply publicly to any review and your reply is shown beside it.",
      "You cannot hide, remove or edit a review, and neither can we do it on request. What you can do is report one that breaks our rules, and a person will read it. A seller who could suppress criticism would make every remaining review on the platform worthless, including the good ones.",
      "Your rating is worked out from the reviews of everything you sell. Nobody adjusts it — not you, not us.",
    ],
  },
  {
    heading: "Disputes",
    body: [
      "Either you or a customer can raise a dispute, and raising one brings us in immediately rather than waiting for somebody to notice an escalation is due.",
      "We decide it, and we record an outcome and a reason. Both of you are told what was decided, in the same words. A dispute that simply goes quiet is not an outcome we allow.",
    ],
  },
  {
    heading: "Suspension, and what survives it",
    body: [
      "We can suspend selling — with a reason you can read — if something needs resolving. New sales stop and your products come off the marketplace; payouts are held; your workspace becomes read-only except for support.",
      "Nothing happens to customers who already bought. Their licences stay valid and their downloads keep working. Your products keep their URLs and their reviews, so reinstating is one action rather than a rebuild.",
      "We can remove a single product from sale immediately if we find it to be malicious or infringing, ahead of any discussion, with the discussion following.",
    ],
  },
  {
    heading: "Ending the relationship",
    body: [
      "Either of us can end it. New sales, your storefront and your access stop.",
      "Every customer who bought from you keeps what they bought: the licence stays valid, the entitlement stays active, and every version they were entitled to stays downloadable. Support for those products becomes ours.",
      "Your cleared balance is paid. Earnings still clearing are paid or reversed as they clear. The ledger is closed rather than deleted — we keep the record, because a relationship that ended in a disagreement is one whose records get read later.",
    ],
  },
  {
    heading: "Changes to this agreement",
    body: [
      "This agreement is versioned. When we change it you keep selling under the version you accepted until you accept the new one, and the only thing that waits is submitting something new — nothing already on sale is affected.",
      "Your acceptance is recorded with the version and the date. So is the previous one.",
    ],
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Vendor agreement"
        description="What you agree to when you sell your software here."
      />

      <p className="text-subtle mt-4 font-mono text-[11px] tracking-[0.14em] uppercase">
        Version {VENDOR_AGREEMENT_VERSION}
      </p>

      <div className="border-border bg-surface-muted/50 mt-6 flex max-w-[74ch] gap-3 rounded-[22px] border p-5">
        <TriangleAlert className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          <span className="text-foreground font-medium">
            This describes how selling here works; it is not yet the signed contract.
          </span>{" "}
          Every clause below is an accurate account of what the platform actually does — the
          commission recorded on your order lines, the thirty-day clearance, the payout that
          names its earnings, the entitlements that survive an offboarding. The formal agreement
          — governing law, liability, indemnities, termination notice — is with our advisers and
          will replace this page. If a specific commitment matters to you before then, ask and
          we will put it in writing.
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
          Ready to list something?
        </h2>
        <p className="text-muted-foreground max-w-[58ch] text-[14px] leading-relaxed">
          Applying takes a few minutes. You accept this agreement as part of it, and we record
          the version you accepted.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/selling/apply"
            className="bg-foreground text-background w-fit rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
          >
            Apply to sell
          </Link>
          <Link
            href="/sell"
            className="border-border w-fit rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition hover:bg-[var(--surface-muted)]"
          >
            How selling works
          </Link>
        </div>
      </section>
    </div>
  );
}
