import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Orders" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="What you've bought, and where each order got to."
      />
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Your purchases and their fulfilment status will be listed here."
        action={
          <Button asChild>
            <Link href="/marketplace">Browse the marketplace</Link>
          </Button>
        }
      />
    </div>
  );
}
