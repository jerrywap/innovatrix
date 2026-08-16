import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Organization" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organization" description="Members, roles and billing details." />
      <EmptyState
        icon={Building2}
        title="Nothing to manage yet"
        description="Invite colleagues and set their roles here. Billing details live on this screen too."
      />
    </div>
  );
}
