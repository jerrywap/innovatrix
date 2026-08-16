import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Messages" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("message.view_all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Customer conversations across every request and order."
      />
      <EmptyState
        icon={MessagesSquare}
        title="No messages"
        description="Customer threads waiting on a reply will be listed here."
      />
    </div>
  );
}
