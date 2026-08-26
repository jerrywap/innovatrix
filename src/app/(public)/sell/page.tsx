import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SellHero } from "@/features/vendors/components/sell/sell-hero";
import {
  BecomingAVendor,
  BeyondTheSale,
  MoneyAndWhen,
  WeHandle,
} from "@/features/vendors/components/sell/sell-sections";
import { SellApplyBand } from "@/features/vendors/components/sell/sell-apply-band";

export const metadata: Metadata = pageMetadata({
  title: "Sell your software",
  description:
    "List your own software on the CoSetup marketplace. We handle the checkout, the tax, the licence keys and the delivery; you keep building.",
  path: "/sell",
});

/**
 * The public front door for vendors — vendor ticket 01, redesigned under COS-8.
 *
 * **Content, not a form.** The application itself is authenticated and lives at
 * `/dashboard/selling/apply`, because the applicant is already a signed-up user:
 * they have a verified email, a user id for the owner membership to hang off, and
 * a session to audit the agreement acceptance against. A public form would collect
 * an identity the platform already holds and then have to reconcile the two.
 *
 * So this page's only job is to explain and then point at sign-in. A signed-out
 * visitor clicking through lands on `/register?next=…` and comes back.
 *
 * ## What changed, and what did not
 *
 * The copy that was here was already specific and honest — "Somebody reads every
 * application", "A government ID and a proof of address" — so it moved rather than
 * being rewritten. What it lacked was structure and an argument.
 *
 * Six bands now, and each one communicates differently: a vendor account in the hero,
 * a scannable grid of what we take on, a branching diagram for what a sale leads to,
 * a timeline for money, a two-part checklist for applying, and a photograph to close.
 * Uniform card grids were what made the first pass legible and monotonous.
 *
 * The band that matters most is the third. A marketplace page that stops at "we take
 * a share and you get paid" is describing a shelf; this one has to land that a sale
 * can be the start of paid customisation, plugins and setup work — which is true
 * here, and was absent from the page entirely.
 *
 * One claim was removed rather than restyled. The lede used to promise "the invoices";
 * `invoice-service` only ever writes quote-sourced invoices, and a marketplace
 * purchase produces an order, entitlements and licences instead. It now says "the
 * tax", which the cart genuinely computes. The metadata said it too.
 *
 * ## Nothing here awaits, so the page prerenders
 *
 * The build prints `◐` for this route because no component in it reads a cookie,
 * a session or the database. The hero once carried a live product count behind a
 * `<Suspense>`; it now carries two facts about applying instead, which are true
 * without a query. Adding a read means adding a boundary with it.
 */
export default function Page() {
  return (
    <>
      <SellHero />
      <WeHandle />
      <BeyondTheSale />
      <MoneyAndWhen />
      <BecomingAVendor />
      <SellApplyBand />
    </>
  );
}
