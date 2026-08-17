import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { can, requirePermissionOrForbid } from "@/lib/auth/dal";
import { findByReference } from "@/services/payouts/payout-service";
import { buildStatement, statementReconciles } from "@/services/payouts/statement";
import { StatementDocument } from "@/features/payouts/components/statement-document";
import { PayoutActions } from "@/features/payouts/components/payout-actions";

export const metadata: Metadata = { title: "Payout" };

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * One payout, for staff — vendor ticket 09.
 *
 * ## The same statement the vendor sees
 *
 * Deliberately the same component. A staff screen that rendered its own version of the figures
 * would be a second layout to keep in step, and the first time they disagreed the conversation
 * would be about which one is right rather than about the money.
 *
 * `includeAccount: true` — staff resolving a failed transfer need the account, and it is masked
 * to the last four characters in the document either way.
 *
 * ## The reconciliation line
 *
 * `statementReconciles` checks `gross - commission === net` per line and that the lines sum to
 * the payout. It is shown rather than merely asserted in a test, because the moment it matters
 * is the moment somebody is about to move money, and "the arithmetic holds" is the one thing
 * they cannot check by eye on a twenty-line statement.
 *
 * No `<Suspense>`: the 404 depends on the main query, so there is nothing to stream ahead of it.
 */
export default async function Page({ params }: PageProps<"/admin/payouts/[reference]">) {
  await requirePermissionOrForbid("payout.view_all");

  const { reference } = await params;
  const payout = await findByReference(reference);
  if (!payout) notFound();

  const [statement, canApprove, canSend] = await Promise.all([
    buildStatement(payout, { includeAccount: true }),
    can("payout.approve"),
    can("payout.send"),
  ]);

  const reconciliation = statementReconciles(statement);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="no-print">
        <PageHeader
          title={`Payout ${statement.reference}`}
          description={`${statement.vendor.displayName} · ${statement.method}`}
          breadcrumbs={[
            { label: "Payouts", href: "/admin/payouts" },
            { label: statement.reference },
          ]}
          actions={<StatusBadge status={statement.status} />}
        />
      </div>

      {!reconciliation.ok && (
        <p className="no-print rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[13px]">
          <strong className="font-medium">This statement does not add up.</strong> Line drift{" "}
          {reconciliation.lineDrift}, total drift {reconciliation.totalDrift} minor units. Do
          not send it — the ledger and the order lines behind it disagree, and paying it would
          settle entries against a figure nobody can reproduce.
        </p>
      )}

      <StatementDocument statement={statement} />

      {payout.evidenceKey && (
        <a
          href={`/api/payout-evidence/${String(payout._id)}`}
          className="no-print flex w-fit items-center gap-2 text-[13px] underline underline-offset-4"
        >
          <FileText className="text-subtle size-4" aria-hidden />
          {payout.evidenceFilename ?? "Remittance advice"}
        </a>
      )}

      {/*
        Which controls are drawn comes from the status and the two permissions. Both are
        re-checked in every action — this decides what is *drawn*, and `requirePermission`
        decides what is allowed.
      */}
      <PayoutActions
        payoutId={String(payout._id)}
        status={payout.status}
        canApprove={canApprove}
        canSend={canSend}
      />
    </div>
  );
}
