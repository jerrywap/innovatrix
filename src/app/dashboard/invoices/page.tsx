import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Invoices" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" description="Issued invoices and what's been paid." />
      <EmptyState
        icon={Receipt}
        title="No invoices yet"
        description="Invoices are raised when you accept a quote or place an order."
      />
    </div>
  );
}
