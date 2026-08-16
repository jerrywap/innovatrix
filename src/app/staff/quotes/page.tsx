import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Quotes" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("quote.view_all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="Drafts, issued quotes and what customers have done with them."
      />
      <EmptyState
        icon={FileText}
        title="No quotes"
        description="Quotes you draft or issue will be listed here."
      />
    </div>
  );
}
