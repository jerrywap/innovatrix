import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Jobs" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("system.manage_jobs");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" description="Background work, its schedule and its failures." />
      <EmptyState
        icon={ListChecks}
        title="No jobs registered"
        description="Scheduled and queued background jobs will be listed here."
      />
    </div>
  );
}
