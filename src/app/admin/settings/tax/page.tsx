import type { Metadata } from "next";
import { Suspense } from "react";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { taxRules } from "@/repositories/tax-rule.repository";
import { TaxRuleForm } from "@/features/pricing/components/tax-rule-form";
import { ToggleActive } from "@/features/pricing/components/toggle-active";
import { setTaxRuleActiveAction } from "@/features/pricing/actions";

export const metadata: Metadata = { title: "Tax" };

/**
 * Tax rules — ticket 10.
 *
 * ## Changing a rate does not change any order
 *
 * Every order snapshots the rule id **and** the rate it was charged at (§61).
 * That is what makes these safely editable: when VAT moves, the rule moves and
 * nothing already sold moves with it.
 */
export default async function Page() {
  await requirePermissionOrForbid("tax.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Tax"
        description="Which rate applies where. Keyed on the billing country and what's being sold."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Rules />
      </Suspense>
    </div>
  );
}

async function Rules() {
  await connectToDatabase();
  const rules = await taxRules.listAll();

  return (
    <div className="flex flex-col gap-8">
      <p className="border-border bg-surface-muted flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[12.5px]">
        <Info className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Changing a rate here affects{" "}
          <strong className="font-medium">future orders only</strong>. Every order stores the
          rule and the rate it was charged at, so an invoice from last year still reconciles to
          what the customer actually paid.
        </span>
      </p>

      <TaxRuleForm />

      <ul className="border-border divide-border divide-y rounded-xl border">
        {rules.map((rule) => (
          <li key={String(rule._id)} className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{rule.ruleId}</span>
                <span className="text-[13px]">{rule.basisPoints / 100}%</span>
                {!rule.isActive && (
                  <span className="text-subtle rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                    inactive
                  </span>
                )}
              </p>
              <p className="text-subtle text-[12px]">
                {rule.label} · {rule.country === "*" ? "everywhere else" : rule.country} ·{" "}
                {rule.kind} · priority {rule.priority}
              </p>
            </div>

            <ToggleActive
              id={String(rule._id)}
              isActive={rule.isActive}
              action={setTaxRuleActiveAction}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
