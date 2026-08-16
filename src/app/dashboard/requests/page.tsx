import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Requests" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Requests"
        description="Custom work you've asked us to scope or build."
      />
      <EmptyState
        icon={ClipboardList}
        title="No requests yet"
        description="Describe what you need and we'll scope it, then send you a quote."
        action={
          <Button asChild>
            <Link href="/custom-software">Start a request</Link>
          </Button>
        }
      />
    </div>
  );
}
