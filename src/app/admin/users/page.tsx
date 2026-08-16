import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Users & roles" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("staff.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & roles"
        description="Staff accounts and what each of them may do."
      />
      <EmptyState
        icon={UserCog}
        title="No staff accounts yet"
        description="Staff members and their permission roles are managed here."
      />
    </div>
  );
}
