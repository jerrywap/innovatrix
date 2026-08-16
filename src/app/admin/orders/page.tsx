import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAnyPermissionOrForbid } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Orders" };

export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requireAnyPermissionOrForbid(["order.update_status", "order.cancel"]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Every order across the platform." />
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Orders from every customer will be listed here."
      />
    </div>
  );
}
