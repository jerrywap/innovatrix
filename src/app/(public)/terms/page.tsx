import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";
import { parseLegalDocument } from "@/features/legal/document";
import { TERMS_OF_SERVICE } from "@/features/legal/terms-of-service";
import { LegalDocumentView } from "@/features/legal/components/legal-document";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description:
    "The terms governing purchases, licences, custom work and technical services on CoSetup.",
  path: "/terms",
  type: "article",
});

/**
 * The terms of service.
 *
 * ## Why this replaced a description rather than being added beside one
 *
 * The previous page set out how the software behaves — the frozen order
 * snapshot, webhook-verified fulfilment, audited quote acceptance — and said in
 * its first paragraph that it was deliberately not a contract, because writing
 * one without counsel produces something customers rely on and that fails at the
 * first moment it matters.
 *
 * The drafted terms have arrived, so keeping both would leave two documents
 * describing one relationship, disagreeing the first time either is edited, with
 * no way for a reader to tell which one binds. The operational description
 * survives where it belongs: on the product pages, in the checkout, and in the
 * licence attached to each purchase.
 *
 * These terms cover customers. Vendors have their own — `/terms/vendor`, which
 * clause 2 points at and which is unchanged by this.
 *
 * ## Rendered, not retyped
 *
 * Eighty-two clauses across fifteen parts. `parseLegalDocument` builds the
 * structure from the supplied text so no clause passes through a keyboard on the
 * way to the page; `document.test.ts` asserts that every line of the source
 * still appears in the output.
 */
const DOCUMENT = parseLegalDocument(TERMS_OF_SERVICE);

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Terms of service"
        description={`Last updated ${DOCUMENT.lastUpdated}.`}
      />

      <LegalDocumentView document={DOCUMENT} />
    </div>
  );
}
