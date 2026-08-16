import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Quotes" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Quotes" description="What we've quoted, and what's waiting on you." />
      <EmptyState
        icon={FileText}
        title="No quotes yet"
        description="Once we've scoped a request, the quote for it lands here for you to accept or query."
      />
    </div>
  );
}
