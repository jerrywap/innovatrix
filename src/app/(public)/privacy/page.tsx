import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";
import { parseLegalDocument } from "@/features/legal/document";
import { PRIVACY_POLICY } from "@/features/legal/privacy-policy";
import { LegalDocumentView } from "@/features/legal/components/legal-document";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "How CoSetup collects, uses, shares and protects personal information, and the rights you have over it.",
  path: "/privacy",
  type: "article",
});

/**
 * The privacy policy.
 *
 * ## What changed, and why the page is now thin
 *
 * This used to be a hand-written inventory of what the schema stored, opening
 * with a banner admitting it was "a description, not yet the formal notice". The
 * reasoning was sound at the time — a notice has to name a controller, cite a
 * lawful basis per purpose and state retention periods, and inventing those
 * produces a document that reads binding and is not.
 *
 * That document now exists. It names Perfect Gateway LTD as controller, gives a
 * lawful basis for each purpose, sets retention by record type and sets out the
 * statutory rights and the route to the ICO. So the page's job changed from
 * *writing* the text to *presenting* it, and the honest way to present a legal
 * instrument is to render it unaltered.
 *
 * Everything on this page therefore comes out of `features/legal/privacy-policy`
 * verbatim. There is no editorial layer left here to drift from the source, and
 * no second copy of the date — `parseLegalDocument` reads it out of the text.
 *
 * ## The old inventory is not lost
 *
 * Clauses 2 to 22 cover the same ground the hand-written list did, at more
 * length. What has gone is the running commentary about the codebase, which was
 * useful while the page was a stopgap and is out of place in a published notice.
 */
const DOCUMENT = parseLegalDocument(PRIVACY_POLICY);

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Privacy policy"
        description={`Last updated ${DOCUMENT.lastUpdated}.`}
      />

      <LegalDocumentView document={DOCUMENT} />
    </div>
  );
}
