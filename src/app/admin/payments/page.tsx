import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Payments" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("payment.reconcile");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Transactions, reconciliation and provider configuration."
      />
      <EmptyState
        icon={CreditCard}
        title="No payments yet"
        description="Payments and their provider webhooks will be listed here."
      />
    </div>
  );
}
