import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { listDocuments } from "@/services/vendors/document-service";
import { DocumentUpload } from "@/features/vendors/components/document-upload";

export const metadata: Metadata = { title: "Verification" };

/**
 * Vendor verification — vendor ticket 02.
 *
 * Two levels, and the ordering is the point: **identity** unlocks listing a
 * product, **business** unlocks receiving a payout. A vendor may therefore sell
 * before business verification completes — earnings accrue in the ledger and are
 * simply not payable. That removes the slowest step from the path to a first
 * listing without ever letting money leave to an unverified account.
 *
 * The guard is awaited in this component's own body before any JSX is returned,
 * and the document read is fast enough not to need a boundary. If it ever does,
 * the guard stays here and the query moves inside `<Suspense>` — never the other
 * way round.
 */
export default async function Page() {
  const { vendor, vendorId } = await requireVendorOrForbid();
  const documents = await listDocuments(vendorId);

  const forLevel = (level: "identity" | "business") =>
    documents
      .filter((document) => document.level === level)
      .map((document) => ({
        id: String(document._id),
        level: document.level,
        kind: document.kind,
        filename: document.filename,
        sizeBytes: document.sizeBytes,
        uploadedAt: formatDateTime(document.uploadedAt),
      }));

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader
        title="Verification"
        description="Two levels. Identity lets you list; business verification is what lets us pay you."
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Verification" },
        ]}
      />

      <Level
        title="Identity"
        purpose="Unlocks listing a product."
        status={vendor.verification.identity.status}
        decidedAt={vendor.verification.identity.decidedAt}
        hint="A government ID, and something showing the address you gave us."
        documents={forLevel("identity")}
        kinds={["government_id", "proof_of_address", "other"]}
        level="identity"
      />

      <Level
        title="Business"
        purpose="Unlocks receiving a payout. You can sell before this is done."
        status={vendor.verification.business.status}
        decidedAt={vendor.verification.business.decidedAt}
        hint="Company registration, a tax reference, and proof that the payout account is in the same name."
        documents={forLevel("business")}
        kinds={["company_registration", "tax_document", "bank_proof", "other"]}
        level="business"
      />

      <p className="text-subtle border-border border-t pt-5 text-[12.5px] leading-relaxed">
        We delete these documents once a level is decided, and keep only the outcome and a
        checksum of what we read. Only staff with a specific permission can open one, and every
        time somebody does it is recorded against their name.
      </p>
    </div>
  );
}

function Level({
  title,
  purpose,
  status,
  decidedAt,
  hint,
  documents,
  kinds,
  level,
}: {
  title: string;
  purpose: string;
  status: string;
  decidedAt?: Date;
  hint: string;
  documents: React.ComponentProps<typeof DocumentUpload>["documents"];
  kinds: React.ComponentProps<typeof DocumentUpload>["kinds"];
  level: "identity" | "business";
}) {
  // An approved level is finished: re-uploading would create documents nobody
  // will read and reopen a decision that has already been made. Re-verification
  // is triggered by a change of circumstance, not by the vendor's upload button
  // (vendor ticket 02).
  const canUpload = status !== "approved";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-[13px]">{purpose}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <p className="text-subtle text-[12.5px]">{hint}</p>

      {status === "approved" ? (
        <p className="border-border bg-surface-muted/40 rounded-xl border px-4 py-3 text-[13px]">
          Approved{decidedAt ? ` ${formatDateTime(decidedAt)}` : ""}. The documents you sent
          have been removed.
        </p>
      ) : (
        <DocumentUpload
          level={level}
          documents={documents}
          canUpload={canUpload}
          kinds={kinds}
        />
      )}
    </section>
  );
}
