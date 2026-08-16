import type { Metadata } from "next";
import { Timer } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Follow-ups" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("request.view_all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Follow-ups" description="What you owe someone, and by when." />
      <EmptyState
        icon={Timer}
        title="Nothing to follow up"
        description="Follow-ups you or the system raise against a request appear here."
      />
    </div>
  );
}
