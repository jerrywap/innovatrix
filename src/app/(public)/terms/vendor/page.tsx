import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";
import { VENDOR_AGREEMENT_VERSION } from "@/services/vendors/vendor-service";
import { VENDOR_AGREEMENT_SECTIONS } from "@/features/vendors/agreement";

export const metadata: Metadata = pageMetadata({
  title: "Vendor agreement",
  description:
    "The terms you accept when you sell your software on CoSetup — commission, payouts, support, and what happens if the relationship ends.",
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
        {VENDOR_AGREEMENT_SECTIONS.map((section, index) => (
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
