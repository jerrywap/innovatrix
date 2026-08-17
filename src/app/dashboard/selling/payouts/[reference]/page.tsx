import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { findByReference } from "@/services/payouts/payout-service";
import { buildStatement } from "@/services/payouts/statement";
import { StatementDocument } from "@/features/payouts/components/statement-document";
import { PAYOUT_STATUS_COPY } from "@/features/payouts/payout-view";

export const metadata: Metadata = { title: "Payout statement" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * One payout's statement, as the vendor sees it — vendor ticket 09.
 *
 * ## No `<Suspense>`, and that is not a regression
 *
 * The 404 depends on the main query — a payout that is not this vendor's must be
 * indistinguishable from one that does not exist — so there is nothing to stream ahead of it.
 * AGENTS.md is explicit that blocking is correct here rather than pretending.
 *
 * ## Scoped by the session, and 404 for somebody else's
 *
 * `findByReference` takes the vendor scope from `requireVendorOrForbid()`, never from the URL.
 * A reference is a short, guessable string — `POU-2026-0007` — so a 403 would confirm which
 * ones exist and roughly how many vendors are being paid.
 *
 * Readable by any active member. The **account details** are included only for an owner, which
 * is why `includeAccount` is a parameter of the statement rather than something the component
 * decides.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/payouts/[reference]">) {
  const context = await requireVendorOrForbid();
  const { reference } = await params;

  const payout = await findByReference(reference, { vendorId: context.vendorId });
  if (!payout) notFound();

  const statement = await buildStatement(payout, {
    includeAccount: context.role === "owner",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print">
        <PageHeader
          title={`Payout ${statement.reference}`}
          description={PAYOUT_STATUS_COPY[statement.status]}
          breadcrumbs={[
            { label: "Selling", href: "/dashboard/selling" },
            { label: "Payouts", href: "/dashboard/selling/payouts" },
            { label: statement.reference },
          ]}
        />
      </div>

      <StatementDocument statement={statement} />

      {/*
        The remittance advice, through the authorised route rather than a link to the object.
        The bucket answers any known key over plain HTTPS with no signature, so the route is
        what protects it — and it audits who looked before redirecting to a five-minute URL.
      */}
      {payout.evidenceKey && (
        <a
          href={`/api/payout-evidence/${String(payout._id)}`}
          className="no-print flex w-fit items-center gap-2 text-[13px] underline underline-offset-4"
        >
          <FileText className="text-subtle size-4" aria-hidden />
          {payout.evidenceFilename ?? "Remittance advice"}
        </a>
      )}

      {context.role !== "owner" && (
        <p className="no-print text-subtle text-[12.5px]">
          The account this was paid into is visible to the account owner only.
        </p>
      )}
    </div>
  );
}
