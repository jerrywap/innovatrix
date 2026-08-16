import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Notifications" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="What's changed since you were last here."
      />
      <EmptyState
        icon={Bell}
        title="You're all caught up"
        description="We'll tell you here when something needs you or moves forward."
      />
    </div>
  );
}
